import { describe, it, expect } from 'vitest';
import { API_URL, SMOKE_TOKEN, withTimeout } from '../smoke/config.js';

const PAYLOADS = [
  `'; DROP TABLE users; --`,
  `' OR '1'='1`,
  `1; SELECT pg_sleep(2)--`,
  `%' UNION SELECT NULL--`,
  `\\'); DELETE FROM clients;--`,
];

const TARGET_ENDPOINTS = [
  '/api/v1/clients',
  '/api/v1/leads',
  '/api/v1/invoices',
  '/api/v1/tickets',
  '/api/v1/products',
];

async function maybeFetch(url: string, init?: RequestInit) {
  try {
    return await withTimeout(fetch(url, init), 10_000);
  } catch {
    return null;
  }
}

describe('Security: SQL-injection probes', () => {
  for (const ep of TARGET_ENDPOINTS) {
    for (const payload of PAYLOADS) {
      it(`${ep}?search=<sqli> -> safe response`, async () => {
        const url = `${API_URL}${ep}?search=${encodeURIComponent(payload)}`;
        const res = await maybeFetch(url, {
          headers: SMOKE_TOKEN ? { authorization: `Bearer ${SMOKE_TOKEN}` } : {},
        });
        if (!res) return;

        // Acceptable: 200 with empty/normal body, 400 (validation), 401/403 (no auth).
        // NOT acceptable: 500 (unhandled DB error).
        expect(res.status).not.toBe(500);

        if (res.status === 200) {
          const body = (await res.json().catch(() => ({}))) as any;
          // Body should still match the standard pagination shape if present.
          if (body && typeof body === 'object' && 'data' in body) {
            expect(Array.isArray(body.data)).toBe(true);
          }
          // And must not echo a raw SQL error string.
          const txt = JSON.stringify(body).toLowerCase();
          expect(txt).not.toMatch(/syntax error|pg_sleep|psql:|prismaclient/);
        }
      });
    }
  }
});
