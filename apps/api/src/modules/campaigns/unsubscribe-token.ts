import * as crypto from 'crypto';

/**
 * Signed unsubscribe tokens for campaign emails.
 *
 * Mirrors the OAuth state token scheme (see email-settings/oauth/oauth-state.ts):
 *
 *     base64url(JSON payload) + "." + base64url(HMAC-SHA256(payload, key))
 *
 * Payload is `{ orgId, email }`. We DELIBERATELY do not set an expiry —
 * unsubscribe links must keep working forever (CAN-SPAM requires honoring an
 * opt-out for at least 30 days, and there is zero downside to honoring it
 * indefinitely). The token is unguessable and tamper-proof, so an attacker
 * can't forge an unsubscribe for an arbitrary (org, email) pair, but anyone
 * who legitimately received the email can always opt out.
 *
 * We reuse ENCRYPTION_KEY as the HMAC secret — same justification as the OAuth
 * state token: HMAC operates on a separate domain from the AES-256-GCM
 * encryption that key is otherwise used for, and the hex key has 256 bits of
 * entropy.
 */

export interface UnsubscribePayload {
  orgId: string;
  email: string;
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
  const normalized =
    str.replace(/-/g, '+').replace(/_/g, '/') +
    '='.repeat((4 - (str.length % 4)) % 4);
  return Buffer.from(normalized, 'base64');
}

function requireKey(keyHex: string | undefined): Buffer {
  if (!keyHex) {
    throw new Error(
      'ENCRYPTION_KEY env var missing — required for unsubscribe token signing',
    );
  }
  const buf = Buffer.from(keyHex, 'hex');
  if (buf.length !== 32) {
    throw new Error('ENCRYPTION_KEY must be 32 bytes (64 hex chars)');
  }
  return buf;
}

export function signUnsubscribeToken(
  input: { orgId: string; email: string },
  keyHex: string | undefined,
): string {
  const payload: UnsubscribePayload = {
    orgId: input.orgId,
    // Normalise so the token round-trips to the same suppression key we store.
    email: input.email.trim().toLowerCase(),
  };
  const payloadPart = b64urlEncode(JSON.stringify(payload));
  const sig = crypto
    .createHmac('sha256', requireKey(keyHex))
    .update(payloadPart)
    .digest();
  return `${payloadPart}.${b64urlEncode(sig)}`;
}

/**
 * Verify + decode. Throws on bad shape or bad signature. Constant-time
 * signature comparison. No expiry check (see module docstring).
 */
export function verifyUnsubscribeToken(
  token: string,
  keyHex: string | undefined,
): UnsubscribePayload {
  if (!token || typeof token !== 'string') {
    throw new Error('Unsubscribe token missing');
  }
  const parts = token.split('.');
  if (parts.length !== 2) {
    throw new Error('Unsubscribe token malformed');
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
    throw new Error('Unsubscribe token signature invalid');
  }

  let decoded: UnsubscribePayload;
  try {
    decoded = JSON.parse(b64urlDecode(payloadPart).toString('utf8'));
  } catch {
    throw new Error('Unsubscribe token payload malformed');
  }
  if (!decoded.orgId || !decoded.email) {
    throw new Error('Unsubscribe token payload incomplete');
  }
  return decoded;
}
