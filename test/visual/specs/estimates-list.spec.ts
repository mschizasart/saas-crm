/**
 * Visual: /estimates
 */
import { test } from '@playwright/test';
import { snapshotMatrix } from '../setup';

test.describe('Visual: estimates list', () => {
  test('renders consistently across themes and viewports', async ({ page }) => {
    await snapshotMatrix(page, {
      name: 'estimates-list',
      url: '/estimates',
      stableSelector: 'h1',
      extraCss: `
        table tbody { visibility: hidden !important; }
        [data-testid="stat-card"] [class*="text-2xl"],
        [data-testid="stat-card"] [class*="text-3xl"] { visibility: hidden !important; }
      `,
    });
  });
});
