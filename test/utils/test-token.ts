/**
 * Issue a test JWT signed with TEST_JWT_SECRET (or JWT_SECRET if running
 * against a fully wired dev API). Mirrors the payload shape used by
 * apps/api/src/modules/auth/strategies/jwt.strategy.ts:
 *
 *   { sub, orgId, type: 'staff' | 'contact', aud: 'staff' | 'portal',
 *     roleId?, isAdmin? }
 *
 * Implementation note: we hand-roll HS256 to avoid pulling jsonwebtoken
 * into this small test package. Output matches the standard JWT format.
 */
import { createHmac } from 'node:crypto';

export interface TestTokenClaims {
  sub: string;
  orgId: string;
  type?: 'staff' | 'contact';
  aud?: 'staff' | 'portal';
  roleId?: string;
  isAdmin?: boolean;
  expiresInSec?: number;
}

export function hasJwtSecret(): boolean {
  return !!(process.env.TEST_JWT_SECRET || process.env.JWT_SECRET);
}

export function issueTestToken(claims: TestTokenClaims): string {
  const secret = process.env.TEST_JWT_SECRET || process.env.JWT_SECRET;
  if (!secret) {
    throw new Error('No TEST_JWT_SECRET / JWT_SECRET in env — cannot issue test token');
  }

  const now = Math.floor(Date.now() / 1000);
  const exp = now + (claims.expiresInSec ?? 60 * 60);

  const header = { alg: 'HS256', typ: 'JWT' };
  const payload = {
    sub: claims.sub,
    orgId: claims.orgId,
    type: claims.type ?? 'staff',
    aud: claims.aud ?? 'staff',
    roleId: claims.roleId,
    isAdmin: claims.isAdmin ?? false,
    iat: now,
    exp,
  };

  const h = b64url(JSON.stringify(header));
  const p = b64url(JSON.stringify(payload));
  const signature = createHmac('sha256', secret).update(`${h}.${p}`).digest();
  const s = b64url(signature);
  return `${h}.${p}.${s}`;
}

function b64url(input: string | Buffer): string {
  const buf = typeof input === 'string' ? Buffer.from(input, 'utf8') : input;
  return buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
