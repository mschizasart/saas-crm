/**
 * Vitest + RTL global setup.
 *
 * Mocks the network/router boundary so component tests can render real
 * components without pulling in Next.js runtime, the auth flow, or the
 * production API.
 *
 * Per-test access:
 *   - `mockApiFetch` (global)            — vi.fn() backing `apiFetch`
 *   - `mockRouter` (global)              — controllable next/navigation router
 *   - `mockSearchParams` (global)        — URLSearchParams for useSearchParams
 *   - `setMockPathname(path)` (global)   — sets the value returned by usePathname
 *
 * Reset between every test via `clearMocks: true` + an `afterEach` here.
 */

import '@testing-library/jest-dom/vitest';
import { afterEach, beforeEach, vi } from 'vitest';
import { cleanup } from '@testing-library/react';

// ─── Globals visible to test files ───────────────────────────────────────

declare global {
  // eslint-disable-next-line no-var
  var mockApiFetch: ReturnType<typeof vi.fn>;
  // eslint-disable-next-line no-var
  var mockRouter: {
    push: ReturnType<typeof vi.fn>;
    replace: ReturnType<typeof vi.fn>;
    refresh: ReturnType<typeof vi.fn>;
    back: ReturnType<typeof vi.fn>;
    forward: ReturnType<typeof vi.fn>;
    prefetch: ReturnType<typeof vi.fn>;
  };
  // eslint-disable-next-line no-var
  var mockSearchParams: URLSearchParams;
  // eslint-disable-next-line no-var
  var setMockPathname: (path: string) => void;
}

// Initial values — re-bound in beforeEach below.
globalThis.mockApiFetch = vi.fn();
globalThis.mockRouter = {
  push: vi.fn(),
  replace: vi.fn(),
  refresh: vi.fn(),
  back: vi.fn(),
  forward: vi.fn(),
  prefetch: vi.fn(),
};
globalThis.mockSearchParams = new URLSearchParams();

let _pathname = '/';
globalThis.setMockPathname = (p: string) => {
  _pathname = p;
};

// ─── next/navigation mock ────────────────────────────────────────────────

vi.mock('next/navigation', () => ({
  useRouter: () => globalThis.mockRouter,
  useSearchParams: () => globalThis.mockSearchParams,
  usePathname: () => _pathname,
  redirect: vi.fn(),
  notFound: vi.fn(),
}));

// ─── next/link mock — renders a plain anchor so href + children tests work
vi.mock('next/link', async () => {
  const React = await import('react');
  return {
    __esModule: true,
    default: ({ href, children, ...rest }: any) => {
      const h = typeof href === 'string' ? href : href?.pathname ?? '#';
      // eslint-disable-next-line jsx-a11y/anchor-is-valid
      return React.createElement('a', { href: h, ...rest }, children);
    },
  };
});

// ─── lib/api mock ────────────────────────────────────────────────────────

vi.mock('@/lib/api', () => ({
  apiFetch: (...args: unknown[]) => globalThis.mockApiFetch(...args),
  getAccessToken: vi.fn(() => 'test-token'),
  getRefreshToken: vi.fn(() => null),
  setTokens: vi.fn(),
  clearTokens: vi.fn(),
  isTokenExpired: vi.fn(() => false),
  API_BASE: 'http://localhost:3001',
}));

// ─── sonner (toast) — silence + spy
vi.mock('sonner', () => {
  const toast: any = vi.fn();
  toast.success = vi.fn();
  toast.error = vi.fn();
  toast.info = vi.fn();
  toast.message = vi.fn();
  toast.warning = vi.fn();
  toast.dismiss = vi.fn();
  toast.promise = vi.fn();
  return { toast, Toaster: () => null };
});

// ─── window.matchMedia — Tailwind / dark-mode reads it on mount ──────────

// NOTE: not using vi.fn() here — `restoreMocks: true` in vitest.config.ts
// would strip the implementation between tests, causing matchMedia() to
// return undefined and break components that read .matches on mount.
const matchMediaStub = (query: string) => ({
  matches: false,
  media: query,
  onchange: null,
  addListener: () => {}, // legacy
  removeListener: () => {}, // legacy
  addEventListener: () => {},
  removeEventListener: () => {},
  dispatchEvent: () => false,
});
Object.defineProperty(window, 'matchMedia', {
  writable: true,
  configurable: true,
  value: matchMediaStub,
});

// ─── localStorage stub — jsdom has it but reset between tests ────────────

beforeEach(() => {
  // Re-bind so each test gets a fresh vi.fn.
  globalThis.mockApiFetch = vi.fn();
  globalThis.mockRouter = {
    push: vi.fn(),
    replace: vi.fn(),
    refresh: vi.fn(),
    back: vi.fn(),
    forward: vi.fn(),
    prefetch: vi.fn(),
  };
  globalThis.mockSearchParams = new URLSearchParams();
  _pathname = '/';

  try {
    window.localStorage.clear();
    window.sessionStorage.clear();
  } catch {
    /* ignore */
  }
});

afterEach(() => {
  cleanup();
});

// ─── window.scrollTo / element.scrollIntoView — jsdom doesn't implement
window.scrollTo = window.scrollTo || (vi.fn() as any);
if (!Element.prototype.scrollIntoView) {
  Element.prototype.scrollIntoView = vi.fn();
}

// ─── URL.createObjectURL — jsdom doesn't implement
if (!('createObjectURL' in URL)) {
  // @ts-expect-error - test stub
  URL.createObjectURL = vi.fn(() => 'blob:mock');
}
if (!('revokeObjectURL' in URL)) {
  // @ts-expect-error - test stub
  URL.revokeObjectURL = vi.fn();
}
