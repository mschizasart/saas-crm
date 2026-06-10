import {
  Injectable,
  BadRequestException,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service';
import {
  CreateTerritoryDto,
  UpdateTerritoryDto,
} from './territories.dto';

// ─── Territories service (Wave G2) ──────────────────────────────
//
// CRUD + hierarchy traversal for the per-tenant Territory tree.
// Same correctness rails as Wave F1 (account-hierarchy):
//
//   1. Defense-in-depth: every read/write where-clause carries
//      `organizationId: orgId` in addition to the FK id. Recursive
//      CTEs ALSO carry the org filter in BOTH the base case AND the
//      recursive case — without that, a forged `parentTerritoryId`
//      pointing at another tenant's row could let the CTE walk into
//      a sibling tenant.
//   2. Cycle prevention on create / update when parentTerritoryId
//      is set: walk the proposed parent's ancestor chain and refuse
//      if the child id appears in it.
//   3. Depth cap at MAX_DEPTH = 10. Sales territory trees are
//      usually 3-5 levels (region > country > area > rep); anything
//      deeper is almost certainly a data-entry mistake AND the
//      recursive CTEs need a hard stop.

export interface TerritoryHierarchyNode {
  id: string;
  name: string;
  parentTerritoryId: string | null;
  depth: number;
}

const MAX_DEPTH = 10;

@Injectable()
export class TerritoriesService {
  constructor(private prisma: PrismaService) {}

  // ─── Reads ────────────────────────────────────────────────────

  async list(
    orgId: string,
    query: { search?: string; page?: number; limit?: number },
  ) {
    const { search, page = 1 } = query;
    // Cap at 100 — unbounded page sizes are a DOS vector.
    const limit = Math.min(query.limit ?? 20, 100);
    const skip = (page - 1) * limit;

    return this.prisma.withOrganization(orgId, async (tx) => {
      const where: any = { organizationId: orgId };
      if (search) {
        where.OR = [
          { name: { contains: search, mode: 'insensitive' } },
          { description: { contains: search, mode: 'insensitive' } },
        ];
      }

      const [data, total] = await Promise.all([
        tx.territory.findMany({
          where,
          skip,
          take: limit,
          orderBy: { name: 'asc' },
          select: {
            id: true,
            name: true,
            description: true,
            parentTerritoryId: true,
            managerId: true,
            createdAt: true,
            updatedAt: true,
            _count: {
              select: {
                members: true,
                assignments: true,
                children: true,
              },
            },
          },
        }),
        tx.territory.count({ where }),
      ]);

      return {
        data,
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit),
      };
    });
  }

  async findOne(orgId: string, id: string) {
    return this.prisma.withOrganization(orgId, async (tx) => {
      const territory = await tx.territory.findFirst({
        where: { id, organizationId: orgId },
        include: {
          members: {
            orderBy: { createdAt: 'asc' },
          },
          _count: {
            select: { assignments: true, children: true },
          },
        },
      });
      if (!territory) throw new NotFoundException('Territory not found');
      return territory;
    });
  }

  // ─── Create / Update / Delete ────────────────────────────────

  async create(orgId: string, dto: CreateTerritoryDto) {
    return this.prisma.withOrganization(orgId, async (tx) => {
      // Cross-tenant FK guards. The raw FK alone allows ANY id from
      // ANY tenant; we MUST validate org membership explicitly.
      if (dto.parentTerritoryId) {
        const parent = await tx.territory.findFirst({
          where: { id: dto.parentTerritoryId, organizationId: orgId },
          select: { id: true },
        });
        if (!parent) {
          throw new BadRequestException(
            'Parent territory not found for this organization',
          );
        }

        // Depth check on the proposed parent. New leaf will sit at
        // (parentDepth + 1); reject if that exceeds the cap.
        const parentAncestors = await this.getAncestorsTx(
          tx as any,
          orgId,
          dto.parentTerritoryId,
        );
        // parentAncestors.length = parent's 0-based depth from root.
        // New leaf will sit at depth (parentDepthFromRoot + 1).
        // Reject if that would equal or exceed the cap.
        const parentDepthFromRoot = parentAncestors.length;
        if (parentDepthFromRoot + 1 >= MAX_DEPTH) {
          throw new BadRequestException(
            `Maximum hierarchy depth (${MAX_DEPTH}) exceeded`,
          );
        }
        // (Cycle check N/A on create — new row has no descendants.)
      }
      if (dto.managerId) {
        const manager = await tx.user.findFirst({
          where: { id: dto.managerId, organizationId: orgId },
          select: { id: true },
        });
        if (!manager) {
          throw new BadRequestException(
            'Manager not found for this organization',
          );
        }
      }

      try {
        return await tx.territory.create({
          data: {
            organizationId: orgId,
            name: dto.name,
            description: dto.description ?? null,
            parentTerritoryId: dto.parentTerritoryId ?? null,
            managerId: dto.managerId ?? null,
          },
        });
      } catch (e: any) {
        // UNIQUE (organizationId, name) — friendly 400.
        if (e?.code === 'P2002') {
          throw new BadRequestException(
            'A territory with this name already exists',
          );
        }
        throw e;
      }
    });
  }

  async update(orgId: string, id: string, dto: UpdateTerritoryDto) {
    return this.prisma.withOrganization(orgId, async (tx) => {
      // Existence + tenant check.
      const current = await tx.territory.findFirst({
        where: { id, organizationId: orgId },
        select: { id: true, parentTerritoryId: true },
      });
      if (!current) throw new NotFoundException('Territory not found');

      // Re-validate parent on change.
      if (dto.parentTerritoryId !== undefined && dto.parentTerritoryId !== null) {
        if (dto.parentTerritoryId === id) {
          throw new BadRequestException(
            'A territory cannot be its own parent',
          );
        }

        const parent = await tx.territory.findFirst({
          where: { id: dto.parentTerritoryId, organizationId: orgId },
          select: { id: true },
        });
        if (!parent) {
          throw new BadRequestException(
            'Parent territory not found for this organization',
          );
        }

        // Cycle check: the proposed parent must NOT have `id` in
        // its ancestor chain (otherwise we'd close a loop).
        const parentAncestors = await this.getAncestorsTx(
          tx as any,
          orgId,
          dto.parentTerritoryId,
        );
        if (parentAncestors.some((a) => a.id === id)) {
          throw new BadRequestException(
            'Cannot create cycle in territory hierarchy',
          );
        }

        // Depth check: parentDepth + ourSubtreeMaxDepth + 1 must
        // not exceed MAX_DEPTH (mirrors account-hierarchy logic).
        const parentDepthFromRoot = parentAncestors.length;
        const subtree = await this.getHierarchyTx(tx as any, orgId, id);
        const subtreeMaxDepth = subtree.reduce(
          (m, n) => (n.depth > m ? n.depth : m),
          0,
        );
        if (parentDepthFromRoot + subtreeMaxDepth + 1 > MAX_DEPTH) {
          throw new BadRequestException(
            `Resulting hierarchy depth would exceed ${MAX_DEPTH} levels`,
          );
        }
      }

      // Cross-tenant guard on manager change.
      if (dto.managerId !== undefined && dto.managerId !== null) {
        const manager = await tx.user.findFirst({
          where: { id: dto.managerId, organizationId: orgId },
          select: { id: true },
        });
        if (!manager) {
          throw new BadRequestException(
            'Manager not found for this organization',
          );
        }
      }

      try {
        // Defense-in-depth: organizationId in BOTH the id-lookup AND
        // the where-clause on update (belt-and-braces).
        return await tx.territory.update({
          where: { id, organizationId: orgId },
          data: {
            ...(dto.name !== undefined && { name: dto.name }),
            ...(dto.description !== undefined && {
              description: dto.description,
            }),
            ...(dto.parentTerritoryId !== undefined && {
              parentTerritoryId: dto.parentTerritoryId,
            }),
            ...(dto.managerId !== undefined && {
              managerId: dto.managerId,
            }),
          },
        });
      } catch (e: any) {
        if (e?.code === 'P2002') {
          throw new BadRequestException(
            'A territory with this name already exists',
          );
        }
        throw e;
      }
    });
  }

  async remove(orgId: string, id: string) {
    return this.prisma.withOrganization(orgId, async (tx) => {
      // Existence + tenant check.
      const territory = await tx.territory.findFirst({
        where: { id, organizationId: orgId },
        select: {
          id: true,
          _count: {
            select: { children: true, assignments: true },
          },
        },
      });
      if (!territory) throw new NotFoundException('Territory not found');

      if (territory._count.children > 0) {
        throw new BadRequestException(
          `Cannot delete: territory has ${territory._count.children} child territory(ies). Reparent or delete them first.`,
        );
      }
      if (territory._count.assignments > 0) {
        throw new BadRequestException(
          `Cannot delete: territory has ${territory._count.assignments} assignment(s). Unassign them first.`,
        );
      }

      // Defense-in-depth on delete.
      await tx.territory.delete({
        where: { id, organizationId: orgId },
      });
    });
  }

  // ─── Hierarchy traversal ─────────────────────────────────────

  /**
   * Walk DOWN from a root (or the whole tenant if rootId omitted),
   * returning every descendant as a flat depth-annotated list.
   *
   * Bounded at MAX_DEPTH levels so a corrupt cycle (or future
   * expansion of the cap) can't make this query unbounded.
   */
  async getHierarchy(
    orgId: string,
    rootId?: string,
  ): Promise<TerritoryHierarchyNode[]> {
    if (rootId) {
      // Existence + tenant check — clean 404 if the id is bogus or
      // cross-tenant.
      await this.assertTerritoryInOrg(orgId, rootId);
    }

    return this.prisma.withOrganization(orgId, async (tx) => {
      return this.getHierarchyTx(tx as any, orgId, rootId);
    });
  }

  private async getHierarchyTx(
    tx: any,
    orgId: string,
    rootId?: string,
  ): Promise<TerritoryHierarchyNode[]> {
    // Two CTE shapes:
    //   - rootId set:    base case = single row WHERE id = rootId
    //   - rootId unset:  base case = all roots (parentTerritoryId IS NULL)
    //
    // BOTH cases enforce organizationId in the base AND recursive
    // case — the Wave F1 lesson. Without the org filter on the
    // recursive case, a malicious org could insert a row whose
    // parentTerritoryId points at a sibling tenant's id and the CTE
    // would happily walk it.
    const rows = rootId
      ? await tx.$queryRaw<
          Array<{
            id: string;
            name: string;
            parentTerritoryId: string | null;
            depth: number;
          }>
        >`
          WITH RECURSIVE tree AS (
            SELECT
              t.id,
              t.name,
              t."parentTerritoryId",
              0 AS depth
            FROM "territories" t
            WHERE t.id = ${rootId}
              AND t."organizationId" = ${orgId}
            UNION ALL
            SELECT
              child.id,
              child.name,
              child."parentTerritoryId",
              tree.depth + 1 AS depth
            FROM "territories" child
            INNER JOIN tree ON child."parentTerritoryId" = tree.id
            WHERE child."organizationId" = ${orgId}
              AND tree.depth < ${MAX_DEPTH}
          )
          SELECT id, name, "parentTerritoryId", depth
          FROM tree
          ORDER BY depth ASC, name ASC
        `
      : await tx.$queryRaw<
          Array<{
            id: string;
            name: string;
            parentTerritoryId: string | null;
            depth: number;
          }>
        >`
          WITH RECURSIVE tree AS (
            SELECT
              t.id,
              t.name,
              t."parentTerritoryId",
              0 AS depth
            FROM "territories" t
            WHERE t."parentTerritoryId" IS NULL
              AND t."organizationId" = ${orgId}
            UNION ALL
            SELECT
              child.id,
              child.name,
              child."parentTerritoryId",
              tree.depth + 1 AS depth
            FROM "territories" child
            INNER JOIN tree ON child."parentTerritoryId" = tree.id
            WHERE child."organizationId" = ${orgId}
              AND tree.depth < ${MAX_DEPTH}
          )
          SELECT id, name, "parentTerritoryId", depth
          FROM tree
          ORDER BY depth ASC, name ASC
        `;

    return rows.map((r) => ({
      id: r.id,
      name: r.name,
      parentTerritoryId: r.parentTerritoryId,
      depth: Number(r.depth),
    }));
  }

  /**
   * Walk UP from a territory via parentTerritoryId. Returns the
   * ancestor chain oldest-first (root → ... → immediate parent),
   * NOT including the territory itself. Bounded by MAX_DEPTH.
   */
  async getAncestors(
    orgId: string,
    territoryId: string,
  ): Promise<TerritoryHierarchyNode[]> {
    await this.assertTerritoryInOrg(orgId, territoryId);

    return this.prisma.withOrganization(orgId, async (tx) => {
      return this.getAncestorsTx(tx as any, orgId, territoryId);
    });
  }

  private async getAncestorsTx(
    tx: any,
    orgId: string,
    territoryId: string,
  ): Promise<TerritoryHierarchyNode[]> {
    const rows = await tx.$queryRaw<
      Array<{
        id: string;
        name: string;
        parentTerritoryId: string | null;
        depth: number;
      }>
    >`
      WITH RECURSIVE chain AS (
        SELECT
          t.id,
          t.name,
          t."parentTerritoryId",
          0 AS depth
        FROM "territories" t
        WHERE t.id = ${territoryId}
          AND t."organizationId" = ${orgId}
        UNION ALL
        SELECT
          parent.id,
          parent.name,
          parent."parentTerritoryId",
          chain.depth + 1 AS depth
        FROM "territories" parent
        INNER JOIN chain ON parent.id = chain."parentTerritoryId"
        WHERE parent."organizationId" = ${orgId}
          AND chain.depth < ${MAX_DEPTH}
      )
      SELECT id, name, "parentTerritoryId", depth
      FROM chain
      WHERE id <> ${territoryId}
      ORDER BY depth DESC
    `;

    return rows.map((r) => ({
      id: r.id,
      name: r.name,
      parentTerritoryId: r.parentTerritoryId,
      depth: Number(r.depth),
    }));
  }

  // ─── Internals ────────────────────────────────────────────────

  private async assertTerritoryInOrg(orgId: string, territoryId: string) {
    const t = await this.prisma.territory.findFirst({
      where: { id: territoryId, organizationId: orgId },
      select: { id: true },
    });
    if (!t) throw new NotFoundException('Territory not found');
  }
}
