/**
 * clients.spec.ts
 *
 * Critical-path: clients list + create.
 * Catches: authenticated page crash on real API data, create form regression,
 * redirect to new-entity detail page, row appearing in list after create.
 */

import { test, expect } from './fixtures';

test.describe('Clients', () => {
  test('list view loads and shows the "New Client" action', async ({ loggedInPage: page }) => {
    await page.goto('/clients');

    // The ListPageLayout renders a primary-action link/button for "New Client".
    // Prefer role=link because the component renders an <a> tag wrapping the label.
    // The regex covers future label tweaks like "+ New Client" or "Add Client".
    await expect(
      page.getByRole('link', { name: /new client/i }),
    ).toBeVisible();
  });

  test('create client → redirects to detail page → appears in list', async ({ loggedInPage: page }) => {
    const company = `Smoke ${Date.now()}`;

    // ---- Navigate to the new-client form ----
    await page.goto('/clients/new');

    // "Company" field is labeled "Company" with a required marker (*).
    // The <label> text is "Company" — getByLabel does a partial/case-insensitive
    // match so "Company *" still matches.
    await page.getByLabel(/^company/i).fill(company);

    // ---- Submit the form ----
    // The submit button text is "Create Client" (from the page source).
    await page.getByRole('button', { name: /create client/i }).click();

    // ---- Assert redirect to /clients/<uuid> ----
    await page.waitForURL(/\/clients\/[0-9a-f-]{36}/, { timeout: 15_000 });
    expect(page.url()).toMatch(/\/clients\/[0-9a-f-]{36}/);

    // ---- Navigate back to the list and confirm the row is present ----
    await page.goto('/clients');

    // The table renders company names as link text inside <td>.
    // Using getByText scoped to the table is the most robust selector here.
    await expect(page.getByRole('cell', { name: company })).toBeVisible();
  });
});
