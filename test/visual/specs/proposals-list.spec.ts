/**
 * Visual: /proposals
 */
import { test } from '@playwright/test';
import { snapshotMatrix } from '../setup';

test.describe('Visual: proposals list', () => {
  test('renders consistently across themes and viewports', async ({ page }) => {
    await snapshotMatrix(page, {
      name: 'proposals-list',
      url: '/proposals',
      stableSelector: 'h1',
      extraCss: `
        table tbody { visibility: hidden !important; }
        [data-testid="stat-card"] [class*="text-2xl"],
        [data-testid="stat-card"] [class*="text-3xl"] { visibility: hidden !important; }
      `,
    });
  });
});
