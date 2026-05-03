/**
 * Performance entry point. Runs api-load + web-render + db-query and
 * writes a single JSON file in the autocannon-shaped envelope expected by
 * runner/parsers.ts (`parseAutocannon`).
 */
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { runApiLoad } from './api-load.js';
import { runWebRender } from './web-render.js';
import { runDbQueryChecks } from './db-query.js';

const REPO_ROOT = process.env.REPO_ROOT || '/home/marios/Documents/Project/saas-crm';
const OUT = join(REPO_ROOT, 'test/results/performance.json');

async function main() {
  console.log('Running API load tests…');
  const api = await runApiLoad();

  console.log('Running web render tests…');
  const web = await runWebRender();

  console.log('Running DB query EXPLAIN checks…');
  const db = await runDbQueryChecks();

  const all = [...api, ...web, ...db];

  mkdirSync(dirname(OUT), { recursive: true });
  writeFileSync(OUT, JSON.stringify({ results: all }, null, 2));

  for (const r of all) {
    const tag = r.passed ? 'PASS' : 'FAIL';
    console.log(`  [${tag}] ${r.name} — p95=${r.p95}ms ${r.failure ? `(${r.failure})` : ''}`);
  }

  const failed = all.filter((r) => !r.passed).length;
  if (failed > 0) process.exit(1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
