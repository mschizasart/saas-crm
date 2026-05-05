/**
 * Stress-suite driver.
 *
 * Runs each scenario sequentially (NOT in parallel — many of them
 * intentionally saturate one subsystem; running concurrently would
 * pollute each other's measurements).
 *
 * Writes:
 *   - test/results/stress-<scenario>.json   one per scenario (the scenario itself writes this)
 *   - test/results/stress.json              unified rollup, in autocannon-shaped envelope
 *                                           so the runner's parseAutocannon picks it up.
 *
 * Honours STRESS_ONLY=name1,name2 to run a subset (handy in dev).
 */
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { STRESS_RESULTS_DIR } from './setup.js';
import type { ScenarioResult } from './setup.js';

import { run as bulkImportRace } from './bulk-import-race.test.js';
import { run as tenantIsolation } from './tenant-isolation-under-load.test.js';
import { run as bulkStatusRace } from './bulk-status-race.test.js';
import { run as queueSaturation } from './queue-saturation.test.js';
import { run as signedPdfStorm } from './signed-pdf-storm.test.js';
import { run as authBruteforce } from './auth-bruteforce.test.js';
import { run as paginationPollution } from './pagination-pollution.test.js';
import { run as stockDecrement } from './stock-decrement-concurrency.test.js';
import { run as webhookDeliveryStorm } from './webhook-delivery-storm.test.js';

interface ScenarioEntry {
  name: string;
  fn: () => Promise<ScenarioResult>;
}

const SCENARIOS: ScenarioEntry[] = [
  { name: 'bulk-import-race',          fn: bulkImportRace },
  { name: 'tenant-isolation-under-load', fn: tenantIsolation },
  { name: 'bulk-status-race',          fn: bulkStatusRace },
  { name: 'pagination-pollution',      fn: paginationPollution },
  { name: 'stock-decrement-concurrency', fn: stockDecrement },
  { name: 'auth-bruteforce',           fn: authBruteforce },
  { name: 'signed-pdf-storm',          fn: signedPdfStorm },
  { name: 'webhook-delivery-storm',    fn: webhookDeliveryStorm },
  // Saturation last — it leaves a lot of background work for the worker.
  { name: 'queue-saturation',          fn: queueSaturation },
];

async function main() {
  const onlyEnv = process.env.STRESS_ONLY;
  const allow = onlyEnv ? new Set(onlyEnv.split(',').map((s) => s.trim())) : null;
  const queue = SCENARIOS.filter((s) => !allow || allow.has(s.name));

  const results: ScenarioResult[] = [];
  for (const s of queue) {
    console.log(`\n▶ stress: ${s.name}`);
    const start = Date.now();
    let result: ScenarioResult;
    try {
      result = await s.fn();
    } catch (e) {
      result = {
        name: s.name,
        passed: false,
        failure: `Scenario threw: ${(e as Error).stack ?? (e as Error).message}`,
        startedAt: new Date(start).toISOString(),
        finishedAt: new Date().toISOString(),
        durationMs: Date.now() - start,
      };
    }
    results.push(result);
    const tag = result.skipped ? 'SKIP' : result.passed ? 'PASS' : 'FAIL';
    const tail = result.failure ? ` — ${result.failure}` : result.skipReason ? ` — ${result.skipReason}` : '';
    console.log(`  [${tag}] ${result.name} (${result.durationMs}ms)${tail}`);
  }

  // Unified rollup in autocannon-envelope shape so parseAutocannon can read it.
  const rollup = {
    suite: 'stress',
    generatedAt: new Date().toISOString(),
    results: results.map((r) => ({
      name: r.name,
      url: `${r.name}`,
      // Skipped scenarios count as 'passed' in the dashboard rollup so a
      // missing dev env doesn't paint the whole suite red. The skipReason
      // is preserved in the metrics for visibility.
      passed: !!r.passed || !!r.skipped,
      threshold: 0,
      p95: Number((r.metrics as any)?.ackP95Ms ?? (r.metrics as any)?.p95Ms ?? 0),
      p99: 0,
      rps: 0,
      durationMs: r.durationMs,
      failure: r.failure ?? (r.skipped ? `SKIPPED: ${r.skipReason}` : undefined),
      skipped: r.skipped,
      metrics: r.metrics,
    })),
  };
  writeFileSync(join(STRESS_RESULTS_DIR, 'stress.json'), JSON.stringify(rollup, null, 2));

  const failed = results.filter((r) => !r.passed && !r.skipped);
  const summary = `${results.length - failed.length}/${results.length} scenarios passed (${failed.length} failed)`;
  console.log(`\n=== STRESS: ${summary} ===`);
  if (failed.length > 0) process.exit(1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
