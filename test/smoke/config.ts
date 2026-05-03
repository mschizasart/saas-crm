/**
 * Smoke test configuration.
 *
 * SMOKE never targets prod (https://www.appoinlycrm.net) by default.
 * If you really want to point it elsewhere, set SMOKE_BASE_URL explicitly —
 * but the runner refuses URLs containing "appoinlycrm" unless
 * SMOKE_ALLOW_PROD=1 is also set.
 */

const PROD_BLOCKLIST = ['appoinlycrm.net', 'appoinly-crm', 'appoinly.app'];

function safeUrl(url: string): string {
  if (process.env.SMOKE_ALLOW_PROD === '1') return url;
  for (const banned of PROD_BLOCKLIST) {
    if (url.toLowerCase().includes(banned)) {
      throw new Error(
        `Refusing to smoke-test against prod-like URL: ${url}. ` +
          `Set SMOKE_ALLOW_PROD=1 to override (you almost never want this).`,
      );
    }
  }
  return url;
}

export const API_URL = safeUrl(
  process.env.SMOKE_BASE_URL ?? process.env.API_URL ?? 'http://localhost:3001',
);

export const WEB_URL = safeUrl(
  process.env.SMOKE_WEB_URL ?? process.env.WEB_URL ?? 'http://localhost:3000',
);

export const SMOKE_TOKEN = process.env.SMOKE_TOKEN ?? '';

export const SMOKE_TIMEOUT_MS = Number(process.env.SMOKE_TIMEOUT_MS ?? 8000);

export function authHeaders() {
  return SMOKE_TOKEN
    ? { authorization: `Bearer ${SMOKE_TOKEN}`, 'content-type': 'application/json' }
    : { 'content-type': 'application/json' };
}

export async function withTimeout<T>(p: Promise<T>, ms = SMOKE_TIMEOUT_MS): Promise<T> {
  return await Promise.race([
    p,
    new Promise<T>((_, rej) =>
      setTimeout(() => rej(new Error(`Smoke timeout after ${ms}ms`)), ms),
    ),
  ]);
}
