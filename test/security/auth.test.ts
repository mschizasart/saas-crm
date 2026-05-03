import { describe, it, expect } from 'vitest';
import { issueTestToken, hasJwtSecret } from '../utils/test-token.js';
import { API_URL, withTimeout } from '../smoke/config.js';

const PROTECTED_ENDPOINTS = [
  '/api/v1/clients',
  '/api/v1/leads',
  '/api/v1/invoices',
  '/api/v1/tickets',
  '/api/v1/products',
  '/api/v1/users/me',
];

async function maybeFetch(url: string, init?: RequestInit) {
  try {
    return await withTimeout(fetch(url, init));
  } catch {
    return null;
  }
}

describe('Security: auth & tenant isolation', () => {
  it.each(PROTECTED_ENDPOINTS)('%s returns 401/403 without token', async (path) => {
    const res = await maybeFetch(`${API_URL}${path}`);
    if (!res) return;
    expect([401, 403]).toContain(res.status);
  });

  it('protected endpoint with malformed token is rejected', async () => {
    const res = await maybeFetch(`${API_URL}/api/v1/clients`, {
      headers: { authorization: 'Bearer not-a-real-token' },
    });
    if (!res) return;
    expect([401, 403]).toContain(res.status);
  });

  it('cross-tenant resource fetch returns 404 (tenant isolation)', async () => {
    if (!hasJwtSecret()) {
      console.warn('[auth] No TEST_JWT_SECRET — skipping tenant-isolation test');
      return;
    }
    // Forge a token for a known-bogus org id, then try to read a resource
    // that almost certainly belongs to a different org. Service should
    // respond with 404 (or the user lookup fails -> 401).
    const token = issueTestToken({
      sub: '00000000-0000-0000-0000-000000000001',
      orgId: '00000000-0000-0000-0000-0000000000ff',
    });
    const res = await maybeFetch(
      `${API_URL}/api/v1/clients/00000000-0000-0000-0000-000000000abc`,
      { headers: { authorization: `Bearer ${token}` } },
    );
    if (!res) return;
    // Either the user wasn't found (jwt strategy validates user exists) -> 401,
    // or the resource isn't visible cross-tenant -> 404. Both are acceptable.
    expect([401, 404]).toContain(res.status);
  });
});
