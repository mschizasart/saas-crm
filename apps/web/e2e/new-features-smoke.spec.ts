/**
 * new-features-smoke.spec.ts  @smoke
 *
 * Prod smoke coverage for recently-shipped endpoints (Sequences, Calling,
 * Dedup/Merge, Validation Rules, Booking Pages, Integration/Zapier API, plus
 * the public booking route and the Outlook add-in manifest).
 *
 * Read-only / non-destructive: GET requests only — no create/merge/delete of
 * real prod data. Mirrors the pattern in api-smoke.spec.ts:
 *   - Playwright `request` fixture (API-only, no browser).
 *   - Auth via getApiToken(request, email, password) or a pre-signed E2E_TOKEN.
 *   - Skips gracefully when no credentials/token are present so it doesn't
 *     hard-fail locally when secrets aren't set.
 *
 * Environment variables:
 *   E2E_EMAIL       — staff user email
 *   E2E_PASSWORD    — staff user password
 *   E2E_TOKEN       — pre-signed bearer token (skips login)
 *   E2E_API_URL     — override API base URL (default: https://api.appoinlycrm.net)
 *   E2E_BASE_URL    — override web app base URL (default: https://www.appoinlycrm.net)
 */

import { test, expect } from '@playwright/test';

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

const API_URL = process.env.E2E_API_URL ?? 'https://api.appoinlycrm.net';
const WEB_URL = process.env.E2E_BASE_URL ?? 'https://www.appoinlycrm.net';

// Authed GET endpoints for the recently-shipped features. Each must return 200
// with a valid staff token.
const AUTHED_ENDPOINTS: string[] = [
  // Sequences
  '/api/v1/sequences',

  // Calling (pagination path regressed before — assert 200)
  '/api/v1/calls?page=1&limit=5',
  '/api/v1/calls/settings',

  // Dedup / Merge (candidate discovery only — read-only)
  '/api/v1/dedup/leads/candidates?threshold=0.8&limit=5',
  '/api/v1/dedup/clients/candidates?threshold=0.8&limit=5',

  // Validation Rules
  '/api/v1/validation-rules?fieldTo=lead',

  // Booking Pages
  '/api/v1/booking-pages',

  // Integration / Zapier API
  '/api/v1/integration/scopes',
  '/api/v1/integration/events',
  '/api/v1/integration/me',
];

// ---------------------------------------------------------------------------
// Auth helper (same shape as api-smoke.spec.ts)
// ---------------------------------------------------------------------------

interface AuthResult {
  token: string;
  apiUrl: string;
}

async function getApiToken(
  request: import('@playwright/test').APIRequestContext,
  email: string,
  password: string,
): Promise<AuthResult> {
  const apiUrl = API_URL;

  const res = await request.post(`${apiUrl}/api/v1/auth/login`, {
    data: { email, password },
  });

  if (!res.ok()) {
    throw new Error(
      `Login failed: HTTP ${res.status()} — check E2E_EMAIL / E2E_PASSWORD`,
    );
  }

  const body = await res.json();

  if (!body.accessToken) {
    throw new Error(
      `Login response did not contain accessToken. Body: ${JSON.stringify(body)}`,
    );
  }

  return { token: body.accessToken as string, apiUrl };
}

/**
 * Resolve a bearer token from E2E_TOKEN or E2E_EMAIL/E2E_PASSWORD.
 * Returns null when no credentials are configured, so callers can skip
 * gracefully instead of hard-failing (matches api-smoke's env handling).
 *
 * The result is cached per worker process so we only hit /auth/login once
 * instead of once per endpoint check — this keeps the suite fast and avoids
 * hammering the login endpoint (which can throttle under a burst of parallel
 * logins).
 */
let cachedTokenPromise: Promise<string | null> | undefined;

async function resolveToken(
  request: import('@playwright/test').APIRequestContext,
): Promise<string | null> {
  if (cachedTokenPromise) return cachedTokenPromise;

  cachedTokenPromise = (async () => {
    const preSignedToken = process.env.E2E_TOKEN;
    if (preSignedToken) return preSignedToken;

    const email = process.env.E2E_EMAIL;
    const password = process.env.E2E_PASSWORD;
    if (!email || !password) return null;

    const auth = await getApiToken(request, email, password);
    return auth.token;
  })();

  return cachedTokenPromise;
}

// ---------------------------------------------------------------------------
// Authed smoke suite
// ---------------------------------------------------------------------------

test.describe('@smoke new-features authed GET endpoints return 200', () => {
  test.describe.configure({ mode: 'parallel', timeout: 30_000 });

  for (const path of AUTHED_ENDPOINTS) {
    test(`GET ${path} returns 200`, async ({ request }) => {
      const token = await resolveToken(request);
      test.skip(
        token === null,
        'No credentials configured (set E2E_TOKEN, or E2E_EMAIL + E2E_PASSWORD)',
      );

      const res = await request.get(`${API_URL}${path}`, {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });

      expect(
        res.status(),
        `GET ${path} returned HTTP ${res.status()}`,
      ).toBe(200);
    });
  }
});

// ---------------------------------------------------------------------------
// Public (no-auth) smoke suite
// ---------------------------------------------------------------------------

test.describe('@smoke new-features public endpoints', () => {
  test.describe.configure({ mode: 'parallel', timeout: 30_000 });

  // The public booking route exists but the slug/page don't, so it should
  // return 404 (route matched) rather than 401 (auth wall). No token needed.
  test('GET /api/v1/public/booking/nonexistent/none returns 404', async ({
    request,
  }) => {
    const res = await request.get(
      `${API_URL}/api/v1/public/booking/nonexistent/none`,
    );
    expect(
      res.status(),
      `Expected 404 (route exists, not 401). Got HTTP ${res.status()}`,
    ).toBe(404);
  });

  // The public booking page on the web app should render (200) even for an
  // unknown slug — it's the client app shell.
  test('GET web /book/x/y page returns 200', async ({ request }) => {
    const res = await request.get(`${WEB_URL}/book/x/y`);
    expect(
      res.status(),
      `GET ${WEB_URL}/book/x/y returned HTTP ${res.status()}`,
    ).toBe(200);
  });

  // The Outlook add-in manifest must be served from the web origin.
  test('GET web /outlook-manifest.xml returns 200', async ({ request }) => {
    const res = await request.get(`${WEB_URL}/outlook-manifest.xml`);
    expect(
      res.status(),
      `GET ${WEB_URL}/outlook-manifest.xml returned HTTP ${res.status()}`,
    ).toBe(200);
  });
});
