/**
 * Visual: /reports + 3 sub-reports
 *
 * Charts on these pages are non-deterministic, so we hide the entire
 * `.recharts-wrapper` block via the global flaky-hide CSS in setup.ts.
 * What's left in the diff is the page chrome: title, date-range picker,
 * filter chips, table headers — all the things that actually break when
 * the layout regresses.
 *
 * 4 sub-reports × 4 variants = 16 baselines from this spec alone.
 */
import { test } from '@playwright/test';
import { snapshotMatrix } from '../setup';

const REPORT_PAGES: { name: string; url: string }[] = [
  { name: 'reports-overview',           url: '/reports' },
  { name: 'reports-items',              url: '/reports/items' },
  { name: 'reports-payment-modes',      url: '/reports/payment-modes' },
  { name: 'reports-expenses-by-category', url: '/reports/expenses-by-category' },
];

test.describe('Visual: reports', () => {
  for (const { name, url } of REPORT_PAGES) {
    test(`${name} page`, async ({ page }) => {
      await snapshotMatrix(page, {
        name,
        url,
        stableSelector: 'h1',
        extraCss: `
          /* Numerical totals in summary cards drift with data — mask them */
          [data-testid="report-summary-value"],
          [data-testid="stat-card"] [class*="text-2xl"],
          [data-testid="stat-card"] [class*="text-3xl"] { visibility: hidden !important; }
          /* Table bodies are data-dependent */
          table tbody { visibility: hidden !important; }
        `,
      });
    });
  }
});
