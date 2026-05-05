/**
 * Stress scenario: webhook delivery storm.
 *
 * Stand up a tiny HTTP listener locally, register it as a webhook
 * endpoint for `lead.created`, then fire 1,000 lead-creation events
 * back to back. Asserts:
 *   - The local listener receives ~1,000 deliveries within a generous
 *     time budget (default 5 minutes).
 *   - No infinite-retry loop: the average deliveries-per-event is
 *     close to 1 (reject if > 3 — would imply the worker is replaying).
 *   - Delivery latencies remain bounded (p95 < 30s).
 *
 * If we can't register a webhook (no /webhooks endpoint or insufficient
 * perms) we skip rather than fail.
 */
import { createServer, IncomingMessage, ServerResponse } from 'node:http';
import { AddressInfo } from 'node:net';
import {
  acquireTokens,
  bearer,
  STRESS_API_URL,
  writeScenarioResult,
} from './setup.js';
import type { ScenarioResult } from './setup.js';

const EVENT_COUNT = Number(process.env.STRESS_WEBHOOK_EVENTS ?? 1000);
const PARALLEL = Number(process.env.STRESS_WEBHOOK_PARALLEL ?? 25);
const DRAIN_MAX_MS = Number(process.env.STRESS_WEBHOOK_DRAIN_MS ?? 5 * 60_000);

interface DeliveryRecord {
  receivedAt: number;
  body: any;
}

export async function run(): Promise<ScenarioResult> {
  const startedAt = new Date().toISOString();
  const t0 = Date.now();

  const tokens = await acquireTokens();
  if (!tokens) {
    return finish({
      name: 'webhook-delivery-storm',
      passed: false,
      skipped: true,
      skipReason: 'No tokens',
      startedAt,
      finishedAt: new Date().toISOString(),
      durationMs: Date.now() - t0,
    });
  }

  const deliveries: DeliveryRecord[] = [];
  const server = createServer((req: IncomingMessage, res: ServerResponse) => {
    let raw = '';
    req.on('data', (chunk: Buffer) => (raw += chunk.toString()));
    req.on('end', () => {
      try {
        deliveries.push({
          receivedAt: Date.now(),
          body: raw ? JSON.parse(raw) : null,
        });
      } catch {
        deliveries.push({ receivedAt: Date.now(), body: null });
      }
      res.statusCode = 200;
      res.end('ok');
    });
  });
  await new Promise<void>((r) => server.listen(0, '0.0.0.0', () => r()));
  const listenerPort = (server.address() as AddressInfo).port;
  const listenerHost = process.env.STRESS_WEBHOOK_HOST ?? 'host.docker.internal';
  const listenerUrl =
    process.env.STRESS_WEBHOOK_URL ?? `http://${listenerHost}:${listenerPort}/`;

  // 1. Register the webhook
  const wh = await fetch(`${STRESS_API_URL}/api/v1/webhooks`, {
    method: 'POST',
    headers: bearer(tokens.tokenA),
    body: JSON.stringify({
      url: listenerUrl,
      events: ['lead.created'],
      isActive: true,
    }),
  });
  if (wh.status < 200 || wh.status >= 300) {
    server.close();
    return finish({
      name: 'webhook-delivery-storm',
      passed: false,
      skipped: true,
      skipReason: `Could not register webhook: ${wh.status}`,
      startedAt,
      finishedAt: new Date().toISOString(),
      durationMs: Date.now() - t0,
    });
  }
  const webhook = (await wh.json().catch(() => ({}))) as any;
  const webhookId = webhook?.id;

  // 2. Fire EVENT_COUNT lead.created events.
  const tokenA = tokens.tokenA;
  let producedOk = 0;
  let producedFail = 0;
  const fireStart = Date.now();
  let queued = 0;
  let inFlight = 0;
  const ackTimes: number[] = [];

  await new Promise<void>((resolve) => {
    const tick = () => {
      while (inFlight < PARALLEL && queued < EVENT_COUNT) {
        const i = queued++;
        inFlight++;
        const start = Date.now();
        fetch(`${STRESS_API_URL}/api/v1/leads`, {
          method: 'POST',
          headers: bearer(tokenA),
          body: JSON.stringify({
            firstName: 'WhStress',
            lastName: `wh-${start}-${i}`,
            email: `wh-${start}-${i}@example.test`,
          }),
        })
          .then((r) => {
            ackTimes.push(Date.now() - start);
            if (r.status >= 200 && r.status < 300) producedOk++;
            else producedFail++;
          })
          .catch(() => producedFail++)
          .finally(() => {
            inFlight--;
            if (queued < EVENT_COUNT) setImmediate(tick);
            else if (inFlight === 0) resolve();
          });
      }
    };
    tick();
  });

  const fireDurationMs = Date.now() - fireStart;

  // 3. Wait for deliveries.
  const drainStart = Date.now();
  while (
    deliveries.length < producedOk &&
    Date.now() - drainStart < DRAIN_MAX_MS
  ) {
    await new Promise((r) => setTimeout(r, 1000));
  }

  // 4. Best-effort cleanup of the webhook.
  if (webhookId) {
    await fetch(`${STRESS_API_URL}/api/v1/webhooks/${webhookId}`, {
      method: 'DELETE',
      headers: bearer(tokens.tokenA),
    }).catch(() => undefined);
  }
  server.close();

  const ackP95 = percentile(ackTimes, 95);
  const deliveryLatencies = deliveries
    .map((d, i) => d.receivedAt - (fireStart + i * (fireDurationMs / Math.max(1, deliveries.length))))
    .filter((n) => n > 0);
  const deliveryP95 = percentile(deliveryLatencies, 95);

  const deliveriesPerEvent = producedOk ? deliveries.length / producedOk : 0;
  const noInfiniteRetry = deliveriesPerEvent <= 3;
  const enoughDelivered = deliveries.length >= producedOk * 0.95;

  const passed = enoughDelivered && noInfiniteRetry && deliveryP95 < 30_000;

  return finish({
    name: 'webhook-delivery-storm',
    passed,
    failure: passed
      ? undefined
      : [
          !enoughDelivered &&
            `Only ${deliveries.length}/${producedOk} webhooks delivered`,
          !noInfiniteRetry &&
            `${deliveriesPerEvent.toFixed(2)} deliveries/event suggests retry storm`,
          deliveryP95 >= 30_000 &&
            `delivery p95 ${deliveryP95}ms >= 30s`,
        ]
          .filter(Boolean)
          .join('; '),
    startedAt,
    finishedAt: new Date().toISOString(),
    durationMs: Date.now() - t0,
    metrics: {
      eventCount: EVENT_COUNT,
      producedOk,
      producedFail,
      deliveries: deliveries.length,
      deliveriesPerEvent,
      ackP95Ms: ackP95,
      deliveryP95Ms: deliveryP95,
      fireDurationMs,
      drainMs: Date.now() - drainStart,
      listenerUrl,
    },
  });
}

function percentile(xs: number[], p: number): number {
  if (!xs.length) return 0;
  const sorted = [...xs].sort((a, b) => a - b);
  return sorted[Math.floor((p / 100) * (sorted.length - 1))];
}

function finish(r: ScenarioResult): ScenarioResult {
  writeScenarioResult(r.name, r);
  return r;
}

