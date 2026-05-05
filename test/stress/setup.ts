/**
 * Stress-suite environment + token acquisition.
 *
 * Each scenario imports `acquireTokens()` and `STRESS_API_URL`.
 *
 * Hard prod-safety guard: if STRESS_API_URL contains "appoinlycrm" we
 * REFUSE to run unless STRESS_ALLOW_PROD=1. These suites bury a server
 * in load — never point at prod by accident.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));

const PROD_BLOCKLIST = ['appoinlycrm.net', 'appoinly-crm', 'appoinly.app'];

function safeUrl(url: string): string {
  if (process.env.STRESS_ALLOW_PROD === '1') return url;
  for (const banned of PROD_BLOCKLIST) {
    if (url.toLowerCase().includes(banned)) {
      throw new Error(
        `Refusing to stress-test against prod-like URL: ${url}. ` +
          `Set STRESS_ALLOW_PROD=1 to override (you almost never want this).`,
      );
    }
  }
  return url;
}

export const REPO_ROOT =
  process.env.REPO_ROOT || resolve(__dirname, '..', '..');

export const STRESS_API_URL = safeUrl(
  process.env.STRESS_API_URL ?? 'http://localhost:3001',
);

export const STRESS_RESULTS_DIR = join(REPO_ROOT, 'test/results');
export const STRESS_BIN_DIR = join(REPO_ROOT, 'test/stress/.bin');

mkdirSync(STRESS_RESULTS_DIR, { recursive: true });

export const STRESS_TIMEOUT_MS = Number(process.env.STRESS_TIMEOUT_MS ?? 15000);

export interface StressTokens {
  /** JWT for tenant A. */
  tokenA: string;
  /** JWT for tenant B. */
  tokenB: string;
  /** Tenant A organisation id (best-effort, decoded from JWT). */
  orgAId?: string;
  /** Tenant B organisation id (best-effort, decoded from JWT). */
  orgBId?: string;
  /** Tenant A user id (decoded from JWT.sub). */
  userAId?: string;
  /** Tenant B user id (decoded from JWT.sub). */
  userBId?: string;
}

export interface AcquireOptions {
  /** Optional override for the login email/password env-var pair names. */
  emailEnvA?: string;
  passwordEnvA?: string;
  emailEnvB?: string;
  passwordEnvB?: string;
  /** Optional explicit credentials, beats env vars. */
  credentialsA?: { email: string; password: string };
  credentialsB?: { email: string; password: string };
}

/**
 * Acquire two distinct-tenant JWTs.
 *
 * Resolution order per slot:
 *   1. STRESS_TOKEN_A / STRESS_TOKEN_B — already a bearer string. Used as-is.
 *   2. Live login via POST /api/v1/auth/login with credentials from
 *      STRESS_EMAIL_A / STRESS_PASSWORD_A (resp. _B).
 *   3. Throw — caller must skip the suite.
 *
 * If the API isn't reachable, returns null so callers can skip cleanly.
 */
export async function acquireTokens(
  opts: AcquireOptions = {},
): Promise<StressTokens | null> {
  // 0. probe the API. If it's down, bail cleanly.
  if (!(await apiReachable())) return null;

  const tokenA =
    process.env.STRESS_TOKEN_A ??
    (await loginOrNull(
      opts.credentialsA?.email ?? process.env[opts.emailEnvA ?? 'STRESS_EMAIL_A'],
      opts.credentialsA?.password ??
        process.env[opts.passwordEnvA ?? 'STRESS_PASSWORD_A'],
    ));

  const tokenB =
    process.env.STRESS_TOKEN_B ??
    (await loginOrNull(
      opts.credentialsB?.email ?? process.env[opts.emailEnvB ?? 'STRESS_EMAIL_B'],
      opts.credentialsB?.password ??
        process.env[opts.passwordEnvB ?? 'STRESS_PASSWORD_B'],
    ));

  if (!tokenA || !tokenB) return null;

  const a = decodeJwtPayload(tokenA);
  const b = decodeJwtPayload(tokenB);

  if (a?.orgId && b?.orgId && a.orgId === b.orgId) {
    throw new Error(
      'STRESS_TOKEN_A and STRESS_TOKEN_B resolve to the SAME orgId — ' +
        'tenant-isolation tests would be meaningless. Provide credentials ' +
        'for two distinct tenants.',
    );
  }

  return {
    tokenA,
    tokenB,
    orgAId: a?.orgId,
    orgBId: b?.orgId,
    userAId: a?.sub,
    userBId: b?.sub,
  };
}

async function apiReachable(): Promise<boolean> {
  try {
    const res = await fetchWithTimeout(`${STRESS_API_URL}/api/health`, {}, 4000);
    if (res.status < 500) return true;
  } catch {
    /* fall through */
  }
  try {
    const res = await fetchWithTimeout(`${STRESS_API_URL}/health`, {}, 4000);
    return res.status < 500;
  } catch {
    return false;
  }
}

async function loginOrNull(
  email: string | undefined,
  password: string | undefined,
): Promise<string | null> {
  if (!email || !password) return null;
  try {
    const res = await fetchWithTimeout(
      `${STRESS_API_URL}/api/v1/auth/login`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email, password }),
      },
      8000,
    );
    if (res.status !== 200 && res.status !== 201) return null;
    const body = (await res.json().catch(() => ({}))) as any;
    // Common shapes: { accessToken }, { token }, { data: { accessToken } }
    return (
      body?.accessToken ??
      body?.token ??
      body?.access_token ??
      body?.data?.accessToken ??
      body?.data?.token ??
      null
    );
  } catch {
    return null;
  }
}

export async function fetchWithTimeout(
  url: string,
  init: RequestInit = {},
  ms = STRESS_TIMEOUT_MS,
): Promise<Response> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), ms);
  try {
    return await fetch(url, { ...init, signal: ctrl.signal });
  } finally {
    clearTimeout(timer);
  }
}

export function decodeJwtPayload(jwt: string):
  | { sub?: string; orgId?: string; [k: string]: unknown }
  | null {
  try {
    const part = jwt.split('.')[1];
    if (!part) return null;
    const json = Buffer.from(
      part.replace(/-/g, '+').replace(/_/g, '/'),
      'base64',
    ).toString('utf8');
    return JSON.parse(json);
  } catch {
    return null;
  }
}

/** Bearer-auth header helper. */
export function bearer(token: string): Record<string, string> {
  return {
    authorization: `Bearer ${token}`,
    'content-type': 'application/json',
  };
}

/** Write a result JSON for a scenario. */
export function writeScenarioResult(name: string, payload: unknown): string {
  const path = join(STRESS_RESULTS_DIR, `stress-${name}.json`);
  mkdirSync(STRESS_RESULTS_DIR, { recursive: true });
  writeFileSync(path, JSON.stringify(payload, null, 2));
  return path;
}

/** Standard "scenario result" envelope used by every test file. */
export interface ScenarioResult {
  name: string;
  passed: boolean;
  startedAt: string;
  finishedAt: string;
  durationMs: number;
  /** Free-form metrics — printed by the driver. */
  metrics?: Record<string, unknown>;
  /** Reason for failure, if any. */
  failure?: string;
  /** When the scenario could not run at all (no token, etc). */
  skipped?: boolean;
  skipReason?: string;
}
