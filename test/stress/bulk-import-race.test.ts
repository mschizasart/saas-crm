/**
 * Stress scenario: bulk-import race.
 *
 * Goal: prove the /clients/import endpoint deduplicates correctly when
 * the *same* CSV is uploaded by 10 concurrent callers from the same
 * tenant. After the dust settles the live count should be exactly the
 * number of unique rows in the source CSV (here: 100), with no
 * duplicate companyName entries.
 *
 * If we observe N copies of the same client, the importer is racing —
 * either it's not using a transactional upsert path, or its uniqueness
 * check is "select-then-insert" without a unique constraint behind it.
 */
import { acquireTokens, bearer, STRESS_API_URL, writeScenarioResult } from './setup.js';
import type { ScenarioResult } from './setup.js';

const PARALLELISM = 10;
const ROWS = 100;
const NAME_PREFIX = `stress-import-${Date.now()}`;

function buildCsv(): string {
  const header = 'name,email,phone,company,country';
  const lines = [header];
  for (let i = 0; i < ROWS; i++) {
    lines.push(
      `${NAME_PREFIX}-${i},stress+${NAME_PREFIX}-${i}@example.test,+30210000${i
        .toString()
        .padStart(4, '0')},${NAME_PREFIX}-co-${i},GR`,
    );
  }
  return lines.join('\n');
}

async function uploadCsv(token: string, csv: string): Promise<{ status: number; body: any }> {
  // Multipart body with a single 'file' part.
  const boundary = '----stress' + Math.random().toString(16).slice(2);
  const body = Buffer.concat([
    Buffer.from(
      `--${boundary}\r\n` +
        `Content-Disposition: form-data; name="file"; filename="clients.csv"\r\n` +
        `Content-Type: text/csv\r\n\r\n`,
      'utf8',
    ),
    Buffer.from(csv, 'utf8'),
    Buffer.from(`\r\n--${boundary}--\r\n`, 'utf8'),
  ]);
  const res = await fetch(`${STRESS_API_URL}/api/v1/clients/import`, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${token}`,
      'content-type': `multipart/form-data; boundary=${boundary}`,
      'content-length': String(body.length),
    },
    body,
  });
  let parsed: any = null;
  try {
    parsed = await res.json();
  } catch {
    /* ignore */
  }
  return { status: res.status, body: parsed };
}

async function listAll(token: string, search: string): Promise<any[]> {
  const items: any[] = [];
  // Paginate through any matching clients. Use a generous limit.
  for (let page = 1; page <= 20; page++) {
    const res = await fetch(
      `${STRESS_API_URL}/api/v1/clients?search=${encodeURIComponent(search)}&page=${page}&limit=200`,
      { headers: bearer(token) },
    );
    if (res.status !== 200) break;
    const body = (await res.json()) as any;
    const rows = body?.data ?? [];
    items.push(...rows);
    const total = body?.total ?? items.length;
    if (items.length >= total) break;
  }
  return items;
}

export async function run(): Promise<ScenarioResult> {
  const startedAt = new Date().toISOString();
  const t0 = Date.now();

  const tokens = await acquireTokens();
  if (!tokens) {
    return finish({
      name: 'bulk-import-race',
      passed: false,
      skipped: true,
      skipReason: 'Could not acquire tokens (API down or creds missing)',
      startedAt,
      finishedAt: new Date().toISOString(),
      durationMs: Date.now() - t0,
    });
  }

  const csv = buildCsv();

  // 10 concurrent uploads of the same body.
  const uploads = await Promise.all(
    Array.from({ length: PARALLELISM }, () => uploadCsv(tokens.tokenA, csv)),
  );

  const okUploads = uploads.filter((u) => u.status >= 200 && u.status < 300).length;

  // Give the importer a moment to settle (some flows are queue-backed).
  await new Promise((r) => setTimeout(r, 1500));

  const after = await listAll(tokens.tokenA, NAME_PREFIX);
  const distinctCompanies = new Set(after.map((c) => c.companyName ?? c.company ?? c.name));

  const expectedRows = ROWS;
  const passed =
    after.length === expectedRows &&
    distinctCompanies.size === expectedRows;

  const failure = passed
    ? undefined
    : `Expected ${expectedRows} unique clients after ${PARALLELISM}× import; got ${after.length} ` +
      `(${distinctCompanies.size} distinct companies).`;

  return finish({
    name: 'bulk-import-race',
    passed,
    failure,
    startedAt,
    finishedAt: new Date().toISOString(),
    durationMs: Date.now() - t0,
    metrics: {
      parallelUploads: PARALLELISM,
      successfulUploads: okUploads,
      uploadStatuses: uploads.map((u) => u.status),
      finalClientCount: after.length,
      distinctCompanies: distinctCompanies.size,
      expected: expectedRows,
    },
  });
}

function finish(r: ScenarioResult): ScenarioResult {
  writeScenarioResult(r.name, r);
  return r;
}

