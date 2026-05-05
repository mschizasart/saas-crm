/**
 * Visual: /clients/:id
 *
 * Picks the first client via the API. If no client exists the test is
 * skipped — there's nothing meaningful to snapshot.
 */
import { test } from '@playwright/test';
import { snapshotMatrix, getFirstClientId } from '../setup';

test.describe('Visual: client detail', () => {
  test('renders consistently across themes and viewports', async ({ page, request }) => {
    const id = await getFirstClientId(request);
    test.skip(!id, 'No clients in test DB — seed at least one to enable this spec');

    await snapshotMatrix(page, {
      name: 'client-detail',
      url: `/clients/${id}`,
      stableSelector: 'h1',
      extraCss: `
        /* Mask any panel that displays the client's email/phone/created-at */
        [data-testid="client-meta"],
        dl, dd { visibility: hidden !important; }
        /* Mask tabs panels — invoices/estimates lists vary per run */
        [role="tabpanel"] table tbody { visibility: hidden !important; }
      `,
    });
  });
});
