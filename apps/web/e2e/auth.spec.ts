/**
 * auth.spec.ts
 *
 * Critical-path: login flow.
 * Catches: login page crash, redirect not happening, token not stored.
 */

import { test, expect } from './fixtures';

test.describe('Authentication', () => {
  test('staff login redirects to /dashboard', async ({ loggedInPage }) => {
    // fixtures.ts already performed the login and awaited /dashboard — if we
    // reach here the auth flow completed without a console crash.
    await expect(loggedInPage).toHaveURL(/\/dashboard/);
  });
});
