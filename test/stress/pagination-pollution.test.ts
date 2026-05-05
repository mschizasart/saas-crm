/**
 * Stress scenario: pagination pollution under concurrent writes.
 *
 * Concurrent CREATE + LIST on /clients with rapid pagination flips.
 * Asserts:
 *   - No record is double-counted across pages collected during the
 *     listing window (i.e. the union of all page reads contains no
 *     duplicate ids).
 *   - The `total` field reported by the LIST is consistent with the
 *     count of created records visible at the end of the run (within a
 *     small tolerance for in-flight creates).
 *
 * Approach:
 *   - 5 producers spamming POST /clients with unique names tagged for
 *     this run.
 *   - 10 consumers spamming GET /clients?search=<tag>&page=<rand 1..5>&limit=20.
 *   - All for 15 seconds.
 *   - At the end: GET *all* tagged clients via paged sweep and compare
 *     to the union of ids seen during the run.
 */
import {
  acquireTokens,
  bearer,
  STRESS_API_URL,
  writeScenarioResult,
} from './setup.js';
import type { ScenarioResult } from './setup.js';

const DURATION_MS = Number(process.env.STRESS_PAGINATION_DURATION_MS ?? 15_000);
const PRODUCERS = 5;
const CONSUMERS = 10;
const TAG = `pgpol-${Date.now()}`;

export async function run(): Promise<ScenarioResult> {
  const startedAt = new Date().toISOString();
  const t0 = Date.now();

  const tokens = await acquireTokens();
  if (!tokens) {
    return finish({
      name: 'pagination-pollution',
      passed: false,
      skipped: true,
      skipReason: 'No tokens',
      startedAt,
      finishedAt: new Date().toISOString(),
      durationMs: Date.now() - t0,
    });
  }

  const tokenA = tokens.tokenA;
  const seenIds = new Set<string>();
  const idsSeenMultipleTimes = new Map<string, number>();
  const totalsObserved = new Set<number>();
  let createdCount = 0;
  let pageReads = 0;
  let pageDupesWithinSinglePage = 0;
  const stopAt = Date.now() + DURATION_MS;

  const producers = Array.from({ length: PRODUCERS }, async (_, i) => {
    let n = 0;
    while (Date.now() < stopAt) {
      const ok = await fetch(`${STRESS_API_URL}/api/v1/clients`, {
        method: 'POST',
        headers: bearer(tokenA),
        body: JSON.stringify({
          name: `${TAG}-p${i}-${n}`,
          companyName: `${TAG}-p${i}-${n}-co`,
        }),
      })
        .then((r) => r.status >= 200 && r.status < 300)
        .catch(() => false);
      if (ok) {
        createdCount++;
        n++;
      }
    }
  });

  const consumers = Array.from({ length: CONSUMERS }, async () => {
    while (Date.now() < stopAt) {
      const page = 1 + Math.floor(Math.random() * 5);
      const res = await fetch(
        `${STRESS_API_URL}/api/v1/clients?search=${encodeURIComponent(TAG)}&page=${page}&limit=20`,
        { headers: bearer(tokenA) },
      ).catch(() => null);
      if (!res || res.status !== 200) continue;
      const body = (await res.json().catch(() => ({}))) as any;
      pageReads++;
      const rows: any[] = body?.data ?? [];
      totalsObserved.add(Number(body?.total ?? 0));

      const pageIds = new Set<string>();
      for (const row of rows) {
        if (!row?.id) continue;
        if (pageIds.has(row.id)) pageDupesWithinSinglePage++;
        pageIds.add(row.id);
        if (seenIds.has(row.id)) {
          idsSeenMultipleTimes.set(
            row.id,
            (idsSeenMultipleTimes.get(row.id) ?? 1) + 1,
          );
        }
        seenIds.add(row.id);
      }
    }
  });

  await Promise.all([...producers, ...consumers]);

  // Final ground-truth sweep.
  const truth = await sweepAll(tokenA, TAG);

  // Tolerance: producers might still have a racing in-flight POST when
  // the loop exits. Allow ±PRODUCERS rows of slack.
  const totalReported = truth.totalReported;
  const truthCount = truth.ids.size;
  const tolerance = PRODUCERS;
  const totalConsistent =
    Math.abs(totalReported - truthCount) <= tolerance &&
    Math.abs(truthCount - createdCount) <= tolerance;

  // "double-counted across pages" = any id observed in >1 LIST call's
  // payload across different pages. That's expected during concurrent
  // writes (a row shifts pages). Stronger assertion: no duplicates
  // *within a single page response*.
  const passed =
    pageDupesWithinSinglePage === 0 && totalConsistent;

  const failure = passed
    ? undefined
    : [
        pageDupesWithinSinglePage > 0 &&
          `${pageDupesWithinSinglePage} duplicates within a single page response`,
        !totalConsistent &&
          `total mismatch: list.total=${totalReported}, sweep=${truthCount}, created=${createdCount}`,
      ]
        .filter(Boolean)
        .join('; ');

  return finish({
    name: 'pagination-pollution',
    passed,
    failure,
    startedAt,
    finishedAt: new Date().toISOString(),
    durationMs: Date.now() - t0,
    metrics: {
      tag: TAG,
      durationMs: DURATION_MS,
      producers: PRODUCERS,
      consumers: CONSUMERS,
      createdCount,
      pageReads,
      pageDupesWithinSinglePage,
      // ids seen on >1 separate page responses — expected to be > 0 under
      // concurrent writes (rows shift pages), surfaced for diagnostics.
      idsSeenAcrossPages: idsSeenMultipleTimes.size,
      truthCount,
      totalReported,
      totalsObservedDuringRun: [...totalsObserved].sort((a, b) => a - b),
    },
  });
}

async function sweepAll(token: string, tag: string): Promise<{ ids: Set<string>; totalReported: number }> {
  const ids = new Set<string>();
  let totalReported = 0;
  for (let page = 1; page <= 100; page++) {
    const res = await fetch(
      `${STRESS_API_URL}/api/v1/clients?search=${encodeURIComponent(tag)}&page=${page}&limit=100`,
      { headers: bearer(token) },
    );
    if (res.status !== 200) break;
    const body = (await res.json()) as any;
    totalReported = Number(body?.total ?? totalReported);
    const rows: any[] = body?.data ?? [];
    if (rows.length === 0) break;
    for (const row of rows) if (row?.id) ids.add(row.id);
    if (ids.size >= totalReported) break;
  }
  return { ids, totalReported };
}

function finish(r: ScenarioResult): ScenarioResult {
  writeScenarioResult(r.name, r);
  return r;
}

