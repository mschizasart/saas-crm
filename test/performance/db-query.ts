/**
 * Spot-check DB query plans: run EXPLAIN on a few hot queries and assert
 * no Seq Scan against multi-tenant tables (those must use the orgId index).
 *
 * Skips cleanly if no DB is reachable.
 */
import { Client } from 'pg';
import type { PerfResult } from './api-load.js';

interface QuerySpec {
  name: string;
  table: string; // multi-tenant table — Seq Scan is the failure signal
  sql: string;
  params: unknown[];
}

const TEST_ORG_ID = process.env.PERF_TEST_ORG_ID ?? '00000000-0000-0000-0000-000000000000';

const QUERIES: QuerySpec[] = [
  {
    name: 'invoices by org',
    table: 'invoices',
    sql: `SELECT * FROM "invoices" WHERE "organizationId" = $1 LIMIT 50`,
    params: [TEST_ORG_ID],
  },
  {
    name: 'clients by org',
    table: 'clients',
    sql: `SELECT * FROM "clients" WHERE "organizationId" = $1 LIMIT 50`,
    params: [TEST_ORG_ID],
  },
  {
    name: 'leads by org',
    table: 'leads',
    sql: `SELECT * FROM "leads" WHERE "organizationId" = $1 LIMIT 50`,
    params: [TEST_ORG_ID],
  },
];

export async function runDbQueryChecks(): Promise<PerfResult[]> {
  const url = process.env.DATABASE_URL ?? process.env.TEST_DATABASE_URL;
  if (!url) {
    return [
      {
        url: 'db',
        name: 'db EXPLAIN checks',
        passed: false,
        threshold: 0,
        p95: 0,
        p99: 0,
        rps: 0,
        durationMs: 0,
        failure: 'No DATABASE_URL or TEST_DATABASE_URL set — skipping',
      },
    ];
  }

  const client = new Client({ connectionString: url });
  try {
    await client.connect();
  } catch (e) {
    return [
      {
        url: 'db',
        name: 'db EXPLAIN checks',
        passed: false,
        threshold: 0,
        p95: 0,
        p99: 0,
        rps: 0,
        durationMs: 0,
        failure: `connect failed: ${(e as Error).message}`,
      },
    ];
  }

  const results: PerfResult[] = [];
  for (const q of QUERIES) {
    const t0 = Date.now();
    try {
      const r = await client.query(`EXPLAIN (FORMAT JSON) ${q.sql}`, q.params);
      const plan = (r.rows[0]?.['QUERY PLAN'] as any)?.[0]?.Plan ?? {};
      const seq = containsSeqScanOn(plan, q.table);
      results.push({
        url: q.table,
        name: q.name,
        passed: !seq,
        threshold: 0,
        p95: 0,
        p99: 0,
        rps: 0,
        durationMs: Date.now() - t0,
        failure: seq ? `Seq Scan on ${q.table} — multi-tenant table must use orgId index` : undefined,
      });
    } catch (e) {
      // Table doesn't exist (test DB pre-migration) — record but don't fail catastrophically.
      const msg = (e as Error).message;
      results.push({
        url: q.table,
        name: q.name,
        passed: false,
        threshold: 0,
        p95: 0,
        p99: 0,
        rps: 0,
        durationMs: Date.now() - t0,
        failure: `EXPLAIN failed: ${msg}`,
      });
    }
  }
  await client.end();
  return results;
}

function containsSeqScanOn(node: any, table: string): boolean {
  if (!node) return false;
  if (node['Node Type'] === 'Seq Scan' && node['Relation Name'] === table) return true;
  for (const child of node.Plans ?? []) {
    if (containsSeqScanOn(child, table)) return true;
  }
  return false;
}
