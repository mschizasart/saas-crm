/**
 * Visual: /invoices
 */
import { test } from '@playwright/test';
import { snapshotMatrix } from '../setup';

test.describe('Visual: invoices list', () => {
  test('renders consistently across themes and viewports', async ({ page }) => {
    await snapshotMatrix(page, {
      name: 'invoices-list',
      url: '/invoices',
      stableSelector: 'h1',
      extraCss: `
        table tbody { visibility: hidden !important; }
        /* Stat cards summarising "Outstanding $X" — mask values */
        [data-testid="stat-card"] [class*="text-2xl"],
        [data-testid="stat-card"] [class*="text-3xl"] { visibility: hidden !important; }
      `,
    });
  });
});
