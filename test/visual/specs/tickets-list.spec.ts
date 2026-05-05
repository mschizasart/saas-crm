/**
 * Visual: /tickets
 */
import { test } from '@playwright/test';
import { snapshotMatrix } from '../setup';

test.describe('Visual: tickets list', () => {
  test('renders consistently across themes and viewports', async ({ page }) => {
    await snapshotMatrix(page, {
      name: 'tickets-list',
      url: '/tickets',
      stableSelector: 'h1',
      extraCss: `
        table tbody { visibility: hidden !important; }
        /* Status counts in the toolbar drift with seeded data */
        [data-testid="status-filter"] [class*="badge"] { visibility: hidden !important; }
      `,
    });
  });
});
