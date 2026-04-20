/**
 * dashboard-visual.spec.ts
 *
 * Visual regression: staff dashboard full-page screenshot.
 *
 * First run creates the baseline PNG under e2e/__screenshots__/.
 * Subsequent runs compare against that baseline.
 *
 * To regenerate the baseline after an intentional UI change:
 *   pnpm e2e --update-snapshots
 *
 * Dynamic content is masked so the snapshot is stable across runs:
 *   - Stat-card values (live counts / currency amounts)
 *   - Recent-invoices and recent-tickets table rows (data changes)
 *   - Revenue bar chart (changes every month)
 *   - Activity feed items (createdAt timestamps, action descriptions)
 *   - Announcements banner (if present)
 *   - Smart-suggestions widget (changes based on CRM state)
 *   - Leads-by-stage bars (live kanban counts)
 *   - Goals-progress widget
 *   - Calendar-preview widget
 */

import { test, expect } from './fixtures';

test.describe('Dashboard visual regression', () => {
  test('dashboard matches baseline screenshot', async ({ loggedInPage: page }) => {
    await page.goto('/dashboard');

    // ---- Wait for skeleton loaders to resolve ----
    // The stats row renders StatCardSkeleton components while loading=true.
    // Each StatCard renders a <p> with the label text once loaded.
    // "Total Clients" is the first stat card — waiting for it guarantees the
    // stats API round-trip has completed before we snapshot.
    await expect(
      page.getByText('Total Clients', { exact: false }),
    ).toBeVisible({ timeout: 15_000 });

    // The "Recent Invoices" section header appears once that widget has loaded.
    await expect(
      page.getByRole('heading', { name: /recent invoices/i }),
    ).toBeVisible({ timeout: 15_000 });

    // ---- Collect locators for dynamic / volatile content to mask ----

    // Stat-card values: the <p> tags that hold currency amounts or counts.
    // They sit inside the stats grid and carry classes "text-2xl font-bold".
    // We mask the entire stats row rather than individual cells so any number
    // of stat cards (the layout is configurable) are all covered.
    const statsRow = page.locator('div.grid').first();

    // Recent-invoices table body: live data rows change between test runs.
    const invoicesTableBody = page
      .getByRole('heading', { name: /recent invoices/i })
      .locator('../..')
      .locator('tbody');

    // Recent-tickets table body.
    const ticketsTableBody = page
      .getByRole('heading', { name: /open tickets/i })
      .locator('../..')
      .locator('tbody');

    // Revenue bar chart container — the chart SVG changes month to month.
    const revenueChart = page.locator('[style*="height: 220px"]');

    // Activity feed: timestamps and action descriptions change every run.
    const activityFeed = page
      .getByRole('heading', { name: /recent activity/i })
      .locator('../..');

    // Smart-suggestions widget: content depends on live CRM state.
    const smartSuggestions = page
      .getByRole('heading', { name: /smart suggestions/i })
      .locator('../..');

    // Leads-by-stage chart (bar heights reflect live data).
    const leadsByStage = page
      .getByText(/leads by stage/i)
      .locator('../..');

    // Goals-progress widget.
    const goalsProgress = page
      .getByText(/goals progress/i)
      .locator('../..');

    // Calendar-preview widget.
    const calendarPreview = page
      .getByText(/calendar preview/i)
      .locator('../..');

    // Announcements banner — only rendered when announcements exist.
    const announcementsBanner = page.locator('[aria-label="announcements"], [data-widget="announcements"]');

    // Tasks due today.
    const tasksDueToday = page
      .getByText(/tasks due today/i)
      .locator('../..');

    // ---- Screenshot with all volatile regions masked ----
    await expect(page).toHaveScreenshot('dashboard.png', {
      fullPage: true,
      animations: 'disabled',
      maxDiffPixelRatio: 0.02,
      mask: [
        statsRow,
        invoicesTableBody,
        ticketsTableBody,
        revenueChart,
        activityFeed,
        smartSuggestions,
        leadsByStage,
        goalsProgress,
        calendarPreview,
        announcementsBanner,
        tasksDueToday,
      ],
    });
  });
});
