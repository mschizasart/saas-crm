/**
 * API load tests using autocannon.
 *
 * For each target endpoint we run a 30s-ish burst at ~10 concurrent
 * connections (≈100 RPS depending on latency) and assert p95 < 500ms.
 *
 * Returns a structured array of results so the dashboard parser can
 * render them.
 */
import autocannon from 'autocannon';
import { API_URL, SMOKE_TOKEN } from '../smoke/config.js';

export interface PerfResult {
  url: string;
  name: string;
  passed: boolean;
  threshold: number;
  p95: number;
  p99: number;
  rps: number;
  durationMs: number;
  failure?: string;
}

const TARGETS = [
  '/api/v1/clients',
  '/api/v1/leads',
  '/api/v1/invoices',
  '/api/v1/tickets',
  '/api/v1/products',
];

const DEFAULT_OPTS = {
  connections: Number(process.env.PERF_CONNECTIONS ?? 10),
  duration: Number(process.env.PERF_DURATION_S ?? 30),
  pipelining: 1,
};

const P95_THRESHOLD_MS = Number(process.env.PERF_P95_MS ?? 500);

export async function runApiLoad(): Promise<PerfResult[]> {
  const out: PerfResult[] = [];
  for (const path of TARGETS) {
    const url = `${API_URL}${path}`;
    const t0 = Date.now();
    let res: any;
    try {
      res = await autocannon({
        url,
        ...DEFAULT_OPTS,
        headers: SMOKE_TOKEN ? { authorization: `Bearer ${SMOKE_TOKEN}` } : {},
        // autocannon types want exactly these keys
      } as any);
    } catch (e) {
      out.push({
        url,
        name: path,
        passed: false,
        threshold: P95_THRESHOLD_MS,
        p95: 0,
        p99: 0,
        rps: 0,
        durationMs: Date.now() - t0,
        failure: (e as Error).message,
      });
      continue;
    }
    const p95 = res.latency?.p95 ?? 0;
    const p99 = res.latency?.p99 ?? 0;
    const rps = res.requests?.average ?? 0;
    out.push({
      url,
      name: path,
      passed: p95 > 0 && p95 < P95_THRESHOLD_MS,
      threshold: P95_THRESHOLD_MS,
      p95,
      p99,
      rps,
      durationMs: Date.now() - t0,
      failure: p95 >= P95_THRESHOLD_MS ? `p95 ${p95}ms >= ${P95_THRESHOLD_MS}ms threshold` : undefined,
    });
  }
  return out;
}
