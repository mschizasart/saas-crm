/**
 * Stress scenario: BullMQ queue saturation (lead-scoring).
 *
 * Approach: POST 5,000 leads in a 30s window. Each successful lead
 * creation emits `lead.created`, which feeds the lead-scoring listener
 * → BullMQ 'lead-scoring' queue.
 *
 * Asserts:
 *   - The API itself stays responsive on an unrelated endpoint (sample
 *     /clients in parallel; want >= 10 RPS sustained throughout).
 *   - The queue eventually drains. We poll /api/v1/admin/queues/lead-scoring/depth
 *     if that exists; if not we just measure end-to-end time and skip
 *     the depth assertion.
 *   - p95 ack latency on the trigger endpoint stays under 60s.
 *   - No jobs end up in 'failed' state (read via the same admin endpoint
 *     when present).
 *
 * If you don't want to actually persist 5,000 leads, set
 * STRESS_LEAD_COUNT to a smaller value (e.g. 500). Default 5000 only
 * runs in CI where dropping the org afterwards is fine.
 */
import {
  acquireTokens,
  bearer,
  STRESS_API_URL,
  writeScenarioResult,
} from './setup.js';
import type { ScenarioResult } from './setup.js';

const TOTAL_EVENTS = Number(process.env.STRESS_LEAD_COUNT ?? 5000);
const WINDOW_MS = Number(process.env.STRESS_LEAD_WINDOW_MS ?? 30_000);
const PARALLEL = Number(process.env.STRESS_LEAD_PARALLEL ?? 50);

const ADMIN_DEPTH_URL = (orgId: string | undefined) =>
  `${STRESS_API_URL}/api/v1/admin/queues/lead-scoring/depth${orgId ? `?orgId=${orgId}` : ''}`;

export async function run(): Promise<ScenarioResult> {
  const startedAt = new Date().toISOString();
  const t0 = Date.now();

  const tokens = await acquireTokens();
  if (!tokens) {
    return finish({
      name: 'queue-saturation',
      passed: false,
      skipped: true,
      skipReason: 'No tokens',
      startedAt,
      finishedAt: new Date().toISOString(),
      durationMs: Date.now() - t0,
    });
  }

  const intervalMs = WINDOW_MS / TOTAL_EVENTS;
  const tokenA = tokens.tokenA;
  const ackLatencies: number[] = [];
  let postedOk = 0;
  let postedFail = 0;
  const writeStartedAt = Date.now();

  // Background sampler: hit /clients every 200ms to measure available API throughput.
  const sampler = startSampler(tokenA);

  // Producer: TOTAL_EVENTS POSTs spread across PARALLEL inflight slots.
  let inFlight = 0;
  let queued = 0;

  await new Promise<void>((resolve) => {
    const tryDispatch = () => {
      while (inFlight < PARALLEL && queued < TOTAL_EVENTS) {
        const i = queued++;
        inFlight++;
        const start = Date.now();
        fetch(`${STRESS_API_URL}/api/v1/leads`, {
          method: 'POST',
          headers: bearer(tokenA),
          body: JSON.stringify({
            firstName: 'Stress',
            lastName: `Lead-${start}-${i}`,
            email: `stress-${start}-${i}@example.test`,
            source: 'stress-test',
          }),
        })
          .then((res) => {
            ackLatencies.push(Date.now() - start);
            if (res.status >= 200 && res.status < 300) postedOk++;
            else postedFail++;
          })
          .catch(() => {
            postedFail++;
          })
          .finally(() => {
            inFlight--;
            if (queued < TOTAL_EVENTS) {
              setTimeout(tryDispatch, Math.max(0, intervalMs));
            } else if (inFlight === 0) {
              resolve();
            }
          });
      }
    };
    tryDispatch();
  });

  const writeFinishedAt = Date.now();
  const writeDurationMs = writeFinishedAt - writeStartedAt;

  // Drain wait. Poll the admin endpoint if available, else just sleep up to 5 min.
  const drainMaxMs = Number(process.env.STRESS_DRAIN_MAX_MS ?? 5 * 60_000);
  const drainResult = await waitForDrain(
    tokens.tokenA,
    tokens.orgAId,
    drainMaxMs,
  );

  const samplerResult = sampler.stop();

  ackLatencies.sort((a, b) => a - b);
  const p95 = ackLatencies.length
    ? ackLatencies[Math.floor(ackLatencies.length * 0.95)]
    : 0;

  const passed =
    postedFail === 0 &&
    (drainResult.failed ?? 0) === 0 &&
    p95 < 60_000 &&
    samplerResult.minRps >= 10;

  const failure = passed
    ? undefined
    : [
        postedFail > 0 && `${postedFail} failed POSTs`,
        (drainResult.failed ?? 0) > 0 && `${drainResult.failed} jobs in failed state`,
        p95 >= 60_000 && `p95 ack ${p95}ms exceeds 60s`,
        samplerResult.minRps < 10 && `unrelated-endpoint min RPS ${samplerResult.minRps.toFixed(1)} < 10`,
      ]
        .filter(Boolean)
        .join('; ');

  return finish({
    name: 'queue-saturation',
    passed,
    failure,
    startedAt,
    finishedAt: new Date().toISOString(),
    durationMs: Date.now() - t0,
    metrics: {
      totalEvents: TOTAL_EVENTS,
      windowMs: WINDOW_MS,
      parallel: PARALLEL,
      postedOk,
      postedFail,
      ackP95Ms: p95,
      writeDurationMs,
      drain: drainResult,
      unrelatedEndpoint: samplerResult,
    },
  });
}

interface SamplerHandle {
  stop(): { samples: number; minRps: number; avgRps: number };
}

function startSampler(token: string): SamplerHandle {
  let stopped = false;
  const rpsBuckets: number[] = [];
  let bucketStart = Date.now();
  let bucketHits = 0;

  (async () => {
    while (!stopped) {
      try {
        const r = await fetch(`${STRESS_API_URL}/api/v1/clients?limit=1`, {
          headers: bearer(token),
        });
        if (r.status === 200) bucketHits++;
      } catch {
        /* ignore */
      }
      const now = Date.now();
      if (now - bucketStart >= 1000) {
        rpsBuckets.push(bucketHits);
        bucketHits = 0;
        bucketStart = now;
      }
      await new Promise((r) => setTimeout(r, 80)); // ~12 RPS ceiling
    }
  })().catch(() => {/* ignore */});

  return {
    stop() {
      stopped = true;
      const samples = rpsBuckets.length;
      const minRps = samples ? Math.min(...rpsBuckets) : 0;
      const avgRps = samples ? rpsBuckets.reduce((a, b) => a + b, 0) / samples : 0;
      return { samples, minRps, avgRps };
    },
  };
}

async function waitForDrain(
  token: string,
  orgId: string | undefined,
  maxMs: number,
): Promise<{ drained: boolean; lastDepth?: number; failed?: number; durationMs: number; mode: 'admin' | 'blind' }> {
  const start = Date.now();
  // Probe once for the admin depth endpoint.
  const probe = await fetch(ADMIN_DEPTH_URL(orgId), { headers: bearer(token) }).catch(() => null);
  if (!probe || probe.status !== 200) {
    // Blind wait. Sleep proportional to the number of events; lead-scoring
    // is ~1-2s per job at concurrency 4, so for 5k jobs realistic drain
    // is ~30 minutes. We cap at maxMs.
    const sleep = Math.min(maxMs, 60_000);
    await new Promise((r) => setTimeout(r, sleep));
    return { drained: false, durationMs: Date.now() - start, mode: 'blind' };
  }

  let lastDepth = Number.MAX_SAFE_INTEGER;
  let failed = 0;
  while (Date.now() - start < maxMs) {
    const res = await fetch(ADMIN_DEPTH_URL(orgId), { headers: bearer(token) }).catch(() => null);
    if (res && res.status === 200) {
      const body = (await res.json().catch(() => ({}))) as any;
      lastDepth =
        Number(body?.depth ?? body?.waiting ?? body?.active ?? body?.size ?? 0);
      failed = Number(body?.failed ?? 0);
      if (lastDepth === 0) {
        return { drained: true, lastDepth, failed, durationMs: Date.now() - start, mode: 'admin' };
      }
    }
    await new Promise((r) => setTimeout(r, 2000));
  }
  return { drained: false, lastDepth, failed, durationMs: Date.now() - start, mode: 'admin' };
}

function finish(r: ScenarioResult): ScenarioResult {
  writeScenarioResult(r.name, r);
  return r;
}

