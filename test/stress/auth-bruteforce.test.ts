/**
 * Stress scenario: auth bruteforce (rate-limit probe).
 *
 * 200 invalid-password POSTs to /auth/login from the same IP, all
 * targeting the same email. We expect at least the last 50 to be
 * rate-limited (HTTP 429) — a healthy throttle config is "5 per minute"
 * or similar.
 *
 * If every response is 401, there is NO rate limiting on the login
 * endpoint and this is a real security issue.
 *
 * Note: this scenario expects to FAIL on the current codebase — there is
 * no `@nestjs/throttler` import in apps/api/src/modules/auth/auth.controller.ts.
 * Failure here is informative.
 */
import { STRESS_API_URL, writeScenarioResult, fetchWithTimeout } from './setup.js';
import type { ScenarioResult } from './setup.js';

const ATTEMPTS = Number(process.env.STRESS_BRUTEFORCE_ATTEMPTS ?? 200);
const TARGET_EMAIL =
  process.env.STRESS_BRUTEFORCE_EMAIL ??
  `bruteforce-target-${Date.now()}@example.test`;

export async function run(): Promise<ScenarioResult> {
  const startedAt = new Date().toISOString();
  const t0 = Date.now();

  const statuses: number[] = [];

  // Sequential — we want the rate-limiter (if present) to actually clamp
  // down, not race-around-the-window.
  for (let i = 0; i < ATTEMPTS; i++) {
    try {
      const res = await fetchWithTimeout(
        `${STRESS_API_URL}/api/v1/auth/login`,
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            email: TARGET_EMAIL,
            password: `definitely-wrong-${i}`,
          }),
        },
        4000,
      );
      statuses.push(res.status);
    } catch {
      statuses.push(0);
    }
  }

  const last50 = statuses.slice(-50);
  const last50Throttled = last50.filter((s) => s === 429).length;
  const allCount = {
    ok: statuses.filter((s) => s >= 200 && s < 300).length,
    badCreds: statuses.filter((s) => s === 400 || s === 401 || s === 403).length,
    rateLimited: statuses.filter((s) => s === 429).length,
    serverError: statuses.filter((s) => s >= 500).length,
    network: statuses.filter((s) => s === 0).length,
  };

  const passed = last50Throttled >= 5; // very lax — even 5/50 means *something* throttles
  const failure = passed
    ? undefined
    : `Only ${last50Throttled}/50 of the trailing requests were 429 — auth/login is NOT rate-limited.`;

  return finish({
    name: 'auth-bruteforce',
    passed,
    failure,
    startedAt,
    finishedAt: new Date().toISOString(),
    durationMs: Date.now() - t0,
    metrics: {
      attempts: ATTEMPTS,
      targetEmail: TARGET_EMAIL,
      last50Throttled,
      counts: allCount,
      first10Statuses: statuses.slice(0, 10),
      last10Statuses: statuses.slice(-10),
    },
  });
}

function finish(r: ScenarioResult): ScenarioResult {
  writeScenarioResult(r.name, r);
  return r;
}

