import * as crypto from 'crypto';

/**
 * Short-lived, signed state tokens for the OAuth 2.0 consent redirect dance.
 *
 * We don't want to bring in `jsonwebtoken` just for this, and we already
 * have ENCRYPTION_KEY at hand — so we roll our own compact JWT-ish token:
 *
 *     base64url(JSON payload) + "." + base64url(HMAC-SHA256(payload, key))
 *
 * The payload is always `{ orgId, provider, nonce, exp }` where `exp` is a
 * unix-epoch second past which the token is considered invalid. TTL is
 * enforced server-side at verification time.
 *
 * NOTE — we reuse ENCRYPTION_KEY as the HMAC secret. Safe because HMAC
 * operates on a separate domain from AES-256-GCM encryption and the hex
 * key has 256 bits of entropy.
 */

const DEFAULT_TTL_SECONDS = 600; // 10 minutes

export interface OAuthStatePayload {
  orgId: string;
  provider: 'google' | 'microsoft';
  nonce: string;
  exp: number;
}

function b64urlEncode(buf: Buffer | string): string {
  const b = typeof buf === 'string' ? Buffer.from(buf, 'utf8') : buf;
  return b
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '');
}

function b64urlDecode(str: string): Buffer {
  const pad = 4 - (str.length % 4 || 4);
  const normalized = str.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat(pad % 4);
  return Buffer.from(normalized, 'base64');
}

function requireKey(keyHex: string | undefined): Buffer {
  if (!keyHex) {
    throw new Error(
      'ENCRYPTION_KEY env var missing — required for OAuth state signing',
    );
  }
  const buf = Buffer.from(keyHex, 'hex');
  if (buf.length !== 32) {
    throw new Error('ENCRYPTION_KEY must be 32 bytes (64 hex chars)');
  }
  return buf;
}

export function signOAuthState(
  input: { orgId: string; provider: 'google' | 'microsoft' },
  keyHex: string | undefined,
  ttlSeconds: number = DEFAULT_TTL_SECONDS,
): string {
  const payload: OAuthStatePayload = {
    orgId: input.orgId,
    provider: input.provider,
    nonce: crypto.randomBytes(12).toString('hex'),
    exp: Math.floor(Date.now() / 1000) + ttlSeconds,
  };
  const payloadPart = b64urlEncode(JSON.stringify(payload));
  const sig = crypto
    .createHmac('sha256', requireKey(keyHex))
    .update(payloadPart)
    .digest();
  return `${payloadPart}.${b64urlEncode(sig)}`;
}

/**
 * Verify + decode. Throws on: bad shape, bad signature, expired.
 * Constant-time signature comparison.
 */
export function verifyOAuthState(
  token: string,
  keyHex: string | undefined,
): OAuthStatePayload {
  if (!token || typeof token !== 'string') {
    throw new Error('State token missing');
  }
  const parts = token.split('.');
  if (parts.length !== 2) {
    throw new Error('State token malformed');
  }
  const [payloadPart, sigPart] = parts;

  const expected = crypto
    .createHmac('sha256', requireKey(keyHex))
    .update(payloadPart)
    .digest();
  const given = b64urlDecode(sigPart);
  if (
    expected.length !== given.length ||
    !crypto.timingSafeEqual(expected, given)
  ) {
    throw new Error('State signature invalid');
  }

  let decoded: OAuthStatePayload;
  try {
    decoded = JSON.parse(b64urlDecode(payloadPart).toString('utf8'));
  } catch {
    throw new Error('State payload malformed');
  }
  if (!decoded.exp || decoded.exp < Math.floor(Date.now() / 1000)) {
    throw new Error('State token expired');
  }
  if (!decoded.orgId || !decoded.provider) {
    throw new Error('State payload incomplete');
  }
  return decoded;
}
