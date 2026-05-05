/**
 * Visual: /dashboard
 *
 * Captures 4 baselines (light×desktop, light×mobile, dark×desktop, dark×mobile).
 * Charts and live-data widgets are hidden via the global flaky-hide CSS in
 * setup.ts (recharts wrapper, [data-flaky="chart"], skeletons, timestamps).
 */
import { test } from '@playwright/test';
import { snapshotMatrix } from '../setup';

test.describe('Visual: dashboard', () => {
  test('renders consistently across themes and viewports', async ({ page }) => {
    await snapshotMatrix(page, {
      name: 'dashboard',
      url: '/dashboard',
      stableSelector: 'h1, h2',
      // Wait for at least one stat-card to render before snapshotting.
      extraCss: `
        /* The stats grid contains live counts/currency that drift between
           runs. Hide everything inside the first row of stat cards. */
        [data-testid="stat-card"] [class*="text-2xl"],
        [data-testid="stat-card"] [class*="text-3xl"] { visibility: hidden !important; }
        /* Recent invoices / tickets table bodies are data-driven — mask. */
        section:has(h2:has-text("Recent Invoices")) tbody,
        section:has(h2:has-text("Open Tickets")) tbody { visibility: hidden !important; }
      `,
    });
  });
});
