/**
 * admin-smoke.spec.ts  @smoke
 *
 * Broad smoke test: visit every admin route and assert:
 *   1. The URL did NOT change to /login (no auth bounce).
 *   2. No uncaught JS error (pageerror) was thrown during navigation.
 *   3. No console error message was emitted that looks like an app error.
 *   4. No visible error banner inside the page body.
 *
 * Each route is its own test so failures are reported per-route.
 * Run the full suite in parallel (inherits `fullyParallel` from playwright.config.ts).
 *
 * Skip during deep-test iteration:
 *   pnpm e2e --grep-invert @smoke
 */

import { test, expect } from './fixtures';

// ---------------------------------------------------------------------------
// Route list
// ---------------------------------------------------------------------------
const ADMIN_ROUTES: string[] = [
  '/dashboard',
  '/clients',
  '/clients/new',
  '/clients/map',
  '/clients/import',
  '/leads',
  '/leads/new',
  '/leads/import',
  '/leads/web-form',
  '/invoices',
  '/invoices/new',
  '/invoices/recurring',
  '/estimates',
  '/estimates/new',
  '/estimates/pipeline',
  '/proposals',
  '/proposals/new',
  '/proposals/pipeline',
  '/contracts',
  '/contracts/new',
  '/credit-notes',
  '/credit-notes/new',
  '/payments',
  '/payments/batch',
  '/expenses',
  '/expenses/new',
  '/subscriptions',
  '/subscriptions/new',
  '/projects',
  '/projects/new',
  '/tasks',
  '/tasks/new',
  '/tasks/kanban',
  '/tickets',
  '/tickets/new',
  '/tickets/kanban',
  '/staff',
  '/staff/new',
  '/staff/roles',
  '/appointments',
  '/appointments/booking',
  '/calendar',
  '/activity',
  '/announcements',
  '/todos',
  '/vault',
  '/products',
  '/knowledge-base',
  '/knowledge-base/new',
  '/surveys',
  '/surveys/new',
  '/clock',
  '/timesheets',
  '/newsfeed',
  '/notifications',
  '/chat',
  '/media',
  '/reports/sales',
  '/reports/clients',
  '/reports/tickets',
  '/reports/leads',
  '/reports/income-expense',
  '/reports/profit-loss',
  '/reports/time-tracking',
  '/settings',
  '/settings?tab=company',
  '/settings?tab=email',
  '/settings?tab=gateways',
  '/settings/api-keys',
  '/settings/automations',
  '/settings/backups',
  '/settings/chat-widget',
  '/settings/client-groups',
  '/settings/contract-types',
  '/settings/currencies',
  '/settings/custom-fields',
  '/settings/departments',
  '/settings/email-templates',
  '/settings/expense-categories',
  '/settings/gdpr',
  '/settings/lead-sources',
  '/settings/lead-statuses',
  '/settings/payment-modes',
  '/settings/predefined-replies',
  '/settings/saved-items',
  '/settings/tags',
  '/settings/taxes',
  '/settings/webhooks',
];

// ---------------------------------------------------------------------------
// Noise patterns to exclude from the console-error check.
// These are known-harmless messages that are NOT evidence of a page crash.
// ---------------------------------------------------------------------------
function isHarmlessConsoleMessage(text: string): boolean {
  // React hydration mismatches (dev-mode only, not a crash)
  if (text.includes('hydration')) return true;
  // NextAuth internal proxy flicker (legacy, still occasionally surfaces)
  if (text.includes('Failed to proxy http://localhost:3001/api/formaction')) return true;
  // React dev-only warnings: "Warning: ..."
  if (text.startsWith('Warning:')) return true;
  // Next.js router prefetches RSC payloads for visible <Link>s; on auth failures or
  // transient network hiccups it logs "Failed to fetch RSC payload ..." and falls
  // back to full-page navigation — user flow is unaffected.
  if (text.includes('Failed to fetch RSC payload')) return true;
  // socket.io realtime gateway WebSocket is best-effort; connect failures degrade
  // gracefully to no-realtime. Not a page crash.
  if (text.includes('WebSocket connection to')) return true;
  if (text.includes('socket.io') && text.includes('failed')) return true;
  // NextAuth session endpoint: we don't use NextAuth for the staff login path.
  // The client polls /api/auth/session anyway; if its handler 500s or 404s the
  // rest of the app still works. Surfaced as a separate followup, not a page crash.
  if (text.includes('[next-auth]')) return true;
  // Generic "Failed to load resource" for /api/auth/* specifically — same reason.
  if (
    text.includes('Failed to load resource') &&
    (text.includes('/api/auth/') || text.includes('api/auth/session'))
  ) {
    return true;
  }
  // React generic "Failed to fetch" — usually the prefetch above; treat as noise
  // unless accompanied by a specific diagnostic we care about.
  if (text.trim() === 'TypeError: Failed to fetch') return true;
  return false;
}

// ---------------------------------------------------------------------------
// Describe block — each route is a separate, independent test
// ---------------------------------------------------------------------------
test.describe('@smoke Admin pages load without errors', () => {
  // Each test manages its own isolated browser context (Playwright default when
  // using fixtures). parallel mode is already on at the config level.
  test.describe.configure({ mode: 'parallel' });

  for (const route of ADMIN_ROUTES) {
    test(`loads ${route}`, async ({ loggedInPage: page }) => {
      // ---- 1. Collect page-level JS errors ----
      const pageErrors: string[] = [];
      page.on('pageerror', (err) => {
        pageErrors.push(err.message);
      });

      // ---- 2. Collect console errors, excluding known-harmless noise ----
      const consoleErrors: string[] = [];
      page.on('console', (msg) => {
        if (msg.type() === 'error') {
          const text = msg.text();
          if (!isHarmlessConsoleMessage(text)) {
            consoleErrors.push(text);
          }
        }
      });

      // ---- 3. Navigate ----
      await page.goto(route);

      // ---- 4. Wait for the page to settle ----
      // Race between network idle (preferred) and the PageHeader h1 becoming
      // visible. Either signal means the page has meaningfully rendered.
      await Promise.race([
        page.waitForLoadState('networkidle', { timeout: 10_000 }).catch(() => {
          // networkidle timed out — that is acceptable; the page may have
          // long-polling connections. We just fall through.
        }),
        page.locator('h1').first().waitFor({ state: 'visible', timeout: 10_000 }).catch(() => {
          // h1 may not exist on every page; ignore.
        }),
      ]);

      // ---- 5. Assert no auth bounce ----
      // The URL must contain the route path (or a prefix of it for query-string
      // routes) and must NOT be the /login page.
      const currentUrl = page.url();
      expect(currentUrl, `route ${route} bounced to login`).not.toMatch(/\/login/);

      // For query-string routes the pathname will match; strip the query for the
      // path-only check.
      const routePath = route.split('?')[0];
      expect(currentUrl, `route ${route} redirected away unexpectedly`).toContain(routePath);

      // ---- 6. Assert no JS crashes ----
      expect(
        pageErrors,
        `route ${route} threw JS errors: ${pageErrors.join('; ')}`,
      ).toHaveLength(0);

      // ---- 7. Assert no meaningful console errors ----
      expect(
        consoleErrors,
        `route ${route} logged console errors: ${consoleErrors.join('; ')}`,
      ).toHaveLength(0);

      // ---- 8. Assert no visible error banner in the main content ----
      // Looks for any text node inside the page body that matches common error
      // patterns. We scope to the <main> element to avoid false positives from
      // nav / help text that may legitimately contain the word "error".
      const errorBanner = page
        .locator('main')
        .getByText(/failed|went wrong|500/i)
        .first();

      // Use "hidden" expectation: the banner must NOT be visible.
      await expect(
        errorBanner,
        `route ${route} shows an error banner`,
      ).toBeHidden();
    });
  }
});
