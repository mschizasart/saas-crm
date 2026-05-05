/**
 * Visual: /products + /products?tab=low-stock
 *
 * The low-stock view is a tab on the same page (not a sub-route). Captures
 * both the "all" tab and the "low-stock" tab → 8 baselines.
 */
import { test } from '@playwright/test';
import { snapshotMatrix } from '../setup';

test.describe('Visual: products', () => {
  test('all products list', async ({ page }) => {
    await snapshotMatrix(page, {
      name: 'products-list',
      url: '/products',
      stableSelector: 'h1',
      extraCss: `
        table tbody { visibility: hidden !important; }
      `,
    });
  });

  test('low-stock products list', async ({ page }) => {
    await snapshotMatrix(page, {
      name: 'products-low-stock',
      url: '/products?tab=low-stock',
      stableSelector: 'h1',
      extraCss: `
        table tbody { visibility: hidden !important; }
      `,
    });
  });
});
