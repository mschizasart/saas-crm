/**
 * Visual: /invoices/:id
 *
 * Picks the first invoice via the API. Skips if none exist.
 */
import { test } from '@playwright/test';
import { snapshotMatrix, getFirstInvoiceId } from '../setup';

test.describe('Visual: invoice detail', () => {
  test('renders consistently across themes and viewports', async ({ page, request }) => {
    const id = await getFirstInvoiceId(request);
    test.skip(!id, 'No invoices in test DB — seed at least one to enable this spec');

    await snapshotMatrix(page, {
      name: 'invoice-detail',
      url: `/invoices/${id}`,
      stableSelector: 'h1',
      extraCss: `
        /* Mask everything that's data-driven on the invoice detail page:
           number, dates, totals, line items, client name. Keep the
           layout (header, sidebar, action buttons) in the diff. */
        dl, dd, table { visibility: hidden !important; }
      `,
    });
  });
});
