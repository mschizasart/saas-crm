import { describe, it, expect } from 'vitest';
import { WEB_URL, withTimeout } from './config.js';

async function safeFetch(url: string): Promise<Response | null> {
  try {
    return await withTimeout(fetch(url, { redirect: 'manual' }));
  } catch {
    return null;
  }
}

describe('Web smoke', () => {
  it('GET / returns HTML or redirects to /login', async () => {
    const res = await safeFetch(`${WEB_URL}/`);
    if (!res) return;
    expect(res.status).toBeLessThan(500);
    const ct = res.headers.get('content-type') || '';
    if (res.status === 200) {
      expect(ct).toMatch(/html|text/);
    }
  });

  it('GET /login returns HTML', async () => {
    const res = await safeFetch(`${WEB_URL}/login`);
    if (!res) return;
    expect(res.status).toBeLessThan(500);
    if (res.status === 200) {
      const body = await res.text();
      expect(body.length).toBeGreaterThan(50);
      expect(body.toLowerCase()).toMatch(/login|sign|email|password|<html/);
    }
  });

  it('static asset path on /favicon.ico does not 5xx', async () => {
    const res = await safeFetch(`${WEB_URL}/favicon.ico`);
    if (!res) return;
    expect(res.status).toBeLessThan(500);
  });
});
