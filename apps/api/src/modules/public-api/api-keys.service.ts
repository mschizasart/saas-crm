import {
  Injectable,
  Logger,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import * as crypto from 'crypto';
import { PrismaService } from '../../database/prisma.service';
import { CreateApiKeyDto } from './public-api.dto';

/**
 * Public-API key management.
 *
 * Key format:  `crm_<8-char-prefix>_<32-byte-hex-secret>`
 *
 *   crm_         — fixed brand prefix, used to route the auth strategy.
 *   <prefix>     — 8 random base32-ish chars, indexed plaintext for
 *                  display and to narrow the lookup before the
 *                  constant-time hash compare. NOT a secret on its own.
 *   <secret>     — 32 bytes of urandom, hex-encoded (64 hex chars).
 *                  Only `sha256(full)` is persisted in `keyHash`.
 *
 * The full key is returned to the caller EXACTLY ONCE, on creation. Every
 * other read path (list, lookup, audit) yields prefix + last4 of hash only.
 *
 * Revocation is a soft delete (`revokedAt`) — the row stays so audit log,
 * webhook deliveries, and last-used metrics that reference the key are
 * still attributable.
 */
@Injectable()
export class ApiKeysService {
  private readonly logger = new Logger(ApiKeysService.name);

  constructor(private readonly prisma: PrismaService) {}

  // ─── Helpers ──────────────────────────────────────────────────

  /** sha256 hex of the full key. Lowercased so the equality compare is normalized. */
  static hashKey(fullKey: string): string {
    return crypto.createHash('sha256').update(fullKey, 'utf8').digest('hex');
  }

  /**
   * Generate a fresh key. The prefix is hex so it copies cleanly and
   * doesn't include characters that get mangled by URLs or shells.
   */
  private generateKey(): { full: string; prefix: string; hash: string } {
    // 4 bytes → exactly 8 hex chars, no padding / stripping artifacts.
    // The previous base64-with-stripping approach could produce
    // 'aaaaaaaa' in pathological cases (low-entropy bytes + padding).
    const prefix = crypto.randomBytes(4).toString('hex');
    const secret = crypto.randomBytes(32).toString('hex');
    const full = `crm_${prefix}_${secret}`;
    return { full, prefix, hash: ApiKeysService.hashKey(full) };
  }

  // ─── Read ─────────────────────────────────────────────────────

  /**
   * List metadata for every key in the org. Never includes the full key
   * or the hash — only the prefix (safe to show) and the LAST 4 hex chars
   * of the hash, so the UI can disambiguate two keys with the same prefix
   * (impossible per the unique index, but cheap insurance for the UI).
   */
  async list(orgId: string) {
    const keys = await this.prisma.publicApiKey.findMany({
      where: { organizationId: orgId },
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        name: true,
        keyPrefix: true,
        keyHash: true,
        scopes: true,
        lastUsedAt: true,
        expiresAt: true,
        revokedAt: true,
        createdAt: true,
        createdById: true,
      },
    });
    const now = new Date();
    return keys.map((k) => ({
      id: k.id,
      name: k.name,
      keyPrefix: k.keyPrefix,
      // Last 4 chars of the hash — non-reversing, useful for support.
      keyLast4: k.keyHash.slice(-4),
      scopes: Array.isArray(k.scopes) ? (k.scopes as string[]) : [],
      lastUsedAt: k.lastUsedAt,
      expiresAt: k.expiresAt,
      revokedAt: k.revokedAt,
      createdAt: k.createdAt,
      createdById: k.createdById,
      status: k.revokedAt
        ? ('revoked' as const)
        : k.expiresAt && k.expiresAt < now
          ? ('expired' as const)
          : ('active' as const),
    }));
  }

  // ─── Create ───────────────────────────────────────────────────

  /**
   * Generate a new key for the org. The FULL key is returned ONCE in the
   * response payload — there is no later path that recovers it. The caller
   * must surface a "copy this now" UI.
   */
  async create(orgId: string, userId: string | null, dto: CreateApiKeyDto) {
    const expiresAt = dto.expiresAt ? new Date(dto.expiresAt) : null;
    if (expiresAt && expiresAt.getTime() <= Date.now()) {
      throw new BadRequestException('expiresAt must be in the future');
    }

    // Retry up to 3 times in the (vanishingly small) event that the prefix
    // collides with an existing one for this org. After 3 hits we give up
    // and surface the error — a sign the RNG is broken or the test mocked it.
    let attempt = 0;
    while (attempt < 3) {
      attempt += 1;
      const { full, prefix, hash } = this.generateKey();
      try {
        const row = await this.prisma.publicApiKey.create({
          data: {
            organizationId: orgId,
            name: dto.name,
            keyPrefix: prefix,
            keyHash: hash,
            scopes: dto.scopes ?? [],
            expiresAt,
            createdById: userId ?? null,
          },
          select: {
            id: true,
            name: true,
            keyPrefix: true,
            scopes: true,
            expiresAt: true,
            createdAt: true,
          },
        });
        return {
          ...row,
          scopes: Array.isArray(row.scopes) ? (row.scopes as string[]) : [],
          // ⚠ Only place this is ever returned. Document loudly in the UI.
          key: full,
        };
      } catch (err: any) {
        if (err?.code === 'P2002' && attempt < 3) {
          // Unique violation on (orgId, keyPrefix) — try again with fresh bytes.
          continue;
        }
        throw err;
      }
    }
    throw new Error('Could not allocate a unique API key prefix');
  }

  // ─── Revoke ───────────────────────────────────────────────────

  /**
   * Soft-delete. We don't hard-delete because audit log and webhook
   * delivery rows may reference the createdById field on the key.
   * Idempotent — re-revoking a revoked key is a no-op.
   */
  async revoke(orgId: string, id: string) {
    const existing = await this.prisma.publicApiKey.findFirst({
      where: { id, organizationId: orgId },
      select: { id: true, revokedAt: true },
    });
    if (!existing) throw new NotFoundException('API key not found');
    if (existing.revokedAt) {
      // Already revoked — return the row as-is rather than 4xx; matches
      // idempotent-DELETE semantics callers tend to expect.
      return { id, revoked: true };
    }
    await this.prisma.publicApiKey.update({
      where: { id },
      data: { revokedAt: new Date() },
    });
    return { id, revoked: true };
  }

  // ─── Lookup (used by api-key.strategy.ts) ────────────────────

  /**
   * Validate a full key string against the database.
   * Returns the key row (incl. orgId + scopes) on success, null on any
   * failure mode (unknown prefix, hash mismatch, revoked, expired, malformed).
   *
   * All comparisons are constant-time. The `last_used_at` write is
   * fire-and-forget so the auth path never blocks on it.
   */
  async validate(fullKey: string): Promise<
    | {
        id: string;
        organizationId: string;
        scopes: string[];
      }
    | null
  > {
    if (typeof fullKey !== 'string') return null;
    const match = fullKey.match(/^crm_([A-Za-z0-9]{8})_([a-f0-9]{64})$/);
    if (!match) return null;
    const prefix = match[1];

    // Narrow by prefix (indexed) then constant-time-compare the hash.
    // The (orgId, prefix) unique index means at most ONE row per org
    // matches; across orgs we'd still scan only a tiny set.
    const candidates = await this.prisma.publicApiKey.findMany({
      where: { keyPrefix: prefix, revokedAt: null },
      select: {
        id: true,
        organizationId: true,
        keyHash: true,
        scopes: true,
        expiresAt: true,
      },
    });

    const expected = ApiKeysService.hashKey(fullKey);
    const expectedBuf = Buffer.from(expected, 'utf8');
    const now = Date.now();

    for (const c of candidates) {
      const stored = Buffer.from(c.keyHash, 'utf8');
      if (stored.length !== expectedBuf.length) continue;
      if (!crypto.timingSafeEqual(stored, expectedBuf)) continue;
      if (c.expiresAt && c.expiresAt.getTime() <= now) return null;

      // Fire-and-forget last-used bump. Errors are swallowed so a flaky
      // write never breaks the auth path (the row is still valid).
      this.prisma.publicApiKey
        .update({ where: { id: c.id }, data: { lastUsedAt: new Date() } })
        .catch((e) =>
          this.logger.warn(`Failed to update lastUsedAt for key ${c.id}: ${e}`),
        );

      return {
        id: c.id,
        organizationId: c.organizationId,
        scopes: Array.isArray(c.scopes) ? (c.scopes as string[]) : [],
      };
    }
    return null;
  }
}
