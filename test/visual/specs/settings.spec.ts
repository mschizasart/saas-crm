/**
 * Visual: /settings/email + /settings/security + /settings/automations + /settings/spam-filters
 *
 * Settings pages are the most stable area of the app — they're forms with
 * mostly-empty fields. Lowest baseline-flake risk in the suite.
 *
 * 4 settings pages × 4 variants = 16 baselines.
 */
import { test } from '@playwright/test';
import { snapshotMatrix } from '../setup';

const SETTINGS_PAGES: { name: string; url: string }[] = [
  { name: 'settings-email',        url: '/settings/email' },
  { name: 'settings-security',     url: '/settings/security' },
  { name: 'settings-automations',  url: '/settings/automations' },
  { name: 'settings-spam-filters', url: '/settings/spam-filters' },
];

test.describe('Visual: settings', () => {
  for (const { name, url } of SETTINGS_PAGES) {
    test(`${name} page`, async ({ page }) => {
      await snapshotMatrix(page, {
        name,
        url,
        stableSelector: 'h1',
        extraCss: `
          /* Some settings show a recently-saved-at toast / timestamp */
          [data-testid="last-saved"],
          [data-testid="recovery-codes"] { visibility: hidden !important; }
          /* API-key tables and OAuth-token previews must be masked */
          table tbody, code { visibility: hidden !important; }
        `,
      });
    });
  }
});
