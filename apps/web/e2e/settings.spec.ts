/**
 * settings.spec.ts
 *
 * Critical-path: settings page loads with real org data and tab switching works.
 * Catches: authenticated settings page crash on real org data, SMTP section missing.
 */

import { test, expect } from './fixtures';

test.describe('Settings', () => {
  test(
    'Company tab is active by default; switching to Email tab reveals SMTP Host',
    async ({ loggedInPage: page }) => {
      await page.goto('/settings');

      // --- Part 1: Company tab ---
      // The settings page renders a tab list. The "Company" tab button must be
      // visible; the field labeled "Company name" (from the settings source:
      // label="Company name") must be rendered beneath it.
      const companyTab = page.getByRole('button', { name: /^company$/i });
      await expect(companyTab).toBeVisible();
      await expect(page.getByText('Company name', { exact: false })).toBeVisible();

      // --- Part 2: Email (SMTP) tab ---
      // The tab label in the TABS constant is 'Email (SMTP)'.
      await page.getByRole('button', { name: /email.*smtp/i }).click();

      // After switching, the section renders a field labeled "SMTP Host".
      // getByLabel asserts the input is accessible AND present in the DOM.
      await expect(page.getByLabel(/smtp host/i)).toBeVisible();
    },
  );
});
