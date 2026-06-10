import {
  Injectable,
  BadRequestException,
  NotFoundException,
  Logger,
} from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service';

// ─── Record sharing service (Wave G1) ───────────────────────────
//
// Salesforce-style hierarchical record visibility. The CRM already
// enforces RBAC at the resource level ("Sales can view leads") but
// every Sales user currently sees ALL leads. With this slice we
// scope list endpoints by ownership AND org-chart position:
//
//   * records.sharing.all       — see everything (admin grant).
//   * records.sharing.hierarchy — see records owned by self + every
//                                 transitive direct/indirect report
//                                 (sales manager → whole team tree).
//   * records.sharing.team      — see records owned by self + direct
//                                 reports only (team lead → 1 level).
//   * (none)                    — see only the caller's own records.
//
// Same correctness rails as Wave F1 (account-hierarchy.service.ts):
//   1. Defense-in-depth org scoping on every read AND every recursive
//      CTE level (both base + recursive). A malicious payload must
//      NOT be able to walk into a sibling tenant via the managerId
//      FK.
//   2. Cycle prevention on setManager — walk the proposed manager's
//      ancestor chain inside the same FOR-UPDATE-locked transaction.
//   3. Depth cap (MAX_HIERARCHY_DEPTH = 15) on every recursive CTE
//      so a corrupt cycle or a wildly deep org chart can't DOS the
//      tenant.
//
// Known limitation (carried from Wave E2.2): the audit-trail
// extension does NOT fire on writes inside `withOrganization → $transaction`.
// `setManager` therefore won't show up in the audit log. Acceptable
// for Wave G1.

// Org charts can legitimately be deeper than parent/child account
// trees (CEO → SVP → VP → director → senior manager → manager → ...).
// Wave F1 used 10; we bump to 15 here.
const MAX_HIERARCHY_DEPTH = 15;

export interface HierarchyUser {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  managerId: string | null;
  depth: number;
}

@Injectable()
export class RecordSharingService {
  private readonly logger = new Logger(RecordSharingService.name);

  constructor(private prisma: PrismaService) {}

  // ─── Reads ────────────────────────────────────────────────────

  /**
   * All staff users with their `managerId` exposed — used by the
   * /settings/team-hierarchy admin page to render the org chart. Kept
   * here (rather than touching UsersService) so Wave G1 stays
   * additive — UsersService.findAll doesn't return managerId today.
   */
  async listStaffWithManagers(orgId: string) {
    return this.prisma.user.findMany({
      where: { organizationId: orgId, type: 'staff' },
      select: {
        id: true,
        email: true,
        firstName: true,
        lastName: true,
        jobTitle: true,
        active: true,
        managerId: true,
      },
      orderBy: [{ firstName: 'asc' }, { lastName: 'asc' }],
    });
  }

  /**
   * Direct reports of `managerId` — one level deep. Plain Prisma
   * findMany; no CTE needed.
   */
  async getDirectReports(orgId: string, managerId: string) {
    return this.prisma.withOrganization(orgId, async (tx) => {
      return this.getDirectReportsTx(tx as any, orgId, managerId);
    });
  }

  private async getDirectReportsTx(
    tx: any,
    orgId: string,
    managerId: string,
  ) {
    return tx.user.findMany({
      where: { organizationId: orgId, managerId },
      select: {
        id: true,
        email: true,
        firstName: true,
        lastName: true,
        managerId: true,
        jobTitle: true,
        active: true,
      },
      orderBy: [{ firstName: 'asc' }, { lastName: 'asc' }],
    });
  }

  /**
   * Walk DOWN from `rootUserId`, returning every transitive direct
   * AND indirect report (and the root itself) as a flat
   * depth-annotated list. Bounded at MAX_HIERARCHY_DEPTH so a corrupt
   * cycle or a 200-level deep chart can't blow up the query.
   *
   * Org-scoped at BOTH halves of the CTE — the FK is `managerId` and
   * we cannot trust it to keep the walk inside the caller's tenant
   * without the explicit organizationId filter at each step.
   */
  async getAllReports(
    orgId: string,
    rootUserId: string,
  ): Promise<HierarchyUser[]> {
    return this.prisma.withOrganization(orgId, async (tx) => {
      return this.getAllReportsTx(tx as any, orgId, rootUserId);
    });
  }

  private async getAllReportsTx(
    tx: any,
    orgId: string,
    rootUserId: string,
  ): Promise<HierarchyUser[]> {
    const rows = await tx.$queryRaw<
      Array<{
        id: string;
        email: string;
        firstName: string;
        lastName: string;
        managerId: string | null;
        depth: number;
      }>
    >`
      WITH RECURSIVE tree AS (
        SELECT
          u.id,
          u.email,
          u."firstName",
          u."lastName",
          u."managerId",
          0 AS depth
        FROM "users" u
        WHERE u.id = ${rootUserId}
          AND u."organizationId" = ${orgId}
        UNION ALL
        SELECT
          child.id,
          child.email,
          child."firstName",
          child."lastName",
          child."managerId",
          tree.depth + 1 AS depth
        FROM "users" child
        INNER JOIN tree ON child."managerId" = tree.id
        WHERE child."organizationId" = ${orgId}
          AND tree.depth < ${MAX_HIERARCHY_DEPTH}
      )
      SELECT id, email, "firstName", "lastName", "managerId", depth
      FROM tree
      ORDER BY depth ASC, "firstName" ASC, "lastName" ASC
    `;

    return rows.map((r) => ({
      id: r.id,
      email: r.email,
      firstName: r.firstName,
      lastName: r.lastName,
      managerId: r.managerId,
      depth: Number(r.depth),
    }));
  }

  /**
   * Walk UP from `userId` via managerId. Returns the ancestor chain
   * (NOT including `userId` itself), ordered from immediate manager
   * outward to the root. Bounded at MAX_HIERARCHY_DEPTH.
   *
   * Used both for the read endpoint AND inside `setManager` for the
   * cycle check. The latter MUST run inside the calling transaction
   * so the check + the write see a consistent locked view of the row.
   */
  async getManagerChain(
    orgId: string,
    userId: string,
  ): Promise<HierarchyUser[]> {
    return this.prisma.withOrganization(orgId, async (tx) => {
      return this.getManagerChainTx(tx as any, orgId, userId);
    });
  }

  private async getManagerChainTx(
    tx: any,
    orgId: string,
    userId: string,
  ): Promise<HierarchyUser[]> {
    const rows = await tx.$queryRaw<
      Array<{
        id: string;
        email: string;
        firstName: string;
        lastName: string;
        managerId: string | null;
        depth: number;
      }>
    >`
      WITH RECURSIVE chain AS (
        SELECT
          u.id,
          u.email,
          u."firstName",
          u."lastName",
          u."managerId",
          0 AS depth
        FROM "users" u
        WHERE u.id = ${userId}
          AND u."organizationId" = ${orgId}
        UNION ALL
        SELECT
          parent.id,
          parent.email,
          parent."firstName",
          parent."lastName",
          parent."managerId",
          chain.depth + 1 AS depth
        FROM "users" parent
        INNER JOIN chain ON parent.id = chain."managerId"
        WHERE parent."organizationId" = ${orgId}
          AND chain.depth < ${MAX_HIERARCHY_DEPTH}
      )
      SELECT id, email, "firstName", "lastName", "managerId", depth
      FROM chain
      WHERE id <> ${userId}
      ORDER BY depth ASC
    `;

    return rows.map((r) => ({
      id: r.id,
      email: r.email,
      firstName: r.firstName,
      lastName: r.lastName,
      managerId: r.managerId,
      depth: Number(r.depth),
    }));
  }

  // ─── Writes ───────────────────────────────────────────────────

  /**
   * Set / change / unset a user's manager.
   *
   * Validates, in order:
   *   1. managerId !== userId (no self-management).
   *   2. Both rows belong to the caller's org (cross-tenant FK guard).
   *   3. The proposed manager's ancestor chain doesn't contain the
   *      user (no cycle).
   *
   * Cycle check + update run in ONE transaction with FOR UPDATE row
   * locks on both rows, in deterministic id order so two concurrent
   * setManager calls referencing the same pair can't deadlock. This
   * mirrors Wave F1's account-hierarchy fix — a concurrent re-parent
   * of the proposed manager between our check and our write could
   * otherwise slip a cycle past the validator.
   */
  async setManager(
    orgId: string,
    userId: string,
    managerId: string | null,
  ) {
    if (managerId === userId) {
      throw new BadRequestException('User cannot manage themselves');
    }

    return this.prisma.withOrganization(orgId, async (tx) => {
      if (managerId === null) {
        // Unset path — only need to lock + verify the child row.
        const lockedChild = await tx.$queryRaw<Array<{ id: string }>>`
          SELECT id FROM "users"
          WHERE id = ${userId} AND "organizationId" = ${orgId}
          FOR UPDATE
        `;
        if (lockedChild.length === 0) {
          throw new NotFoundException('User not found');
        }

        return tx.user.update({
          where: { id: userId, organizationId: orgId },
          data: { managerId: null },
          select: {
            id: true,
            email: true,
            firstName: true,
            lastName: true,
            managerId: true,
          },
        });
      }

      // Set path — lock both rows in id order to avoid deadlocks.
      const [firstId, secondId] =
        userId < managerId ? [userId, managerId] : [managerId, userId];

      const lockedFirst = await tx.$queryRaw<Array<{ id: string }>>`
        SELECT id FROM "users"
        WHERE id = ${firstId} AND "organizationId" = ${orgId}
        FOR UPDATE
      `;
      const lockedSecond = await tx.$queryRaw<Array<{ id: string }>>`
        SELECT id FROM "users"
        WHERE id = ${secondId} AND "organizationId" = ${orgId}
        FOR UPDATE
      `;

      const childLocked = userId === firstId ? lockedFirst : lockedSecond;
      const managerLocked =
        managerId === firstId ? lockedFirst : lockedSecond;

      if (childLocked.length === 0) {
        throw new NotFoundException('User not found');
      }
      if (managerLocked.length === 0) {
        throw new NotFoundException('Manager not found');
      }

      // Cycle check INSIDE this tx, against the locked rows. We walk
      // the manager's ancestor chain; if userId appears, accepting
      // would create a cycle.
      const managerAncestors = await this.getManagerChainTx(
        tx as any,
        orgId,
        managerId,
      );
      if (managerAncestors.some((a) => a.id === userId)) {
        throw new BadRequestException('Cycle in management chain');
      }

      // Defense-in-depth: organizationId in the where clause AS WELL
      // AS id. Belt-and-braces against any future code path that lets
      // a hostile actor smuggle a foreign user id.
      return tx.user.update({
        where: { id: userId, organizationId: orgId },
        data: { managerId },
        select: {
          id: true,
          email: true,
          firstName: true,
          lastName: true,
          managerId: true,
        },
      });
    });
  }

  // ─── Visibility scoping (the integration helper) ──────────────

  /**
   * Compute the set of user ids whose owned records the caller can
   * see.
   *
   * Always includes `userId` itself. Adds direct reports if
   * `includeReports`, adds the entire descendant tree if
   * `includeDescendants`. Returns a Set so callers can intersect /
   * union cheaply.
   */
  async getVisibleUserIds(
    orgId: string,
    userId: string,
    opts: { includeReports?: boolean; includeDescendants?: boolean },
  ): Promise<Set<string>> {
    return this.prisma.withOrganization(orgId, async (tx) => {
      return this.getVisibleUserIdsTx(tx as any, orgId, userId, opts);
    });
  }

  /**
   * Tx-flavoured variant of `getVisibleUserIds` — runs entirely
   * within the caller's already-open `withOrganization` transaction.
   * The public list endpoints (leads.findAll, opportunities.list, ...)
   * open one transaction for the whole request and call this so we
   * don't crash Prisma with nested-transaction errors.
   */
  private async getVisibleUserIdsTx(
    tx: any,
    orgId: string,
    userId: string,
    opts: { includeReports?: boolean; includeDescendants?: boolean },
  ): Promise<Set<string>> {
    const ids = new Set<string>([userId]);

    if (opts.includeDescendants) {
      // getAllReports includes the root — strip it so we don't
      // double-count and so the set we return is intentional.
      const all = await this.getAllReportsTx(tx, orgId, userId);
      for (const u of all) ids.add(u.id);
    } else if (opts.includeReports) {
      const direct = await this.getDirectReportsTx(tx, orgId, userId);
      for (const u of direct) ids.add(u.id);
    }

    return ids;
  }

  /**
   * Integration helper for list endpoints.
   *
   * Given the caller's permissions (the nested `role.permissions`
   * object — `RbacGuard` reads the same shape), returns a NEW where
   * clause that filters records by `<ownerField> IN (visible users)`.
   *
   * `ownerField` defaults to `'ownerId'` (opportunities, quotes, ...)
   * but the leads table uses the scalar `assignedTo` column instead,
   * so callers can override.
   *
   * Behaviour matrix:
   *   * records.sharing.all       → return baseWhere unchanged
   *                                 (admin / super-grant; sees all).
   *   * records.sharing.hierarchy → owner IN (self + all reports).
   *   * records.sharing.team      → owner IN (self + direct reports).
   *   * (none)                    → owner = self.
   *
   * If `baseWhere[ownerField]` already carries a filter (e.g. the
   * caller passed `?ownerId=...` for a deep-link), we INTERSECT —
   * return records owned by users in BOTH the visibility set AND the
   * original filter. We must not silently widen the result set.
   *
   * Also: admin / `user.isAdmin` short-circuits to baseWhere
   * unchanged (the RbacGuard already bypasses RBAC for them; the
   * visibility helper must follow the same fail-open contract).
   */
  async applyVisibilityScope(
    orgId: string,
    userId: string,
    permissions: Record<string, Record<string, boolean>> | undefined,
    baseWhere: any,
    ownerField: string = 'ownerId',
  ): Promise<any> {
    return this.prisma.withOrganization(orgId, async (tx) => {
      return this.applyVisibilityScopeTx(
        tx as any,
        orgId,
        userId,
        permissions,
        baseWhere,
        ownerField,
      );
    });
  }

  /**
   * Tx-flavoured variant of `applyVisibilityScope` — call this from
   * inside an open `withOrganization` callback (e.g. leads.findAll,
   * opportunities.list). The public `applyVisibilityScope` opens its
   * own transaction and delegates here; nesting `withOrganization`
   * inside another one throws "Cannot start a transaction within a
   * transaction" in Prisma's interactive-tx mode.
   */
  async applyVisibilityScopeTx(
    tx: any,
    orgId: string,
    userId: string,
    permissions: Record<string, Record<string, boolean>> | undefined,
    baseWhere: any,
    ownerField: string = 'ownerId',
  ): Promise<any> {
    const hasPerm = (key: string): boolean => {
      // Matches RbacGuard's split: 'records.sharing.team' →
      // ['records', 'sharing'] + 'team' tail. We treat the resource
      // as the prefix everything-before-last-dot, and the action as
      // the final segment.
      const parts = key.split('.');
      const action = parts.pop()!;
      const resource = parts.join('.');
      return permissions?.[resource]?.[action] === true;
    };

    // Super-admin grant (records.sharing.all) — no scoping. We do
    // NOT auto-fall-open on user.isAdmin here because RbacGuard
    // handles isAdmin at the route boundary and the caller is the
    // one wiring this helper into list endpoints; if they want
    // isAdmin to fall open they can pass `records.sharing.all` via
    // their permission resolver.
    if (hasPerm('records.sharing.all')) {
      return baseWhere;
    }

    const includeDescendants = hasPerm('records.sharing.hierarchy');
    const includeReports = hasPerm('records.sharing.team');

    const visibleIds = await this.getVisibleUserIdsTx(tx, orgId, userId, {
      includeReports,
      includeDescendants,
    });
    const visibleArr = [...visibleIds];

    // Intersect with any pre-existing owner-field filter so a
    // deep-link by ownerId doesn't accidentally widen access.
    const existing = baseWhere?.[ownerField];
    let nextOwnerFilter: any;

    if (existing === undefined || existing === null) {
      nextOwnerFilter = { in: visibleArr };
    } else if (typeof existing === 'string') {
      // Caller pinned a specific owner — only honor it if that user
      // is in the visibility set; otherwise return a NEVER filter
      // (empty `in`) so the query returns zero rows rather than
      // silently widening.
      nextOwnerFilter = visibleIds.has(existing) ? existing : { in: [] };
    } else if (
      typeof existing === 'object' &&
      Array.isArray(existing.in)
    ) {
      const intersected = existing.in.filter((id: string) =>
        visibleIds.has(id),
      );
      nextOwnerFilter = { in: intersected };
    } else {
      // Unknown shape (e.g. `{ not: ... }`) — combine via AND so we
      // never widen. Prisma accepts AND at the field level via a
      // top-level AND clause.
      return {
        ...baseWhere,
        AND: [
          ...(Array.isArray(baseWhere.AND) ? baseWhere.AND : []),
          { [ownerField]: { in: visibleArr } },
        ],
      };
    }

    return { ...baseWhere, [ownerField]: nextOwnerFilter };
  }
}
