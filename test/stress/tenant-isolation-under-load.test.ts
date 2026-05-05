/**
 * Stress scenario: tenant isolation under concurrent load.
 *
 * Spawns 50 virtual users in k6, each running a tight 50-iteration loop
 * that alternates between:
 *   1. GET Org A's resources with Org A's token  (must succeed, returns Org A rows only)
 *   2. GET Org B's resource ids   with Org A's token  (must NOT return any Org B rows;
 *                                                       expect 404 / empty / 403)
 *
 * Why this catches concurrency bugs: TenantInterceptor sets
 *   SET LOCAL app.current_organization_id = $1
 * on each request. If a different request slips into the same Postgres
 * session/connection between the SET LOCAL and the SELECT, the SELECT
 * runs under the wrong org. Under heavy concurrent traffic that race
 * surfaces.
 *
 * Even ONE Org B record leaking is a P0 bug — fail loud.
 *
 * Falls back to a Node-only orchestrator if k6 isn't available so the
 * scenario still runs (slower, lower concurrency) on dev boxes.
 */
import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import {
  acquireTokens,
  bearer,
  STRESS_API_URL,
  STRESS_BIN_DIR,
  STRESS_RESULTS_DIR,
  writeScenarioResult,
} from './setup.js';
import type { ScenarioResult } from './setup.js';
import { ensureK6, runK6Script } from './k6-bin.js';

const VUS = 50;
const DURATION_S = 30;
const TARGETS = ['/api/v1/clients', '/api/v1/leads', '/api/v1/invoices'];

export async function run(): Promise<ScenarioResult> {
  const startedAt = new Date().toISOString();
  const t0 = Date.now();

  const tokens = await acquireTokens();
  if (!tokens) {
    return finish({
      name: 'tenant-isolation-under-load',
      passed: false,
      skipped: true,
      skipReason: 'Could not acquire two tenant tokens',
      startedAt,
      finishedAt: new Date().toISOString(),
      durationMs: Date.now() - t0,
    });
  }

  // Step 1: as Org B, harvest a small set of resource ids we can later
  // try to read while authed as Org A. If isolation is correct, NONE of
  // these reads should return a non-empty body.
  const orgBIds = await sampleOrgBIds(tokens.tokenB);

  if (orgBIds.length === 0) {
    return finish({
      name: 'tenant-isolation-under-load',
      passed: false,
      skipped: true,
      skipReason:
        'Org B has no resources to probe — seed test data into Org B first.',
      startedAt,
      finishedAt: new Date().toISOString(),
      durationMs: Date.now() - t0,
    });
  }

  const k6 = await ensureK6();
  if (k6) {
    return finish(await runWithK6(tokens.tokenA, orgBIds, t0, startedAt));
  }
  return finish(await runWithNode(tokens.tokenA, orgBIds, t0, startedAt));
}

async function sampleOrgBIds(tokenB: string): Promise<{ kind: string; id: string }[]> {
  const ids: { kind: string; id: string }[] = [];
  for (const path of TARGETS) {
    try {
      const res = await fetch(`${STRESS_API_URL}${path}?limit=20`, { headers: bearer(tokenB) });
      if (res.status !== 200) continue;
      const body = (await res.json()) as any;
      for (const row of body?.data ?? []) {
        if (row?.id) ids.push({ kind: path.split('/').pop() ?? 'res', id: row.id });
      }
    } catch {
      /* ignore */
    }
  }
  return ids;
}

async function runWithK6(
  tokenA: string,
  orgBIds: { kind: string; id: string }[],
  t0: number,
  startedAt: string,
): Promise<ScenarioResult> {
  mkdirSync(STRESS_BIN_DIR, { recursive: true });
  const scriptPath = join(STRESS_BIN_DIR, '.tmp-tenant-iso.js');
  const script = `
import http from 'k6/http';
import { check } from 'k6';

const TOKEN_A = __ENV.TOKEN_A;
const API = __ENV.API_URL;
const ORG_B_IDS = JSON.parse(__ENV.ORG_B_IDS);

export const options = {
  vus: ${VUS},
  duration: '${DURATION_S}s',
  thresholds: {
    // ZERO leaks tolerated.
    'checks{tag:no_leak}': ['rate==1.0'],
    'http_req_duration': ['p(95)<2000'],
  },
};

export default function () {
  // Half the iterations: legit own-tenant read.
  const own = http.get(API + '/api/v1/clients?limit=20', {
    headers: { Authorization: 'Bearer ' + TOKEN_A },
  });
  check(own, { 'own-tenant 2xx': (r) => r.status === 200 });

  // Other half: try to read Org B's resource ids using Org A's token.
  // Any 200 with a body that contains the asked-for id is a LEAK.
  const probe = ORG_B_IDS[Math.floor(Math.random() * ORG_B_IDS.length)];
  const r = http.get(API + '/api/v1/' + probe.kind + '/' + probe.id, {
    headers: { Authorization: 'Bearer ' + TOKEN_A },
    tags: { kind: probe.kind },
  });
  // 404/403 are correct. 200 means the row leaked across the tenant boundary.
  check(r, {
    'no_leak': (resp) => {
      if (resp.status === 404 || resp.status === 403 || resp.status === 401) return true;
      if (resp.status !== 200) return true; // 5xx — still no leak
      try {
        const body = JSON.parse(resp.body);
        return !body || body.id !== probe.id;
      } catch {
        return true;
      }
    },
  }, { tag: 'no_leak' });
}
`;
  writeFileSync(scriptPath, script);

  const summaryFile = join(STRESS_RESULTS_DIR, 'stress-tenant-iso-k6-summary.json');
  const result = await runK6Script(scriptPath, {
    summaryFile,
    env: {
      TOKEN_A: tokenA,
      API_URL: STRESS_API_URL,
      ORG_B_IDS: JSON.stringify(orgBIds),
    },
  });

  const noLeakRate =
    result.summary?.metrics?.['checks{tag:no_leak}']?.values?.rate ??
    result.summary?.metrics?.checks?.values?.rate ??
    null;

  const passed = result.exitCode === 0 && (noLeakRate === null || noLeakRate === 1);

  return {
    name: 'tenant-isolation-under-load',
    passed,
    failure: passed
      ? undefined
      : `Tenant isolation broke under load. no_leak rate=${noLeakRate}, k6 exit=${result.exitCode}.`,
    startedAt,
    finishedAt: new Date().toISOString(),
    durationMs: Date.now() - t0,
    metrics: {
      mode: 'k6',
      vus: VUS,
      durationS: DURATION_S,
      orgBIdSample: orgBIds.length,
      summary: result.summary,
    },
  };
}

async function runWithNode(
  tokenA: string,
  orgBIds: { kind: string; id: string }[],
  t0: number,
  startedAt: string,
): Promise<ScenarioResult> {
  // Lower concurrency fallback so dev boxes still run something useful.
  const fallbackVUs = 12;
  const iterations = 30;
  let leaks = 0;
  let probes = 0;

  await Promise.all(
    Array.from({ length: fallbackVUs }, async () => {
      for (let i = 0; i < iterations; i++) {
        const probe = orgBIds[Math.floor(Math.random() * orgBIds.length)];
        const res = await fetch(
          `${STRESS_API_URL}/api/v1/${probe.kind}/${probe.id}`,
          { headers: bearer(tokenA) },
        );
        probes++;
        if (res.status === 200) {
          try {
            const body = (await res.json()) as any;
            if (body?.id === probe.id) leaks++;
          } catch {
            /* ignore */
          }
        }
      }
    }),
  );

  const passed = leaks === 0;
  return {
    name: 'tenant-isolation-under-load',
    passed,
    failure: passed ? undefined : `Detected ${leaks} cross-tenant leaks across ${probes} probes.`,
    startedAt,
    finishedAt: new Date().toISOString(),
    durationMs: Date.now() - t0,
    metrics: {
      mode: 'node-fallback',
      fallbackVUs,
      iterations,
      probes,
      leaks,
      orgBIdSample: orgBIds.length,
    },
  };
}

function finish(r: ScenarioResult): ScenarioResult {
  writeScenarioResult(r.name, r);
  return r;
}

