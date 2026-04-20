/**
 * invoices.spec.ts
 *
 * Critical-path: invoices list + create.
 * Catches: invoice list page crash on real API data, new-invoice form regression,
 * client combobox interaction, line-item entry, redirect to detail page after save.
 *
 * Self-contained: if no clients exist the test creates one via the API before
 * proceeding, so the test never fails simply because the DB is empty.
 */

import { test, expect } from './fixtures';

const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001';

// ---------------------------------------------------------------------------
// Helper: ensure at least one client exists, return its display name.
// Uses Playwright's `request` context with the auth token stored in localStorage.
// ---------------------------------------------------------------------------

async function ensureClientExists(page: import('@playwright/test').Page): Promise<string> {
  // Grab the token the login fixture stored.
  const token = await page.evaluate(() => localStorage.getItem('access_token'));

  // Check whether any clients already exist.
  const listRes = await page.request.get(`${API_BASE}/api/v1/clients?limit=1`, {
    headers: { Authorization: `Bearer ${token ?? ''}` },
  });
  if (listRes.ok()) {
    const json = await listRes.json();
    const first = (json.data ?? [])[0];
    if (first) {
      return first.company ?? first.company_name ?? first.name ?? first.id;
    }
  }

  // No clients — create one so the invoice form has something to pick.
  const company = `E2E Client ${Date.now()}`;
  const createRes = await page.request.post(`${API_BASE}/api/v1/clients`, {
    headers: {
      Authorization: `Bearer ${token ?? ''}`,
      'Content-Type': 'application/json',
    },
    data: { company },
  });
  if (!createRes.ok()) {
    throw new Error(
      `Failed to create fallback client (${createRes.status()}): ${await createRes.text()}`,
    );
  }
  return company;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

test.describe('Invoices', () => {
  test('list view loads and the "New Invoice" action is visible', async ({ loggedInPage: page }) => {
    await page.goto('/invoices');

    // ListPageLayout renders a primary-action link for "New Invoice".
    // The component renders an <a> tag with the label text.
    await expect(page.getByRole('link', { name: /new invoice/i })).toBeVisible();

    // The page heading must also be present — confirms the page mounted.
    await expect(page.getByRole('heading', { name: /invoices/i })).toBeVisible();
  });

  test('create invoice → detail redirect → line item appears on detail page', async ({
    loggedInPage: page,
  }) => {
    // ---- Ensure a client exists (self-contained fallback) ----
    const clientName = await ensureClientExists(page);

    // ---- Navigate to the new-invoice form ----
    await page.goto('/invoices/new');

    // The form heading confirms we are on the right page.
    await expect(page.getByRole('heading', { name: /create new invoice/i })).toBeVisible();

    // ---- Select a client via the combobox ----
    // The "Customer" field is a free-text input that triggers a dropdown.
    // Its placeholder is "Search customer...".
    const customerInput = page.getByPlaceholder(/search customer/i);
    await expect(customerInput).toBeVisible();
    await customerInput.click();

    // Type a few chars of the client name to narrow the dropdown, then pick
    // the first result that appears.
    await customerInput.fill(clientName.slice(0, 3));

    // The dropdown renders <button> elements inside an absolute-positioned div
    // that is a direct sibling of the customer input (same relative container).
    // We scope the locator to the customer input's parent to avoid matching
    // any other absolute dropdowns that might exist on the page.
    const customerInputContainer = customerInput.locator('..');
    const firstOption = customerInputContainer
      .locator('div[class*="absolute"] button')
      .first();
    await expect(firstOption).toBeVisible({ timeout: 8_000 });
    await firstOption.click();

    // Confirm the input now holds a name (client was selected).
    await expect(customerInput).not.toHaveValue('');

    // ---- Fill in the first line item ----
    // The line-items table has an "Item" column with a "Search items..." placeholder
    // and a separate "Description" column input.  We fill the Description column
    // input (second input matching placeholder "Description") so the value is
    // unambiguous and not confused with the autocomplete search input.
    const descriptionInput = page.getByPlaceholder('Description').first();
    await expect(descriptionInput).toBeVisible();
    await descriptionInput.fill('Test line');

    // Qty and Rate inputs are type="number".  The first row contains the first
    // pair; we select them positionally within the first <tr>.
    const firstRow = page.locator('tbody tr').first();

    const qtyInput = firstRow.locator('input[type="number"]').nth(0);
    await qtyInput.fill('1');

    const rateInput = firstRow.locator('input[type="number"]').nth(1);
    await rateInput.fill('100');

    // ---- Submit the form ----
    // The primary submit button text is "Save" (not "Save as Draft").
    await page.getByRole('button', { name: /^save$/i }).click();

    // ---- Assert redirect to /invoices/<uuid> ----
    await page.waitForURL(/\/invoices\/[0-9a-f-]{36}/, { timeout: 15_000 });
    expect(page.url()).toMatch(/\/invoices\/[0-9a-f-]{36}/);

    // ---- Assert the line item description appears on the detail page ----
    await expect(page.getByText('Test line')).toBeVisible();
  });
});
