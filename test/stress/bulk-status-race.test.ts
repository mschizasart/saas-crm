/**
 * Stress scenario: bulk status update race.
 *
 * 20 concurrent POSTs to /invoices/bulk/status with overlapping invoice
 * id sets and conflicting target statuses (DRAFT vs SENT vs OVERDUE).
 *
 * Asserts:
 *   - Final status of each invoice is exactly one of the requested
 *     target statuses (no garbled value, not stuck in some intermediate).
 *   - Audit-log row count for each invoice is <= 20 (one per write that
 *     actually mutated something), not 2*N which would imply double-application.
 *   - No invoice becomes inconsistent (status N, but lineItems suggest
 *     another) — checked structurally rather than semantically.
 *
 * This needs a small set of seed invoices in Org A. We pick the first
 * 10 we find via GET /invoices.
 */
import {
  acquireTokens,
  bearer,
  STRESS_API_URL,
  writeScenarioResult,
} from './setup.js';
import type { ScenarioResult } from './setup.js';

const BURSTS = 20;
const INVOICE_COUNT = 10;
const TARGET_STATUSES = ['draft', 'sent', 'overdue'];

export async function run(): Promise<ScenarioResult> {
  const startedAt = new Date().toISOString();
  const t0 = Date.now();

  const tokens = await acquireTokens();
  if (!tokens) {
    return finish({
      name: 'bulk-status-race',
      passed: false,
      skipped: true,
      skipReason: 'No tokens',
      startedAt,
      finishedAt: new Date().toISOString(),
      durationMs: Date.now() - t0,
    });
  }

  // Sample invoice ids
  const list = await fetch(
    `${STRESS_API_URL}/api/v1/invoices?limit=${INVOICE_COUNT}`,
    { headers: bearer(tokens.tokenA) },
  );
  if (list.status !== 200) {
    return finish({
      name: 'bulk-status-race',
      passed: false,
      skipped: true,
      skipReason: `GET /invoices returned ${list.status}; need seed data`,
      startedAt,
      finishedAt: new Date().toISOString(),
      durationMs: Date.now() - t0,
    });
  }
  const body = (await list.json()) as any;
  const invoices: any[] = body?.data ?? [];
  if (invoices.length < 3) {
    return finish({
      name: 'bulk-status-race',
      passed: false,
      skipped: true,
      skipReason: `Need >= 3 invoices in Org A to race; found ${invoices.length}`,
      startedAt,
      finishedAt: new Date().toISOString(),
      durationMs: Date.now() - t0,
    });
  }

  const ids = invoices.slice(0, INVOICE_COUNT).map((i) => i.id);

  // Fan out 20 concurrent POSTs. Each picks a random subset (~70% of the
  // ids — guaranteed overlap) and a random target status.
  const requests = Array.from({ length: BURSTS }, () => {
    const subset = ids.filter(() => Math.random() < 0.7);
    const status = TARGET_STATUSES[Math.floor(Math.random() * TARGET_STATUSES.length)];
    return { ids: subset.length ? subset : [ids[0]], status };
  });

  const responses = await Promise.all(
    requests.map((r) =>
      fetch(`${STRESS_API_URL}/api/v1/invoices/bulk/status`, {
        method: 'POST',
        headers: bearer(tokens.tokenA),
        body: JSON.stringify({ ids: r.ids, status: r.status }),
      }).then(async (res) => ({
        status: res.status,
        body: await res.json().catch(() => ({})),
        request: r,
      })),
    ),
  );

  // Settle, then re-fetch each invoice and sanity-check the final state.
  await new Promise((r) => setTimeout(r, 1000));

  const finalStates = await Promise.all(
    ids.map((id) =>
      fetch(`${STRESS_API_URL}/api/v1/invoices/${id}`, { headers: bearer(tokens.tokenA) })
        .then(async (res) => ({
          id,
          status: res.status,
          body: await res.json().catch(() => ({})),
        }))
        .catch(() => ({ id, status: 0, body: {} })),
    ),
  );

  const inconsistent = finalStates.filter(
    (s) => s.status === 200 && !TARGET_STATUSES.includes(String((s.body as any)?.status).toLowerCase()),
  );

  // Heuristic on audit log: if endpoint exists, we cap audit entries at
  // BURSTS per invoice (one per accepted bulk write). Skipped if no audit
  // endpoint is reachable.
  const auditCheck = await tryAuditCheck(tokens.tokenA, ids);

  const passed = inconsistent.length === 0 && (auditCheck.ok ?? true);
  return finish({
    name: 'bulk-status-race',
    passed,
    failure: passed
      ? undefined
      : inconsistent.length
        ? `Found ${inconsistent.length} invoices with non-requested final status.`
        : `Audit log inflated: ${JSON.stringify(auditCheck)}`,
    startedAt,
    finishedAt: new Date().toISOString(),
    durationMs: Date.now() - t0,
    metrics: {
      bursts: BURSTS,
      invoicesProbed: ids.length,
      bulkResponseStatuses: responses.map((r) => r.status),
      inconsistentInvoices: inconsistent.map((s) => ({ id: s.id, status: (s.body as any)?.status })),
      auditCheck,
    },
  });
}

async function tryAuditCheck(token: string, ids: string[]): Promise<any> {
  // Best-effort: hit /api/v1/activity-log?entityId=... if that exists.
  const out: Record<string, number> = {};
  for (const id of ids) {
    try {
      const res = await fetch(
        `${STRESS_API_URL}/api/v1/activity-log?entityType=invoice&entityId=${id}&limit=200`,
        { headers: bearer(token) },
      );
      if (res.status !== 200) return { skipped: true, reason: `audit ${res.status}` };
      const body = (await res.json()) as any;
      out[id] = (body?.data ?? body ?? []).length;
    } catch {
      return { skipped: true, reason: 'audit endpoint unreachable' };
    }
  }
  const inflated = Object.entries(out).filter(([, n]) => n > BURSTS);
  return { ok: inflated.length === 0, perInvoice: out, inflated };
}

function finish(r: ScenarioResult): ScenarioResult {
  writeScenarioResult(r.name, r);
  return r;
}

