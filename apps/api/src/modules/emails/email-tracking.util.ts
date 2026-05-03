import { randomBytes } from 'crypto';

/**
 * 12-char URL-safe id (a-z0-9, no ambiguous chars). 9 random bytes give
 * us 72 bits of entropy — more than enough for the cardinality we'll see
 * (uniqueness is enforced via a partial unique index on outbound_messages
 * regardless). We use a hand-rolled alphabet rather than pulling in a
 * `nanoid` dep — see package.json, no nanoid installed.
 *
 * Intentionally avoids `0`, `O`, `1`, `I`, `l` — humans occasionally
 * eyeball tracking URLs in logs and confusing characters waste time.
 */
const ALPHABET =
  'abcdefghjkmnpqrstuvwxyz23456789'; // 31 chars
export function generateTrackingId(length = 12): string {
  // Math.floor(256 / 31) * 31 = 248 — anything ≥ 248 is rejected to keep
  // the distribution uniform (rejection sampling).
  const out: string[] = [];
  while (out.length < length) {
    const buf = randomBytes(length * 2);
    for (let i = 0; i < buf.length && out.length < length; i++) {
      const v = buf[i];
      if (v >= 248) continue;
      out.push(ALPHABET[v % 31]);
    }
  }
  return out.join('');
}

export interface RewriteOptions {
  trackingId: string;
  appUrl: string;
}

/**
 * Inject a tracking pixel and rewrite anchor hrefs to route through the
 * click-tracking endpoint.
 *
 * Why regex and not cheerio?
 *   - Adding cheerio/jsdom is ~3 MB of transitive deps for a single
 *     write-once pass over short transactional HTML.
 *   - Our outbound HTML is hand-written by us (templates) — we don't
 *     need a forgiving HTML5 parser.
 *
 * Caveats / known limits:
 *   - Anchors with attributes _after_ href that contain `>` inside an
 *     unquoted value will break parsing. Our templates don't do that.
 *   - `<a href='single-quoted'>` is supported.
 *   - Anchors with no href, or href="" / href="#…" / href="mailto:…"
 *     are left untouched.
 *   - We never rewrite a URL that already points back to our tracking
 *     domain (idempotent — important because EmailsService.send may run
 *     after queue retries).
 *   - Unsubscribe links are detected by substring match in the URL or
 *     anchor text — pragmatic, not bulletproof.
 */
export function injectTracking(html: string, opts: RewriteOptions): string {
  const { trackingId, appUrl } = opts;
  const trackBase = `${appUrl.replace(/\/$/, '')}/api/v1/track`;

  // ── 1. Rewrite anchors ──────────────────────────────────────────────────
  const anchorRe = /<a\b([^>]*?)\bhref\s*=\s*(["'])(.*?)\2([^>]*)>([\s\S]*?)<\/a>/gi;
  const rewritten = html.replace(
    anchorRe,
    (_full, preAttrs, quote, url, postAttrs, inner) => {
      const trimmed = (url ?? '').trim();
      if (!trimmed) return _full;
      // Skip non-http schemes & in-document anchors.
      if (
        trimmed.startsWith('mailto:') ||
        trimmed.startsWith('tel:') ||
        trimmed.startsWith('#') ||
        trimmed.startsWith('javascript:') ||
        trimmed.startsWith('data:')
      ) {
        return _full;
      }
      // Already going through our tracker — leave it alone (idempotent).
      if (trimmed.includes(`/api/v1/track/click/`)) {
        return _full;
      }
      // Unsubscribe carve-out.
      const innerText = inner.replace(/<[^>]+>/g, ' ');
      if (
        /unsubscribe/i.test(trimmed) ||
        /unsubscribe/i.test(innerText) ||
        /list-unsubscribe/i.test(trimmed)
      ) {
        return _full;
      }
      const wrapped =
        `${trackBase}/click/${trackingId}?u=${encodeURIComponent(trimmed)}`;
      return `<a${preAttrs}href=${quote}${wrapped}${quote}${postAttrs}>${inner}</a>`;
    },
  );

  // ── 2. Append the open pixel ────────────────────────────────────────────
  // Place it just before </body> if present, else at the very end.
  // 1×1 transparent GIF, hidden from layout.
  const pixel =
    `<img src="${trackBase}/open/${trackingId}.gif" width="1" height="1" alt="" ` +
    `style="display:none;border:0;width:1px;height:1px;" />`;

  const bodyClose = /<\/body\s*>/i;
  if (bodyClose.test(rewritten)) {
    return rewritten.replace(bodyClose, `${pixel}</body>`);
  }
  return rewritten + pixel;
}
