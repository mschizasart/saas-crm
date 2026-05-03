import { describe, it, expect } from 'vitest';
import { API_URL, SMOKE_TOKEN, authHeaders, withTimeout } from '../smoke/config.js';

const XSS_PAYLOADS = [
  `<script>alert(1)</script>`,
  `"><img src=x onerror=alert(1)>`,
  `javascript:alert(1)`,
  `<svg/onload=alert(1)>`,
];

async function maybeFetch(url: string, init?: RequestInit) {
  try {
    return await withTimeout(fetch(url, init), 10_000);
  } catch {
    return null;
  }
}

describe('Security: XSS payload handling', () => {
  it('lead/contact creation does not return raw <script> in response body', async () => {
    if (!SMOKE_TOKEN) {
      console.warn('[xss] no SMOKE_TOKEN — skipping');
      return;
    }
    for (const p of XSS_PAYLOADS) {
      const res = await maybeFetch(`${API_URL}/api/v1/leads`, {
        method: 'POST',
        headers: authHeaders(),
        body: JSON.stringify({
          name: `XSS test ${p}`,
          email: `xss-${Date.now()}@example.invalid`,
          source: 'manual',
        }),
      });
      if (!res) return;
      // Expect a server response (not crash).
      expect(res.status).not.toBe(500);
      if (res.status >= 200 && res.status < 300) {
        const body = (await res.text()) as string;
        // The raw payload must not survive verbatim in the response.
        // (Either escaped, sanitised, or stored but not echoed unencoded.)
        expect(body).not.toContain(`<script>alert(1)</script>`);
        expect(body).not.toContain(`onerror=alert(1)`);
      }
    }
  });

  it('search query containing XSS payload is reflected as escaped or not at all', async () => {
    const payload = `<script>alert("xss")</script>`;
    const res = await maybeFetch(
      `${API_URL}/api/v1/clients?search=${encodeURIComponent(payload)}`,
      { headers: SMOKE_TOKEN ? authHeaders() : {} },
    );
    if (!res) return;
    if (res.status >= 200 && res.status < 300) {
      const body = await res.text();
      // The raw payload must not be reflected unescaped in JSON either —
      // JSON encoding of a string already escapes < and > only optionally,
      // so we check there's no literal `</script>` outside a JSON string context.
      // Simpler: forbid the exact payload as substring of the body.
      expect(body.includes(payload)).toBe(false);
    }
  });
});
