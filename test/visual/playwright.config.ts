/**
 * Visual regression Playwright config.
 *
 * Separate from apps/web/playwright.config.ts on purpose — that one runs the
 * functional/auth e2e suite and we don't want a bad pixel diff to fail it.
 *
 * Determinism notes:
 *   - Single browser (chromium). Cross-browser visual diffs are noise.
 *   - Single worker. Concurrent runs against the same dev server can race
 *     on data-dependent pages (e.g. /clients while a sibling spec is mutating).
 *   - Animations disabled at the spec level via `animations: 'disabled'`.
 *   - Snapshots stored under test/visual/__screenshots__/ (gitignored — see
 *     test/visual/README.md for the baseline-commit policy).
 *
 * First run:   pnpm test:visual --update-snapshots   (creates baselines)
 * Later runs:  pnpm test:visual                      (fails on drift)
 */
import { defineConfig } from '@playwright/test';
import { join } from 'node:path';

const isExternalRun = Boolean(process.env.E2E_BASE_URL);
const REPO_ROOT = join(__dirname, '..', '..');

export default defineConfig({
  testDir: __dirname,
  testMatch: /specs\/.*\.spec\.ts$/,
  snapshotDir: join(__dirname, '__screenshots__'),
  // The default snapshot path generator includes the project name and OS,
  // which makes baselines wobble on CI vs local. Pin it.
  snapshotPathTemplate:
    '{snapshotDir}/{testFileName}-snapshots/{arg}{ext}',

  // Visual diffs against a real backend can be slow — be generous.
  timeout: 60_000,
  expect: {
    timeout: 10_000,
    toHaveScreenshot: {
      // 1 % of pixels can drift between runs (font hinting, sub-pixel AA).
      // Anything more catches real regressions.
      maxDiffPixelRatio: 0.01,
      // Per-pixel tolerance for colour drift (0..1, smaller = stricter).
      threshold: 0.2,
      animations: 'disabled',
      // Hide caret and scrollbar so they don't pollute diffs.
      caret: 'hide',
      scale: 'css',
    },
  },

  // Visual specs MUST run serially. Parallel runs against the same dev
  // server cause flakiness (cookie races, in-flight nav, etc).
  fullyParallel: false,
  workers: 1,

  forbidOnly: Boolean(process.env.CI),
  // No retries — a flaky visual diff is information; don't paper over it.
  retries: 0,

  reporter: [
    ['list'],
    ['html', { open: 'never', outputFolder: join(REPO_ROOT, 'test/visual/playwright-report') }],
    ['json', { outputFile: join(REPO_ROOT, 'test/results/visual.json') }],
  ],

  use: {
    baseURL: process.env.E2E_BASE_URL ?? 'http://localhost:3000',
    headless: true,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'off',
    // Lock locale + timezone so any leaked dates/numbers render the same way.
    locale: 'en-US',
    timezoneId: 'UTC',
    // Force deterministic colour scheme detection — individual specs may
    // override via `page.emulateMedia()` per snapshot.
    colorScheme: 'light',
  },

  // Single project, single device. Per-page specs handle the
  // viewport / theme matrix themselves so each baseline file is named
  // explicitly (page-light-desktop.png, page-dark-mobile.png, …).
  projects: [
    {
      name: 'chromium-visual',
      use: {
        // We deliberately don't spread `devices['Desktop Chrome']` — its
        // `deviceScaleFactor` is sometimes 2 on macOS Playwright builds and
        // 1 on Linux, which silently doubles screenshot resolution. Pin both.
        viewport: { width: 1440, height: 900 },
        deviceScaleFactor: 1,
        userAgent:
          'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) PlaywrightVisual/1.0 Chrome/120 Safari/537.36',
      },
    },
  ],

  // Only spin up a dev server when no external base URL is given.
  ...(isExternalRun
    ? {}
    : {
        webServer: {
          command: 'pnpm --filter web dev',
          cwd: REPO_ROOT,
          url: 'http://localhost:3000',
          reuseExistingServer: true,
          timeout: 120_000,
          stdout: 'ignore',
          stderr: 'pipe',
        },
      }),
});
