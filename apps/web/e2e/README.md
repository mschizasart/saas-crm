# End-to-End Tests

Playwright test suite covering the five critical paths of the SaaS CRM staff web app.

## Required environment variables

| Variable | Required | Description |
|---|---|---|
| `E2E_EMAIL` | Yes | Staff user email address |
| `E2E_PASSWORD` | Yes | Staff user password |
| `E2E_BASE_URL` | No | Override the target URL (default: `http://localhost:3000`) |
| `E2E_PORTAL_EMAIL` | No | Client portal user email. If unset, the portal login test is skipped. |
| `E2E_PORTAL_PASSWORD` | No | Client portal user password. If unset, the portal login test is skipped. |

The portal credentials are intentionally optional so staff-only CI runs can skip `portal.spec.ts` without failing. The portal page-render test (which does not require credentials) still runs unconditionally.

Put local credentials in `apps/web/.env.e2e` (this file is gitignored):

```
E2E_EMAIL=you@example.com
E2E_PASSWORD=yourpassword
```

Then load them before running:

```bash
export $(cat .env.e2e | xargs)
```

## Commands

```bash
# Run against local dev server (auto-starts pnpm dev if not already running)
cd apps/web
E2E_EMAIL=you@example.com E2E_PASSWORD=secret pnpm e2e

# Interactive UI mode (useful for debugging selectors)
E2E_EMAIL=you@example.com E2E_PASSWORD=secret pnpm e2e:ui

# Smoke run against production
E2E_BASE_URL=https://www.appoinlycrm.net E2E_EMAIL=you@example.com E2E_PASSWORD=secret pnpm e2e:prod
```

## Adding a new test

Create a `.spec.ts` file inside this `e2e/` directory. Import `test` and `expect` from `./fixtures` (not directly from `@playwright/test`) so that the `loggedInPage` fixture is available — this fixture performs the login flow in `beforeEach` and hands you an authenticated `Page`. Group tests with `test.describe`, name each `test()` as a readable sentence, and follow the Arrange/Act/Assert structure. Prefer `getByRole` / `getByLabel` / `getByText` selectors; add `data-testid` attributes to the app source only when no semantic selector is available (and note any such additions in your PR description).

## Visual regression tests

`dashboard-visual.spec.ts` takes a full-page screenshot of `/dashboard` and compares it against a committed baseline PNG.

**Baseline location:** `e2e/__screenshots__/dashboard-visual.spec.ts-snapshots/dashboard.png`

**First run (no baseline yet):** Playwright creates the baseline automatically. Commit the generated file so CI has something to compare against. Run locally against the real app to produce a meaningful baseline:

```bash
E2E_EMAIL=you@example.com E2E_PASSWORD=secret pnpm e2e e2e/dashboard-visual.spec.ts
```

**Updating the baseline after an intentional UI change:**

```bash
E2E_EMAIL=you@example.com E2E_PASSWORD=secret pnpm e2e --update-snapshots
```

Review the diff in `playwright-report/` before committing the new baseline, and confirm the change is intentional.

**Stability:** volatile widgets (stat-card values, table rows, revenue chart, activity feed, etc.) are masked with Playwright's `{ mask: [...] }` option so the screenshot only captures layout and structural changes, not live data.

## Smoke specs

Two broad smoke specs catch crashing pages and broken endpoints without requiring a targeted test per feature.

### `admin-smoke.spec.ts` — every admin page loads

Iterates over ~87 admin routes. For each route it:

1. Navigates to the route using the `loggedInPage` fixture (authenticated session).
2. Races between `networkidle` and the first `<h1>` becoming visible to let the page settle.
3. Asserts the URL was not redirected to `/login` (no unexpected auth bounce).
4. Asserts no uncaught JS error (`pageerror` event) was thrown.
5. Asserts no `console error` message was emitted (excluding known-harmless noise: hydration warnings, NextAuth proxy flicker, React `Warning:` prefixed messages).
6. Asserts no visible error banner matching `/failed|went wrong|500/i` inside `<main>`.

Each route is its own `test()` so a failure report points at the exact URL. Playwright's `screenshot: 'only-on-failure'` captures the page state automatically.

### `api-smoke.spec.ts` — every GET endpoint returns 2xx

Uses Playwright's `request` context (no browser). Authenticates via `POST /api/v1/auth/login` using `E2E_EMAIL`/`E2E_PASSWORD` to get a Bearer token, then GETs ~32 endpoints. For list endpoints it also asserts the response body contains a `data` property.

The API base URL is `E2E_API_URL` (defaults to `https://api.appoinlycrm.net`), which keeps the spec usable against both production and a local API server.

### Running and skipping smoke specs

Both describe blocks are tagged `@smoke` in their name. To skip them during rapid iteration on a specific feature:

```bash
# Run everything except smoke
pnpm e2e --grep-invert "@smoke"

# Run only smoke
pnpm e2e --grep "@smoke"

# Run smoke against production API
E2E_BASE_URL=https://www.appoinlycrm.net \
E2E_API_URL=https://api.appoinlycrm.net \
E2E_EMAIL=you@example.com \
E2E_PASSWORD=secret \
pnpm e2e --grep "@smoke"
```

If a route returns a 500 or crashes, the failure message will include the exact URL, e.g.:

```
route /invoices/recurring shows an error banner
```

or

```
GET /api/v1/invoices?recurring=true&limit=5 returned HTTP 500
```

---

## Known flakiness notes

- **Rate limiting on login.** Rapid repeated runs in CI can trigger a 429 from the auth API. The config sets `retries: 2` in CI mode which covers transient failures, but if rate-limiting is persistent add a delay between retries at the infrastructure level rather than with `waitForTimeout`.
- **Race between `useEffect` fetches and assertions.** All assertions in this suite use Playwright's built-in auto-waiting (`toBeVisible`, `waitForURL`). Never add `waitForTimeout` — if an assertion is flaky, increase its `timeout` option or wait for a more specific DOM signal.
- **Dark-mode auto-toggle.** If the OS preference is `dark`, the app may render with a dark theme. Tests in this suite are theme-agnostic (they assert on text and roles, not colors), so this should not cause failures.
- **NextAuth session cookie.** This app does NOT use NextAuth session cookies for authentication — it stores `accessToken` in `localStorage`. The fixture logs in via the form and the token is therefore scoped to the browser context. There is no need to seed cookies.
