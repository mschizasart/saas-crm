import {
  Injectable,
  BadRequestException,
  NotFoundException,
  Logger,
} from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service';

// ─── Account hierarchy service (Wave F1) ────────────────────────
//
// Self-referential parent/child tree on `clients` (see migration 033).
// Reps want a "full picture" rollup of metrics across subsidiaries,
// divisions, regional offices — modelled Salesforce-style with one
// designated parent per node.
//
// Three correctness rails — all enforced server-side:
//   1. Defense-in-depth: every read/write where-clause carries
//      `organizationId: orgId` in addition to the FK id. This was the
//      recurring trap in Waves D+E. Recursive CTEs ALSO carry the org
//      filter in BOTH the base case AND the recursive case so a
//      malicious payload can't walk into a sibling tenant via the
//      `parentClientId` FK.
//   2. Cycle prevention on setParent: walk the proposed parent's
//      ancestor chain and refuse if the child id appears in it.
//   3. Depth cap at MAX_DEPTH = 10. Trees are usually 2–4 levels,
//      anything deeper is almost certainly a data-entry mistake AND
//      the recursive CTEs need a hard stop or a malicious org could
//      DOS itself.
//
// Known limitation: the audit-trail extension (Wave E2.2) does NOT
// fire on writes inside `withOrganization → $transaction`. That's a
// global Prisma 6 issue, not specific to this module; setParent /
// unsetParent therefore won't show up in the audit log. Acceptable
// for Wave F1.

export interface HierarchyNode {
  id: string;
  name: string;
  company: string;
  parentClientId: string | null;
  depth: number;
}

export interface RollupMetricsBlock {
  invoiceTotal: number;
  openInvoiceCount: number;
  leadCount: number;
  openOpportunityCount: number;
  openOpportunityAmount: number;
}

export interface RollupResult {
  rootClientId: string;
  selfMetrics: RollupMetricsBlock;
  descendantMetrics: RollupMetricsBlock;
  combinedMetrics: RollupMetricsBlock;
  descendantCount: number;
}

const MAX_DEPTH = 10;

// Status values considered "open" (i.e. unpaid). Anything that isn't
// in the closed-set goes here. Matches the existing invoices module
// convention — "cancelled" is excluded from receivables and "paid"
// is closed.
const OPEN_INVOICE_STATUSES = ['draft', 'unpaid', 'partial', 'overdue'];

// Opportunity stage flags decide open/closed. We don't have a
// `status` column — instead we join to `opportunity_stages` and
// treat anything that's neither `isWon` nor `isLost` as open.

@Injectable()
export class AccountHierarchyService {
  private readonly logger = new Logger(AccountHierarchyService.name);

  constructor(private prisma: PrismaService) {}

  // ─── Reads ────────────────────────────────────────────────────

  /**
   * Walk DOWN from `rootClientId`, returning every descendant (and the
   * root itself) as a flat depth-annotated list. Front-end re-nests as
   * needed.
   *
   * Bounded at MAX_DEPTH levels so a corrupt cycle (or an
   * over-enthusiastic future expansion of the cap) can't make this
   * query unbounded.
   */
  async getHierarchy(
    orgId: string,
    rootClientId: string,
  ): Promise<HierarchyNode[]> {
    // Existence + tenant check first so we return a clean 404 rather
    // than a silently empty array if the id is bogus or cross-tenant.
    await this.assertClientInOrg(orgId, rootClientId);

    return this.prisma.withOrganization(orgId, async (tx) => {
      return this.getHierarchyTx(tx as any, orgId, rootClientId);
    });
  }

  /**
   * Internal: same as getHierarchy but runs on a caller-supplied tx.
   * Used by setParent to keep the cycle/depth checks in the SAME
   * transaction as the row lock + update (see BLOCKER fix).
   */
  private async getHierarchyTx(
    tx: any,
    orgId: string,
    rootClientId: string,
  ): Promise<HierarchyNode[]> {
    const rows = await tx.$queryRaw<
      Array<{
        id: string;
        company: string;
        parentClientId: string | null;
        depth: number;
      }>
    >`
      WITH RECURSIVE tree AS (
        SELECT
          c.id,
          c.company,
          c."parentClientId",
          0 AS depth
        FROM "clients" c
        WHERE c.id = ${rootClientId}
          AND c."organizationId" = ${orgId}
        UNION ALL
        SELECT
          child.id,
          child.company,
          child."parentClientId",
          tree.depth + 1 AS depth
        FROM "clients" child
        INNER JOIN tree ON child."parentClientId" = tree.id
        WHERE child."organizationId" = ${orgId}
          AND tree.depth < ${MAX_DEPTH}
      )
      SELECT id, company, "parentClientId", depth
      FROM tree
      ORDER BY depth ASC, company ASC
    `;

    return rows.map((r) => ({
      id: r.id,
      name: r.company,
      company: r.company,
      parentClientId: r.parentClientId,
      depth: Number(r.depth),
    }));
  }

  /**
   * Paged list of root clients (parentClientId IS NULL) for the
   * caller's org. Same response shape as the rest of the list APIs.
   */
  async getRoots(
    orgId: string,
    query: { search?: string; page?: number; limit?: number },
  ) {
    const { search, page = 1 } = query;
    // Cap limit at 100 — unbounded page sizes are a DOS vector and
    // we have no business case for >100 root accounts per page.
    const limit = Math.min(query.limit ?? 20, 100);
    const skip = (page - 1) * limit;

    return this.prisma.withOrganization(orgId, async (tx) => {
      const where: any = {
        organizationId: orgId,
        parentClientId: null,
      };
      if (search) where.company = { contains: search, mode: 'insensitive' };

      const [data, total] = await Promise.all([
        tx.client.findMany({
          where,
          skip,
          take: limit,
          orderBy: { company: 'asc' },
          select: {
            id: true,
            company: true,
            active: true,
            parentClientId: true,
            _count: { select: { children: true } },
          },
        }),
        tx.client.count({ where }),
      ]);

      return { data, total, page, limit, totalPages: Math.ceil(total / limit) };
    });
  }

  /**
   * Walk UP from `clientId` via parentClientId. Returns the ancestor
   * chain oldest-first (root → ... → immediate parent), NOT including
   * the client itself. Bounded by MAX_DEPTH.
   */
  async getAncestors(
    orgId: string,
    clientId: string,
  ): Promise<HierarchyNode[]> {
    await this.assertClientInOrg(orgId, clientId);

    return this.prisma.withOrganization(orgId, async (tx) => {
      return this.getAncestorsTx(tx as any, orgId, clientId);
    });
  }

  /**
   * Internal: same as getAncestors but runs on a caller-supplied tx.
   * Used by setParent for the in-transaction cycle check.
   */
  private async getAncestorsTx(
    tx: any,
    orgId: string,
    clientId: string,
  ): Promise<HierarchyNode[]> {
    const rows = await tx.$queryRaw<
      Array<{
        id: string;
        company: string;
        parentClientId: string | null;
        depth: number;
      }>
    >`
      WITH RECURSIVE chain AS (
        SELECT
          c.id,
          c.company,
          c."parentClientId",
          0 AS depth
        FROM "clients" c
        WHERE c.id = ${clientId}
          AND c."organizationId" = ${orgId}
        UNION ALL
        SELECT
          parent.id,
          parent.company,
          parent."parentClientId",
          chain.depth + 1 AS depth
        FROM "clients" parent
        INNER JOIN chain ON parent.id = chain."parentClientId"
        WHERE parent."organizationId" = ${orgId}
          AND chain.depth < ${MAX_DEPTH}
      )
      SELECT id, company, "parentClientId", depth
      FROM chain
      WHERE id <> ${clientId}
      ORDER BY depth DESC
    `;

    return rows.map((r) => ({
      id: r.id,
      name: r.company,
      company: r.company,
      parentClientId: r.parentClientId,
      depth: Number(r.depth),
    }));
  }

  // ─── Writes ───────────────────────────────────────────────────

  /**
   * Re-parent a client.
   *
   * Validates, in order:
   *   1. Both child and proposed parent belong to the caller's org
   *      (cross-tenant FK guard).
   *   2. parentClientId !== clientId (no self-parent).
   *   3. parent's ancestor chain doesn't contain the child (no cycle).
   *   4. depth(parent) + maxSubtreeDepth(child) + 1 <= MAX_DEPTH.
   */
  async setParent(
    orgId: string,
    clientId: string,
    parentClientId: string,
  ) {
    if (parentClientId === clientId) {
      throw new BadRequestException('A client cannot be its own parent');
    }

    // BLOCKER fix: consolidate ownership check, cycle check, depth
    // check, and update into a SINGLE transaction with row locks on
    // both rows. Previously these ran across 3 separate withOrganization
    // transactions, so a concurrent re-parent of the proposed parent
    // (after our cycle check but before our update) could slip a cycle
    // past the validator.
    //
    // We acquire SELECT ... FOR UPDATE locks on the child and parent
    // rows up-front. Locks are taken in deterministic id order to
    // avoid deadlocks between two concurrent setParent calls that
    // happen to reference the same pair in opposite roles.
    return this.prisma.withOrganization(orgId, async (tx) => {
      const [firstId, secondId] =
        clientId < parentClientId
          ? [clientId, parentClientId]
          : [parentClientId, clientId];

      // Row locks — tenant-scoped, so a cross-tenant id locks nothing
      // and the ownership re-fetch below will throw 404.
      const lockedFirst = await tx.$queryRaw<Array<{ id: string }>>`
        SELECT id FROM "clients"
        WHERE id = ${firstId} AND "organizationId" = ${orgId}
        FOR UPDATE
      `;
      const lockedSecond = await tx.$queryRaw<Array<{ id: string }>>`
        SELECT id FROM "clients"
        WHERE id = ${secondId} AND "organizationId" = ${orgId}
        FOR UPDATE
      `;

      const childLocked = clientId === firstId ? lockedFirst : lockedSecond;
      const parentLocked = parentClientId === firstId ? lockedFirst : lockedSecond;

      if (childLocked.length === 0) {
        throw new NotFoundException('Client not found');
      }
      if (parentLocked.length === 0) {
        throw new NotFoundException('Parent client not found');
      }

      // Cycle check INSIDE this tx, against the now-locked rows.
      const parentAncestors = await this.getAncestorsTx(
        tx as any,
        orgId,
        parentClientId,
      );
      if (parentAncestors.some((a) => a.id === clientId)) {
        throw new BadRequestException('Cannot create cycle in hierarchy');
      }

      // Depth check INSIDE this tx.
      const parentDepthFromRoot = parentAncestors.length;
      const childSubtree = await this.getHierarchyTx(
        tx as any,
        orgId,
        clientId,
      );
      const childSubtreeMaxDepth = childSubtree.reduce(
        (m, n) => (n.depth > m ? n.depth : m),
        0,
      );
      if (parentDepthFromRoot + childSubtreeMaxDepth + 1 > MAX_DEPTH) {
        throw new BadRequestException(
          `Resulting hierarchy depth would exceed ${MAX_DEPTH} levels`,
        );
      }

      // Defense-in-depth: organizationId in the where clause AS WELL AS
      // id. Belt-and-braces against any future code path that lets a
      // hostile actor smuggle a foreign client id.
      return tx.client.update({
        where: { id: clientId, organizationId: orgId },
        data: { parentClientId },
        select: { id: true, company: true, parentClientId: true },
      });
    });
  }

  async unsetParent(orgId: string, clientId: string) {
    await this.assertClientInOrg(orgId, clientId);
    return this.prisma.withOrganization(orgId, async (tx) => {
      return tx.client.update({
        where: { id: clientId, organizationId: orgId },
        data: { parentClientId: null },
        select: { id: true, company: true, parentClientId: true },
      });
    });
  }

  // ─── Rollup metrics ───────────────────────────────────────────

  /**
   * Combined business metrics for the subtree rooted at `rootClientId`.
   *
   * Strategy:
   *   1. Run the recursive CTE to collect every descendant id (and
   *      the root) — tenant-scoped at both CTE steps.
   *   2. For each metric (invoice total, open invoice count, lead
   *      count, open opp count, open opp amount):
   *        a. Compute it for the root alone → selfMetrics.
   *        b. Compute it for descendants (all ids minus root) →
   *           descendantMetrics.
   *        c. Sum → combinedMetrics.
   *      Each aggregate query also carries `organizationId: orgId`.
   *
   * Lead count uses `convertedToClientId` — that's the only client FK
   * the Lead model exposes (no plain `clientId`). It's the closest
   * thing to "leads attributed to this client" we have without a
   * schema change, and Wave F1 is explicitly additive.
   */
  async rollupMetrics(
    orgId: string,
    rootClientId: string,
  ): Promise<RollupResult> {
    await this.assertClientInOrg(orgId, rootClientId);

    return this.prisma.withOrganization(orgId, async (tx) => {
      const subtreeRows = await tx.$queryRaw<Array<{ id: string }>>`
        WITH RECURSIVE tree AS (
          SELECT c.id, 0::int AS depth
          FROM "clients" c
          WHERE c.id = ${rootClientId}
            AND c."organizationId" = ${orgId}
          UNION ALL
          SELECT child.id, tree.depth + 1 AS depth
          FROM "clients" child
          INNER JOIN tree ON child."parentClientId" = tree.id
          WHERE child."organizationId" = ${orgId}
            AND tree.depth < ${MAX_DEPTH}
        )
        SELECT id FROM tree
      `;

      const allIds = subtreeRows.map((r) => r.id);
      const descendantIds = allIds.filter((id) => id !== rootClientId);

      const [selfMetrics, descendantMetrics] = await Promise.all([
        this.computeMetricsFor(tx as any, orgId, [rootClientId]),
        this.computeMetricsFor(tx as any, orgId, descendantIds),
      ]);

      const combinedMetrics: RollupMetricsBlock = {
        invoiceTotal: selfMetrics.invoiceTotal + descendantMetrics.invoiceTotal,
        openInvoiceCount:
          selfMetrics.openInvoiceCount + descendantMetrics.openInvoiceCount,
        leadCount: selfMetrics.leadCount + descendantMetrics.leadCount,
        openOpportunityCount:
          selfMetrics.openOpportunityCount +
          descendantMetrics.openOpportunityCount,
        openOpportunityAmount:
          selfMetrics.openOpportunityAmount +
          descendantMetrics.openOpportunityAmount,
      };

      return {
        rootClientId,
        selfMetrics,
        descendantMetrics,
        combinedMetrics,
        descendantCount: descendantIds.length,
      };
    });
  }

  // ─── Internals ────────────────────────────────────────────────

  private async computeMetricsFor(
    tx: any,
    orgId: string,
    clientIds: string[],
  ): Promise<RollupMetricsBlock> {
    if (clientIds.length === 0) {
      return {
        invoiceTotal: 0,
        openInvoiceCount: 0,
        leadCount: 0,
        openOpportunityCount: 0,
        openOpportunityAmount: 0,
      };
    }

    const [invoiceAgg, openInvoiceCount, leadCount, openOpps] =
      await Promise.all([
        tx.invoice.aggregate({
          where: {
            organizationId: orgId,
            clientId: { in: clientIds },
            status: { not: 'cancelled' },
          },
          _sum: { total: true },
        }),
        tx.invoice.count({
          where: {
            organizationId: orgId,
            clientId: { in: clientIds },
            status: { in: OPEN_INVOICE_STATUSES },
          },
        }),
        tx.lead.count({
          where: {
            organizationId: orgId,
            convertedToClientId: { in: clientIds },
          },
        }),
        // "Open" opportunities — neither won nor lost. We aggregate
        // count + amount in a single grouped query via the stage join.
        tx.opportunity.findMany({
          where: {
            organizationId: orgId,
            clientId: { in: clientIds },
            stage: { isWon: false, isLost: false },
          },
          select: { amount: true },
        }),
      ]);

    const invoiceTotal = invoiceAgg._sum?.total
      ? Number(invoiceAgg._sum.total)
      : 0;
    const openOpportunityCount = openOpps.length;
    const openOpportunityAmount = openOpps.reduce(
      (s: number, o: { amount: any }) => s + Number(o.amount ?? 0),
      0,
    );

    return {
      invoiceTotal,
      openInvoiceCount,
      leadCount,
      openOpportunityCount,
      openOpportunityAmount,
    };
  }

  private async assertClientInOrg(orgId: string, clientId: string) {
    const c = await this.prisma.client.findFirst({
      where: { id: clientId, organizationId: orgId },
      select: { id: true },
    });
    if (!c) throw new NotFoundException('Client not found');
  }
}
