/**
 * Visual: /leads (kanban) + /leads?view=list
 *
 * Two snapshot stems: leads-kanban-* and leads-list-*. Each is captured at
 * 4 variants → 8 baselines in this spec.
 */
import { test } from '@playwright/test';
import { snapshotMatrix } from '../setup';

test.describe('Visual: leads', () => {
  test('kanban view', async ({ page }) => {
    await snapshotMatrix(page, {
      name: 'leads-kanban',
      url: '/leads',
      stableSelector: 'h1',
      extraCss: `
        /* Card content varies per run — mask the cards but keep column
           headers + counts visible (counts are hidden by the .text-2xl
           rule in dashboard spec? no, they're not — they're inline). */
        [data-testid="lead-card"], .kanban-card { visibility: hidden !important; }
        /* Hide column counts to avoid count drift */
        [data-testid="kanban-column-count"] { visibility: hidden !important; }
      `,
    });
  });

  test('list view', async ({ page }) => {
    await snapshotMatrix(page, {
      name: 'leads-list',
      url: '/leads?view=list',
      stableSelector: 'h1',
      extraCss: `
        table tbody { visibility: hidden !important; }
      `,
    });
  });
});
