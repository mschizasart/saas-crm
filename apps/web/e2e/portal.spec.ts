/**
 * portal.spec.ts
 *
 * Critical-path: client portal login flow.
 * Catches: portal login page crash, missing redirect after auth, sidebar nav missing.
 *
 * The portal credentials (E2E_PORTAL_EMAIL / E2E_PORTAL_PASSWORD) are separate
 * from staff credentials and are optional — staff-only CI runs skip this file.
 */

import { test, expect } from '@playwright/test';

const PORTAL_EMAIL = process.env.E2E_PORTAL_EMAIL;
const PORTAL_PASSWORD = process.env.E2E_PORTAL_PASSWORD;

test.describe('Portal', () => {
  test('login page renders the "Client Portal" heading and sign-in form', async ({ page }) => {
    await page.goto('/portal/login');

    // The portal login card renders an h1 with "Client Portal".
    await expect(page.getByRole('heading', { name: /client portal/i })).toBeVisible();

    // Form inputs must be present (type selectors are the most resilient
    // here because the portal login page does not use <label> with htmlFor).
    await expect(page.locator('input[type="email"]')).toBeVisible();
    await expect(page.locator('input[type="password"]')).toBeVisible();
    await expect(page.getByRole('button', { name: /sign in/i })).toBeVisible();
  });

  test('portal login → redirects to /portal/dashboard → sidebar shows "Invoices"', async ({ page }) => {
    if (!PORTAL_EMAIL || !PORTAL_PASSWORD) {
      test.skip(
        true,
        'E2E_PORTAL_EMAIL and E2E_PORTAL_PASSWORD are not set. ' +
          'Set them to run portal login tests. Skipping.',
      );
      return;
    }

    await page.goto('/portal/login');

    // The login form uses plain <input> elements without associated <label>
    // elements (no htmlFor / aria-labelledby), so we target them by type.
    await page.locator('input[type="email"]').fill(PORTAL_EMAIL);
    await page.locator('input[type="password"]').fill(PORTAL_PASSWORD);

    await page.getByRole('button', { name: /sign in/i }).click();

    // Wait for redirect to portal dashboard.
    await page.waitForURL(/\/portal\/dashboard/, { timeout: 10_000 });
    await expect(page).toHaveURL(/\/portal\/dashboard/);

    // The portal layout renders a top-nav bar with the NAV items.
    // "Invoices" is the second nav link — assert it is present and navigable.
    await expect(page.getByRole('link', { name: /^invoices$/i })).toBeVisible();
  });
});
