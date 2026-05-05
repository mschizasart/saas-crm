/**
 * Visual: /clients
 *
 * If the table has rows, the row content (names/emails) is masked because
 * dev-seed data is not guaranteed identical across machines. We still
 * compare the surrounding chrome (header, filters, pagination, empty-state).
 */
import { test } from '@playwright/test';
import { snapshotMatrix } from '../setup';

test.describe('Visual: clients list', () => {
  test('renders consistently across themes and viewports', async ({ page }) => {
    await snapshotMatrix(page, {
      name: 'clients-list',
      url: '/clients',
      stableSelector: 'h1',
      extraCss: `
        /* Mask table body so seeded data doesn't influence the diff */
        table tbody { visibility: hidden !important; }
      `,
    });
  });
});
