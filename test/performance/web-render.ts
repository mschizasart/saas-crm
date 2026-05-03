/**
 * Lightweight web-perf check: time end-to-end fetch of a few pages,
 * assert each completes under WEB_TTI_MS_THRESHOLD (default 2000ms).
 *
 * Intentionally NOT lighthouse — that needs Chrome and inflates scope.
 * For real lighthouse runs, wire `lighthouse-ci` into CI separately.
 */
import { WEB_URL } from '../smoke/config.js';
import type { PerfResult } from './api-load.js';

const TARGETS = ['/', '/login', '/dashboard'];
const WEB_TTI_MS_THRESHOLD = Number(process.env.WEB_TTI_MS ?? 2000);

export async function runWebRender(): Promise<PerfResult[]> {
  const results: PerfResult[] = [];
  for (const path of TARGETS) {
    const url = `${WEB_URL}${path}`;
    const t0 = Date.now();
    let ok = true;
    let failure: string | undefined;
    try {
      const ctrl = new AbortController();
      const t = setTimeout(() => ctrl.abort(), WEB_TTI_MS_THRESHOLD * 2);
      const res = await fetch(url, { signal: ctrl.signal, redirect: 'follow' });
      clearTimeout(t);
      // Read a chunk to actually wait for the body (TTI-ish).
      await res.text();
      if (res.status >= 500) {
        ok = false;
        failure = `HTTP ${res.status}`;
      }
    } catch (e) {
      ok = false;
      failure = (e as Error).message;
    }
    const elapsed = Date.now() - t0;
    results.push({
      url,
      name: `web ${path}`,
      passed: ok && elapsed < WEB_TTI_MS_THRESHOLD,
      threshold: WEB_TTI_MS_THRESHOLD,
      p95: elapsed,
      p99: elapsed,
      rps: 1000 / Math.max(1, elapsed),
      durationMs: elapsed,
      failure: !ok
        ? failure
        : elapsed >= WEB_TTI_MS_THRESHOLD
        ? `${elapsed}ms >= ${WEB_TTI_MS_THRESHOLD}ms threshold`
        : undefined,
    });
  }
  return results;
}
