/**
 * Shared helpers for the visual regression suite.
 *
 * Exports:
 *   - VIEWPORTS         the desktop + mobile sizes we snapshot every page at
 *   - THEMES            the colour-scheme variants we snapshot every page at
 *   - loginAsTestUser   navigates to /login, fills creds, awaits redirect
 *   - prepareForSnapshot wait for net-idle + hide flaky elements + freeze
 *                        animations. Call before every toHaveScreenshot()
 *   - snapshotMatrix    iterate (theme × viewport) for one URL and emit
 *                        4 named screenshots — used by every page spec
 *   - getFirstClientId  one-shot API helper for `/clients/:id` etc.
 *   - getFirstInvoiceId same
 */
import { expect, type Page, type APIRequestContext } from '@playwright/test';

// ── Constants ────────────────────────────────────────────────────────────

export const VIEWPORTS = {
  desktop: { width: 1440, height: 900 },
  mobile: { width: 375, height: 812 },
} as const;

export type ViewportName = keyof typeof VIEWPORTS;
export type ThemeName = 'light' | 'dark';
export const THEMES: ThemeName[] = ['light', 'dark'];

const E2E_EMAIL = process.env.E2E_EMAIL ?? 'mschizas@fletcher.com.cy';
const E2E_PASSWORD = process.env.E2E_PASSWORD ?? 'password123';

// ── Login ────────────────────────────────────────────────────────────────

/**
 * Logs in as the staff test user. Uses E2E_TOKEN if available (skip UI),
 * otherwise fills the login form and waits for the /dashboard redirect.
 *
 * Matches the existing fixtures.ts contract used by apps/web/e2e so we don't
 * fork two parallel auth helpers.
 */
export async function loginAsTestUser(page: Page): Promise<void> {
  const preSignedToken = process.env.E2E_TOKEN;

  if (preSignedToken) {
    await page.goto('/login');
    await page.evaluate((tok) => {
      localStorage.setItem('access_token', tok);
    }, preSignedToken);
    await page.goto('/dashboard');
    await page.waitForURL(/\/dashboard/, { timeout: 15_000 });
    return;
  }

  await page.goto('/login');
  await page.getByLabel(/email/i).fill(E2E_EMAIL);
  await page.getByLabel(/password/i).fill(E2E_PASSWORD);
  await page.getByRole('button', { name: /sign in|log in|login/i }).click();
  await page.waitForURL(/\/dashboard/, { timeout: 15_000 });
}

// ── Theme application ────────────────────────────────────────────────────

/**
 * Force light or dark mode. The app's theme hook reads localStorage['theme']
 * AND honours the `prefers-color-scheme` media query when no value is stored.
 *
 * We do BOTH: write localStorage AND emulate the media query, so the page
 * renders consistently no matter which signal the underlying component
 * inspects.
 */
export async function setTheme(page: Page, theme: ThemeName): Promise<void> {
  await page.emulateMedia({ colorScheme: theme });
  await page.addInitScript((t) => {
    try {
      localStorage.setItem('theme', t);
      // App's no-flash inline script reads this on next load.
      document.documentElement.classList.toggle('dark', t === 'dark');
    } catch {
      /* storage may be unavailable on the about:blank initial page */
    }
  }, theme);
}

/**
 * Apply the theme to an already-loaded page. Useful when you want to flip
 * theme without reloading (saves ~1s per test).
 */
export async function applyThemeOnLoadedPage(page: Page, theme: ThemeName): Promise<void> {
  await page.emulateMedia({ colorScheme: theme });
  await page.evaluate((t) => {
    try {
      localStorage.setItem('theme', t);
      document.documentElement.classList.toggle('dark', t === 'dark');
    } catch { /* noop */ }
  }, theme);
}

// ── Pre-snapshot stabilisation ───────────────────────────────────────────

/**
 * CSS that hides every element known to flake between runs:
 *   - `time` and `[datetime]` (relative dates render `2 min ago`)
 *   - any element with a `data-testid="timestamp"`-style hook
 *   - skeleton loaders left over from races
 *   - Recharts SVGs — non-deterministic SVG attribute ordering causes
 *     pixel drift even with identical input
 *   - notification dots / live badges
 */
const HIDE_FLAKY_CSS = `
  /* Timestamps & relative dates */
  time,
  [datetime],
  [data-testid="timestamp"],
  [data-testid="relative-time"],
  [data-testid="last-updated"],
  [data-flaky="timestamp"],
  .timestamp,
  .relative-time,
  /* Random-id hints that occasionally leak into the UI (e.g. "Invoice 8e3a-…") */
  [data-testid="entity-id"],
  /* Skeleton loaders — should be gone by the time we snapshot, but in case */
  [data-testid$="-skeleton"],
  [class*="Skeleton"],
  .animate-pulse,
  /* Charts — Recharts/Chart.js render non-deterministic SVG attrs */
  .recharts-wrapper,
  .recharts-surface,
  [data-testid="chart"],
  [data-flaky="chart"],
  canvas,
  /* Live-update dots / online indicators */
  [data-testid="online-indicator"],
  [data-testid="notification-dot"] {
    visibility: hidden !important;
  }

  /* Disable all animations + transitions — belt to Playwright's animations:'disabled' */
  *, *::before, *::after {
    animation: none !important;
    transition: none !important;
    caret-color: transparent !important;
  }
`;

export interface PrepareOptions {
  /**
   * Selector that must be present + visible before snapshotting. Defaults to
   * `h1` because every page in the admin shell renders a title.
   */
  stableSelector?: string;
  /** How long to wait for the stable selector. Defaults to 15s. */
  stableTimeout?: number;
  /** Whether to wait for `networkidle`. Default true. Disable for pages that
   *  hold a long-poll connection (chat, inbox websocket). */
  waitForNetworkIdle?: boolean;
  /** Extra CSS to inject on top of HIDE_FLAKY_CSS — e.g. spec-specific masks. */
  extraCss?: string;
}

/**
 * Wait until the page is visually stable, then inject the flaky-hide CSS.
 * Always call this immediately before `expect(page).toHaveScreenshot(...)`.
 */
export async function prepareForSnapshot(page: Page, opts: PrepareOptions = {}): Promise<void> {
  const {
    stableSelector = 'h1',
    stableTimeout = 15_000,
    waitForNetworkIdle = true,
    extraCss = '',
  } = opts;

  if (waitForNetworkIdle) {
    await page.waitForLoadState('networkidle', { timeout: 30_000 }).catch(() => {
      // Some pages keep a long-poll open. Falling back to `domcontentloaded`
      // is fine — the stableSelector wait below covers the render check.
    });
  }

  // Wait for the stable element. If it doesn't appear we still try to
  // snapshot — the diff will catch the regression.
  await page
    .locator(stableSelector)
    .first()
    .waitFor({ state: 'visible', timeout: stableTimeout })
    .catch(() => { /* keep going; snapshot will reveal the blank page */ });

  // Wait for any skeleton loaders to disappear.
  await page
    .locator('[class*="Skeleton"], .animate-pulse')
    .first()
    .waitFor({ state: 'hidden', timeout: 5_000 })
    .catch(() => { /* ok if there were never any */ });

  await page.addStyleTag({ content: HIDE_FLAKY_CSS + '\n' + extraCss });

  // Scroll to top — fullPage screenshots start there, but a previous step
  // may have scrolled while waiting for an element.
  await page.evaluate(() => window.scrollTo(0, 0));
}

// ── Snapshot matrix ──────────────────────────────────────────────────────

export interface SnapshotMatrixOptions extends PrepareOptions {
  /**
   * Filename stem. The matrix produces:
   *   <name>-light-desktop.png
   *   <name>-light-mobile.png
   *   <name>-dark-desktop.png
   *   <name>-dark-mobile.png
   */
  name: string;
  /** URL to navigate to (relative to baseURL). */
  url: string;
  /** Function called BEFORE every snapshot — for pages that need extra setup
   *  (open a dropdown, switch a tab, etc). Receives the prepared page. */
  beforeSnapshot?: (page: Page, ctx: { theme: ThemeName; viewport: ViewportName }) => Promise<void>;
  /** Whether the page requires authentication. Defaults to true. */
  authenticated?: boolean;
}

/**
 * Iterate (theme × viewport) and emit 4 named screenshots. Logs in once at
 * the start if `authenticated`. Uses the same Page across iterations to
 * avoid the cost of relogging in for every variant.
 */
export async function snapshotMatrix(
  page: Page,
  opts: SnapshotMatrixOptions,
): Promise<void> {
  const {
    name,
    url,
    beforeSnapshot,
    authenticated = true,
    ...prepareOpts
  } = opts;

  if (authenticated) {
    await loginAsTestUser(page);
  }

  for (const theme of THEMES) {
    for (const viewport of Object.keys(VIEWPORTS) as ViewportName[]) {
      const size = VIEWPORTS[viewport];
      await page.setViewportSize(size);
      await applyThemeOnLoadedPage(page, theme);

      await page.goto(url, { waitUntil: 'domcontentloaded' });
      await prepareForSnapshot(page, prepareOpts);

      if (beforeSnapshot) {
        await beforeSnapshot(page, { theme, viewport });
        // After the hook the DOM may have changed — re-apply our
        // flaky-hide CSS so any newly-rendered timestamps stay hidden.
        await prepareForSnapshot(page, { ...prepareOpts, waitForNetworkIdle: false });
      }

      await expect(page).toHaveScreenshot(`${name}-${theme}-${viewport}.png`, {
        fullPage: true,
        animations: 'disabled',
      });
    }
  }
}

// ── API helpers (data-driven specs) ──────────────────────────────────────

const API_BASE = process.env.E2E_API_URL ?? 'http://localhost:3001';

interface ApiAuthResult {
  token: string;
}

/**
 * Cached login → access-token, used by the data-driven specs that need to
 * fetch a real id (clients, invoices, …).
 */
let cachedToken: string | null = null;

export async function getApiToken(request: APIRequestContext): Promise<string> {
  if (cachedToken) return cachedToken;
  if (process.env.E2E_TOKEN) {
    cachedToken = process.env.E2E_TOKEN;
    return cachedToken;
  }
  const res = await request.post(`${API_BASE}/api/v1/auth/login`, {
    data: { email: E2E_EMAIL, password: E2E_PASSWORD },
  });
  if (!res.ok()) {
    throw new Error(`API login failed: HTTP ${res.status()}`);
  }
  const body = await res.json();
  const token = body.accessToken ?? body.access_token ?? body.token;
  if (!token) throw new Error('Login response missing accessToken');
  cachedToken = token as string;
  return cachedToken;
}

async function fetchFirstId(
  request: APIRequestContext,
  path: string,
): Promise<string | null> {
  try {
    const token = await getApiToken(request);
    const res = await request.get(`${API_BASE}${path}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok()) return null;
    const body = await res.json().catch(() => ({}));
    const arr = body.data ?? body.items ?? body;
    if (Array.isArray(arr) && arr.length > 0 && arr[0]?.id) return arr[0].id;
    return null;
  } catch {
    return null;
  }
}

export const getFirstClientId   = (r: APIRequestContext) => fetchFirstId(r, '/api/v1/clients?limit=1');
export const getFirstInvoiceId  = (r: APIRequestContext) => fetchFirstId(r, '/api/v1/invoices?limit=1');
export const getFirstLeadId     = (r: APIRequestContext) => fetchFirstId(r, '/api/v1/leads?limit=1');
export const getFirstEstimateId = (r: APIRequestContext) => fetchFirstId(r, '/api/v1/estimates?limit=1');
export const getFirstProposalId = (r: APIRequestContext) => fetchFirstId(r, '/api/v1/proposals?limit=1');
