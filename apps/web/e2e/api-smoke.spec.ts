/**
 * api-smoke.spec.ts  @smoke
 *
 * Broad smoke test: call every GET endpoint and assert a 2xx response.
 * Uses Playwright's `request` context — no browser, no page navigation.
 * One token is obtained at the start of the describe block and reused for all
 * endpoint checks, so the suite is fast even with many routes.
 *
 * Skip during deep-test iteration:
 *   pnpm e2e --grep-invert @smoke
 *
 * Environment variables (same as the rest of the e2e suite):
 *   E2E_EMAIL       — staff user email
 *   E2E_PASSWORD    — staff user password
 *   E2E_API_URL     — override API base URL (default: https://api.appoinlycrm.net)
 */

import { test, expect } from '@playwright/test';

// ---------------------------------------------------------------------------
// Endpoint list
// ---------------------------------------------------------------------------

/**
 * Each entry is either a plain path string (the check is just status 2xx) or
 * a tuple [path, expectDataKey] where `expectDataKey` is:
 *   - 'data'  → assert body.data exists
 *   - 'array' → assert the body itself is an array
 *   - null    → only assert 2xx (no body shape assertion)
 */
type Endpoint =
  | string
  | [path: string, shape: 'data' | 'array' | null];

const API_ENDPOINTS: Endpoint[] = [
  // Auth
  ['/api/v1/auth/me', null],

  // Clients
  ['/api/v1/clients?limit=5', 'data'],
  ['/api/v1/clients/health-scores', null],

  // Leads
  ['/api/v1/leads?limit=5', 'data'],
  ['/api/v1/leads/kanban', null],

  // Invoices
  ['/api/v1/invoices?limit=5', 'data'],
  ['/api/v1/invoices?recurring=true&limit=5', 'data'],

  // Estimates
  ['/api/v1/estimates?limit=5', 'data'],

  // Proposals
  ['/api/v1/proposals?limit=5', 'data'],

  // Contracts
  ['/api/v1/contracts?limit=5', 'data'],

  // Credit Notes
  ['/api/v1/credit-notes?limit=5', 'data'],

  // Payments
  ['/api/v1/payments?limit=5', 'data'],

  // Expenses
  ['/api/v1/expenses?limit=5', 'data'],
  ['/api/v1/expenses/categories', null],

  // Subscriptions
  ['/api/v1/subscriptions?limit=5', 'data'],

  // Projects
  ['/api/v1/projects?limit=5', 'data'],

  // Tasks
  ['/api/v1/tasks?limit=5', 'data'],

  // Tickets
  ['/api/v1/tickets?limit=5', 'data'],

  // Users / Staff
  ['/api/v1/users?limit=5', 'data'],
  ['/api/v1/users/permissions/catalog', null],

  // Roles
  ['/api/v1/roles', null],

  // Announcements
  ['/api/v1/announcements/active?audience=staff', null],
  ['/api/v1/announcements/history?audience=staff', null],

  // Misc lookups
  ['/api/v1/tags', null],
  ['/api/v1/webhooks', null],
  ['/api/v1/api-keys', null],
  ['/api/v1/automations', null],

  // Calendar
  ['/api/v1/calendar/events?from=2026-04-01&to=2026-04-30', null],

  // Activity / Notifications
  ['/api/v1/activity-log?limit=5', 'data'],
  ['/api/v1/notifications?limit=5', 'data'],

  // Suggestions / Reports
  ['/api/v1/suggestions', null],
  ['/api/v1/reports/sales', null],
];

// ---------------------------------------------------------------------------
// Auth helper
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
  const apiUrl = process.env.E2E_API_URL ?? 'https://api.appoinlycrm.net';

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

// ---------------------------------------------------------------------------
// Helper: normalise endpoint tuple
// ---------------------------------------------------------------------------

function normalise(e: Endpoint): { path: string; shape: 'data' | 'array' | null } {
  if (typeof e === 'string') return { path: e, shape: null };
  return { path: e[0], shape: e[1] };
}

// ---------------------------------------------------------------------------
// Smoke suite
// ---------------------------------------------------------------------------

test.describe('@smoke API GET endpoints return 2xx', () => {
  test.describe.configure({ mode: 'parallel', timeout: 30_000 });

  // Shared auth state — obtained lazily on first test, reused by the rest.
  // Because tests run in parallel we derive auth inside each test using the
  // same credentials. Playwright's `request` fixture is per-test but the
  // login round-trip is cheap relative to a full browser launch.
  //
  // If you want to optimise further, promote auth to a `beforeAll`-scoped
  // fixture — but that requires a custom fixture file and shared state, which
  // is intentionally avoided here to keep the file self-contained.

  for (const endpoint of API_ENDPOINTS) {
    const { path, shape } = normalise(endpoint);

    test(`GET ${path} returns 2xx`, async ({ request }) => {
      const apiUrl = process.env.E2E_API_URL ?? 'https://api.appoinlycrm.net';
      let token: string;

      const preSignedToken = process.env.E2E_TOKEN;
      if (preSignedToken) {
        token = preSignedToken;
      } else {
        const email = process.env.E2E_EMAIL;
        const password = process.env.E2E_PASSWORD;
        if (!email || !password) {
          throw new Error('Set either E2E_TOKEN, or E2E_EMAIL + E2E_PASSWORD');
        }
        const auth = await getApiToken(request, email, password);
        token = auth.token;
      }

      // ---- Perform the GET request ----
      const res = await request.get(`${apiUrl}${path}`, {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });

      // ---- Assert 2xx ----
      expect(
        res.status(),
        `GET ${path} returned HTTP ${res.status()}`,
      ).toBeGreaterThanOrEqual(200);

      expect(
        res.status(),
        `GET ${path} returned HTTP ${res.status()}`,
      ).toBeLessThan(300);

      // ---- Optional body shape assertion ----
      if (shape !== null) {
        let body: unknown;
        try {
          body = await res.json();
        } catch {
          throw new Error(`GET ${path} returned non-JSON body`);
        }

        if (shape === 'data') {
          expect(
            body,
            `GET ${path} response body missing 'data' property`,
          ).toMatchObject({ data: expect.anything() });
        } else if (shape === 'array') {
          expect(
            Array.isArray(body),
            `GET ${path} response body is not an array`,
          ).toBe(true);
        }
      }
    });
  }
});
