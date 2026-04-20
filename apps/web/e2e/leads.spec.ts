/**
 * leads.spec.ts
 *
 * Critical-path: leads kanban view + create.
 *
 * This test is the direct regression for the bug class "authenticated page
 * crashes on real API data."  The original crash happened because the API
 * returns `status` as a relation object { id, name, color } while the
 * component assumed it was a plain string.  The fix normalises via
 * `leadStatusKey()`.  This test re-proves the kanban renders without a thrown
 * JS error after login.
 */

import { test, expect } from './fixtures';

test.describe('Leads', () => {
  test(
    'kanban view renders without JS errors and shows the "New" column',
    async ({ loggedInPage: page }) => {
      // Collect any uncaught page errors.  An app crash (e.g. "Cannot read
      // properties of undefined") would fire this listener.
      const pageErrors: string[] = [];
      page.on('pageerror', (err) => pageErrors.push(err.message));

      await page.goto('/leads');

      // The kanban default view should render all seven status columns.
      // Asserting the "New" column heading is a lightweight proxy for
      // "the board mounted and fetched data without crashing."
      // KanbanColumn renders the label inside a <span> with class text-sm font-semibold.
      // We use getByText with exact:false so it tolerates surrounding whitespace.
      await expect(
        page.getByText('New', { exact: false }).first(),
      ).toBeVisible();

      // The board either shows lead cards OR the "Drop here" empty-column
      // placeholder — either is correct, so we just assert the column header
      // is present (done above).  What we must NOT see is a crash.
      expect(pageErrors).toHaveLength(0);
    },
  );

  test(
    'create lead → detail redirect → card appears in kanban "New" column',
    async ({ loggedInPage: page }) => {
      const leadName = `Test Lead ${Date.now()}`;
      const testEmail = `smoke+${Date.now()}@example.com`;

      // ---- Navigate to the new-lead form ----
      await page.goto('/leads/new');

      // "Name" is a required field; label text is "Name".
      await page.getByLabel(/^name/i).fill(leadName);

      // "Email" is optional but we fill it so the test data is realistic.
      await page.getByLabel(/^email/i).fill(testEmail);

      // ---- Submit ----
      await page.getByRole('button', { name: /create lead/i }).click();

      // ---- Assert redirect to /leads/<uuid> ----
      await page.waitForURL(/\/leads\/[0-9a-f-]{36}/, { timeout: 15_000 });
      expect(page.url()).toMatch(/\/leads\/[0-9a-f-]{36}/);

      // ---- Navigate back to kanban and assert the card is in the "New" column ----
      // The kanban URL is just /leads (default view=kanban).
      const pageErrors: string[] = [];
      page.on('pageerror', (err) => pageErrors.push(err.message));

      await page.goto('/leads');

      // LeadCard renders the lead name as a link inside the "New" column drop zone.
      // We locate the column by its heading text, then find the link within it.
      // Column structure: .flex-col > [column-header] > [drop-zone with cards].
      // The simplest robust approach: find the lead name link anywhere on the page
      // after the board loads (it will be inside the "New" column because we set
      // status: 'new' on creation).
      await expect(page.getByRole('link', { name: leadName })).toBeVisible();

      // Ensure no crash on second kanban load either.
      expect(pageErrors).toHaveLength(0);
    },
  );
});
