/**
 * Visual: /login + /portal/login + /platform/login
 *
 * Three distinct login pages — staff, client portal, platform admin.
 * No authentication required (these ARE the auth pages).
 *
 * 3 pages × 4 variants = 12 baselines.
 */
import { test } from '@playwright/test';
import { snapshotMatrix } from '../setup';

const LOGIN_PAGES: { name: string; url: string }[] = [
  { name: 'login-staff',    url: '/login' },
  { name: 'login-portal',   url: '/portal/login' },
  { name: 'login-platform', url: '/platform/login' },
];

test.describe('Visual: login pages', () => {
  for (const { name, url } of LOGIN_PAGES) {
    test(`${name} page`, async ({ page }) => {
      await snapshotMatrix(page, {
        name,
        url,
        authenticated: false,
        stableSelector: 'form, h1, h2',
        extraCss: `
          /* Mask the "Forgot password?" link's recently-clicked state */
          a:focus, button:focus { outline: none !important; }
        `,
      });
    });
  }
});
