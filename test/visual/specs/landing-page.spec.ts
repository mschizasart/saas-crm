/**
 * Visual: / (public marketing landing page)
 *
 * No authentication. The landing page is the most-visible regression target
 * because it's what unauthenticated visitors see first. Captures 4 variants.
 */
import { test } from '@playwright/test';
import { snapshotMatrix } from '../setup';

test.describe('Visual: landing page', () => {
  test('renders consistently across themes and viewports', async ({ page }) => {
    await snapshotMatrix(page, {
      name: 'landing-page',
      url: '/',
      authenticated: false,
      stableSelector: 'h1',
      extraCss: `
        /* The hero may include a "live" customer count or a year string ($CURRENT_YEAR) */
        [data-flaky="counter"], [data-testid="live-count"] { visibility: hidden !important; }
      `,
    });
  });
});
