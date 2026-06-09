import { BadRequestException, Injectable } from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service';

/**
 * Allowlists for caller-supplied filter values. Mirrors the
 * `AUDITED_MODELS` list in audit-extension.ts. Kept here as a separate
 * constant rather than re-imported so the read API can evolve
 * independently of the write hook (e.g. accepting legacy entity types).
 */
const ALLOWED_ENTITY_TYPES = new Set([
  'client',
  'lead',
  'opportunity',
  'invoice',
  'ticket',
]);
const ALLOWED_ACTIONS = new Set(['create', 'update', 'delete']);

/**
 * Read-side of the audit trail.
 *
 * The audit log itself is written by `auditExtension` — this service is
 * read-only and provides three list views:
 *   • listForEntity  → timeline for a single Client/Lead/Opportunity/…
 *   • recentFeed     → org-wide Recent Activity page
 *   • listByUser     → "what did this user change?" (admin / compliance)
 *
 * Every method explicitly filters by `organizationId` — the AuditLog
 * model has no Organization back-relation, so cross-tenant isolation
 * lives in code, not the schema.
 */
@Injectable()
export class AuditService {
  constructor(private prisma: PrismaService) {}

  // ─── Per-entity timeline ─────────────────────────────────────

  async listForEntity(
    orgId: string,
    entityType: string,
    entityId: string,
    query: { page?: number; limit?: number },
  ) {
    if (!ALLOWED_ENTITY_TYPES.has(entityType)) {
      throw new BadRequestException(`Invalid entityType: ${entityType}`);
    }
    const { page = 1, limit: rawLimit = 50 } = query;
    const limit = Math.min(rawLimit, 200);
    const skip = (page - 1) * limit;

    const where = {
      organizationId: orgId,
      entityType,
      entityId,
    };

    const [data, total] = await Promise.all([
      this.prisma.auditLog.findMany({
        where,
        skip,
        take: limit,
        orderBy: { changedAt: 'desc' },
      }),
      this.prisma.auditLog.count({ where }),
    ]);

    const hydrated = await this.hydrateUsers(orgId, data);

    return {
      data: hydrated,
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit) || 1,
    };
  }

  // ─── Org-wide recent activity feed ───────────────────────────

  async recentFeed(
    orgId: string,
    query: { page?: number; limit?: number; entityType?: string; action?: string },
  ) {
    const { page = 1, limit: rawLimit = 50, entityType, action } = query;
    if (entityType !== undefined && !ALLOWED_ENTITY_TYPES.has(entityType)) {
      throw new BadRequestException(`Invalid entityType: ${entityType}`);
    }
    if (action !== undefined && !ALLOWED_ACTIONS.has(action)) {
      throw new BadRequestException(`Invalid action: ${action}`);
    }
    const limit = Math.min(rawLimit, 200);
    const skip = (page - 1) * limit;

    const where: any = { organizationId: orgId };
    if (entityType) where.entityType = entityType;
    if (action) where.action = action;

    const [data, total] = await Promise.all([
      this.prisma.auditLog.findMany({
        where,
        skip,
        take: limit,
        orderBy: { changedAt: 'desc' },
      }),
      this.prisma.auditLog.count({ where }),
    ]);

    const hydrated = await this.hydrateUsers(orgId, data);

    return {
      data: hydrated,
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit) || 1,
    };
  }

  // ─── "What did this user change?" ────────────────────────────

  async listByUser(
    orgId: string,
    userId: string,
    query: { page?: number; limit?: number },
  ) {
    const { page = 1, limit: rawLimit = 50 } = query;
    const limit = Math.min(rawLimit, 200);
    const skip = (page - 1) * limit;

    const where = {
      organizationId: orgId,
      changedById: userId,
    };

    const [data, total] = await Promise.all([
      this.prisma.auditLog.findMany({
        where,
        skip,
        take: limit,
        orderBy: { changedAt: 'desc' },
      }),
      this.prisma.auditLog.count({ where }),
    ]);

    const hydrated = await this.hydrateUsers(orgId, data);

    return {
      data: hydrated,
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit) || 1,
    };
  }

  // ─── Helpers ─────────────────────────────────────────────────

  /**
   * Attach `changedBy` user (id/name/email) to each row in a single
   * extra query rather than per-row include — the AuditLog model has no
   * relation declared to User and we want to scope user lookup by org
   * anyway.
   *
   * TODO Wave E2.1: memoize across paginated requests.
   */
  private async hydrateUsers<T extends { changedById: string | null }>(
    orgId: string,
    rows: T[],
  ): Promise<Array<T & { changedBy: { id: string; firstName: string | null; lastName: string | null; email: string } | null }>> {
    const ids = Array.from(
      new Set(rows.map((r) => r.changedById).filter((v): v is string => !!v)),
    );
    if (ids.length === 0) {
      return rows.map((r) => ({ ...r, changedBy: null }));
    }
    const users = await this.prisma.user.findMany({
      where: { id: { in: ids }, organizationId: orgId },
      select: { id: true, firstName: true, lastName: true, email: true },
    });
    const byId = new Map(users.map((u) => [u.id, u]));
    return rows.map((r) => ({
      ...r,
      changedBy: r.changedById ? byId.get(r.changedById) ?? null : null,
    }));
  }
}
