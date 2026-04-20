import { defineConfig, devices } from '@playwright/test';

const isProdRun = Boolean(process.env.E2E_BASE_URL);

export default defineConfig({
  testDir: './e2e',
  snapshotDir: './e2e/__screenshots__',
  timeout: 30_000,
  expect: {
    timeout: 5_000,
    toHaveScreenshot: { maxDiffPixelRatio: 0.02 },
  },
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 2 : 1,
  workers: process.env.CI ? 1 : undefined,

  reporter: [['html', { open: 'never' }], ['list']],

  use: {
    baseURL: process.env.E2E_BASE_URL ?? 'http://localhost:3000',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },

  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],

  // Only spin up a dev server when no external base URL is given.
  // When E2E_BASE_URL is set (CI smoke / prod run) we expect the server
  // to already be running — don't attempt to start one.
  ...(isProdRun
    ? {}
    : {
        webServer: {
          command: 'pnpm dev',
          url: 'http://localhost:3000',
          reuseExistingServer: true,
          timeout: 120_000,
        },
      }),
});
