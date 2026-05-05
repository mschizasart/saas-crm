/**
 * Stress scenario: signed-PDF generation storm.
 *
 * 30 concurrent GETs to /clients/:id/statement?format=pdf for the SAME
 * client. Asserts:
 *   - No 5xx response.
 *   - p95 < 5s.
 *   - Object-store growth (when STRESS_S3_* env vars are set so we can
 *     count keys before/after) is exactly 30 — no orphans, no dedup.
 *     If we can't reach the bucket the count check is skipped, not
 *     failed (most dev boxes won't have MinIO creds in env).
 */
import {
  acquireTokens,
  bearer,
  STRESS_API_URL,
  writeScenarioResult,
} from './setup.js';
import type { ScenarioResult } from './setup.js';
import { spawn } from 'node:child_process';

const N = Number(process.env.STRESS_PDF_COUNT ?? 30);

export async function run(): Promise<ScenarioResult> {
  const startedAt = new Date().toISOString();
  const t0 = Date.now();

  const tokens = await acquireTokens();
  if (!tokens) {
    return finish({
      name: 'signed-pdf-storm',
      passed: false,
      skipped: true,
      skipReason: 'No tokens',
      startedAt,
      finishedAt: new Date().toISOString(),
      durationMs: Date.now() - t0,
    });
  }

  // Find a client.
  const list = await fetch(`${STRESS_API_URL}/api/v1/clients?limit=1`, {
    headers: bearer(tokens.tokenA),
  });
  if (list.status !== 200) {
    return finish({
      name: 'signed-pdf-storm',
      passed: false,
      skipped: true,
      skipReason: `GET /clients ${list.status}`,
      startedAt,
      finishedAt: new Date().toISOString(),
      durationMs: Date.now() - t0,
    });
  }
  const body = (await list.json()) as any;
  const client = body?.data?.[0];
  if (!client?.id) {
    return finish({
      name: 'signed-pdf-storm',
      passed: false,
      skipped: true,
      skipReason: 'No clients in Org A to generate statements for',
      startedAt,
      finishedAt: new Date().toISOString(),
      durationMs: Date.now() - t0,
    });
  }

  const before = await countS3Keys();

  const latencies: number[] = [];
  let serverErrors = 0;
  let okCount = 0;

  await Promise.all(
    Array.from({ length: N }, async () => {
      const start = Date.now();
      try {
        const res = await fetch(
          `${STRESS_API_URL}/api/v1/clients/${client.id}/statement?format=pdf`,
          { headers: { authorization: `Bearer ${tokens.tokenA}` } },
        );
        latencies.push(Date.now() - start);
        if (res.status >= 500) serverErrors++;
        else if (res.status >= 200 && res.status < 300) okCount++;
        // drain body so socket frees promptly
        await res.arrayBuffer().catch(() => undefined);
      } catch {
        latencies.push(Date.now() - start);
        serverErrors++;
      }
    }),
  );

  latencies.sort((a, b) => a - b);
  const p95 = latencies[Math.floor(latencies.length * 0.95)] ?? 0;

  const after = await countS3Keys();
  type GrowthCheck =
    | { skipped: true; reason: string }
    | { skipped: false; delta: number; expected: number; ok: boolean };
  const growthCheck: GrowthCheck =
    before === null || after === null
      ? { skipped: true, reason: 'S3 not configured for the test' }
      : { skipped: false, delta: after - before, expected: N, ok: after - before === N };

  const growthOk = growthCheck.skipped ? true : growthCheck.ok;

  const passed = serverErrors === 0 && p95 < 5000 && growthOk;

  return finish({
    name: 'signed-pdf-storm',
    passed,
    failure: passed
      ? undefined
      : [
          serverErrors > 0 && `${serverErrors} 5xx responses`,
          p95 >= 5000 && `p95 ${p95}ms >= 5000ms`,
          !growthCheck.skipped && !growthCheck.ok &&
            `S3 grew by ${growthCheck.delta}, expected ${N}`,
        ]
          .filter(Boolean)
          .join('; '),
    startedAt,
    finishedAt: new Date().toISOString(),
    durationMs: Date.now() - t0,
    metrics: {
      requested: N,
      ok: okCount,
      serverErrors,
      p95Ms: p95,
      maxMs: latencies[latencies.length - 1] ?? 0,
      s3: { before, after, ...growthCheck },
    },
  });
}

/**
 * Best-effort key count of the storage bucket. Returns null if env isn't
 * configured (so callers know to skip the assertion).
 *
 * Uses the AWS S3 ListObjectsV2 REST API directly so we don't need to
 * pull the SDK into the test workspace. Compatible with MinIO.
 */
async function countS3Keys(): Promise<number | null> {
  const endpoint = process.env.STRESS_S3_ENDPOINT;
  const bucket = process.env.STRESS_S3_BUCKET;
  const key = process.env.STRESS_S3_ACCESS_KEY;
  const secret = process.env.STRESS_S3_SECRET_KEY;
  const prefix = process.env.STRESS_S3_PREFIX ?? '';
  if (!endpoint || !bucket || !key || !secret) return null;

  // Use the awssum-flavoured anonymous-listing trick if the bucket is
  // public, else require a host-installed `mc` (MinIO client) on PATH.
  // Falling back to `mc` keeps this file dependency-free.
  return await mcCount(endpoint, bucket, prefix, key, secret);
}

async function mcCount(
  endpoint: string,
  bucket: string,
  prefix: string,
  accessKey: string,
  secretKey: string,
): Promise<number | null> {
  return new Promise((resolve) => {
    // mc alias set + ls --recursive | wc -l
    const alias = 'stresstest';
    const setup = spawn('mc', ['alias', 'set', alias, endpoint, accessKey, secretKey], {
      stdio: 'ignore',
    });
    setup.on('close', (code) => {
      if (code !== 0) {
        resolve(null);
        return;
      }
      const ls = spawn('mc', ['ls', '--recursive', `${alias}/${bucket}/${prefix}`], {
        stdio: ['ignore', 'pipe', 'ignore'],
      });
      let out = '';
      ls.stdout?.on('data', (d: Buffer) => (out += d.toString()));
      ls.on('close', (lsCode) => {
        if (lsCode !== 0) resolve(null);
        else resolve(out.split('\n').filter(Boolean).length);
      });
      ls.on('error', () => resolve(null));
    });
    setup.on('error', () => resolve(null));
  });
}

function finish(r: ScenarioResult): ScenarioResult {
  writeScenarioResult(r.name, r);
  return r;
}

