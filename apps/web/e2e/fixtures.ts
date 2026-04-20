import { test as base, expect } from '@playwright/test';

type AuthFixtures = {
  loggedInPage: import('@playwright/test').Page;
};

export const test = base.extend<AuthFixtures>({
  loggedInPage: async ({ page }, use) => {
    const preSignedToken = process.env.E2E_TOKEN;

    if (preSignedToken) {
      // Token-injection mode: skip the UI login, seed localStorage directly.
      // Useful for CI against prod without exposing a real password.
      await page.goto('/login');
      await page.evaluate((tok) => {
        localStorage.setItem('access_token', tok);
      }, preSignedToken);
      await page.goto('/dashboard');
      await page.waitForURL(/\/dashboard/, { timeout: 10_000 });
      await use(page);
      return;
    }

    const email = process.env.E2E_EMAIL;
    const password = process.env.E2E_PASSWORD;
    if (!email || !password) {
      throw new Error('Set either E2E_TOKEN, or E2E_EMAIL + E2E_PASSWORD');
    }

    await page.goto('/login');
    await page.getByLabel(/email/i).fill(email);
    await page.getByLabel(/password/i).fill(password);
    await page.getByRole('button', { name: /sign in|log in|login/i }).click();
    await page.waitForURL(/\/dashboard/, { timeout: 10_000 });

    await use(page);
  },
});

export { expect };
