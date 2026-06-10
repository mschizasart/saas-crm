import {
  Injectable,
  BadRequestException,
  NotFoundException,
  ConflictException,
} from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service';
import { AssignEntityDto } from './territories.dto';

// ─── Territory assignments service (Wave G2) ────────────────────
//
// Polymorphic links between a territory and a Client / Lead /
// Opportunity. Tenant guards:
//   * territoryId — must belong to caller's org.
//   * entityId    — must exist in the right table for caller's org.
//                   No DB-level FK on entityId (polymorphic), so the
//                   service layer is the ONLY guard preventing a
//                   forged id from sneaking through. Without this,
//                   a malicious caller could create rows referencing
//                   another tenant's entity ids (no PK violation —
//                   the row would just silently link to nothing
//                   meaningful).
// UNIQUE (territoryId, entityType, entityId) → P2002 → 409.

type EntityType = 'client' | 'lead' | 'opportunity';

@Injectable()
export class TerritoryAssignmentsService {
  constructor(private prisma: PrismaService) {}

  async list(
    orgId: string,
    territoryId: string,
    query: { entityType?: EntityType; page?: number; limit?: number },
  ) {
    await this.assertTerritoryInOrg(orgId, territoryId);

    const { entityType, page = 1 } = query;
    const limit = Math.min(query.limit ?? 20, 100);
    const skip = (page - 1) * limit;

    return this.prisma.withOrganization(orgId, async (tx) => {
      const where: any = { organizationId: orgId, territoryId };
      if (entityType) where.entityType = entityType;

      const [rows, total] = await Promise.all([
        tx.territoryAssignment.findMany({
          where,
          skip,
          take: limit,
          orderBy: { createdAt: 'desc' },
        }),
        tx.territoryAssignment.count({ where }),
      ]);

      // Hydrate entity metadata (one query per entity type touched).
      // Saves the UI from doing N+1 lookups for the table render.
      const byType: Record<EntityType, string[]> = {
        client: [],
        lead: [],
        opportunity: [],
      };
      for (const r of rows) {
        const t = r.entityType as EntityType;
        if (t in byType) byType[t].push(r.entityId);
      }

      const [clients, leads, opportunities] = await Promise.all([
        byType.client.length
          ? tx.client.findMany({
              where: { id: { in: byType.client }, organizationId: orgId },
              select: { id: true, company: true },
            })
          : Promise.resolve([] as Array<{ id: string; company: string }>),
        byType.lead.length
          ? tx.lead.findMany({
              where: { id: { in: byType.lead }, organizationId: orgId },
              select: { id: true, name: true, company: true },
            })
          : Promise.resolve(
              [] as Array<{ id: string; name: string; company: string | null }>,
            ),
        byType.opportunity.length
          ? tx.opportunity.findMany({
              where: {
                id: { in: byType.opportunity },
                organizationId: orgId,
              },
              select: { id: true, name: true, amount: true, currency: true },
            })
          : Promise.resolve(
              [] as Array<{
                id: string;
                name: string;
                amount: any;
                currency: string;
              }>,
            ),
      ]);

      const clientById = new Map(clients.map((c) => [c.id, c]));
      const leadById = new Map(leads.map((l) => [l.id, l]));
      const oppById = new Map(opportunities.map((o) => [o.id, o]));

      const data = rows.map((r) => {
        const t = r.entityType as EntityType;
        let entity: any = null;
        if (t === 'client') entity = clientById.get(r.entityId) ?? null;
        else if (t === 'lead') entity = leadById.get(r.entityId) ?? null;
        else if (t === 'opportunity') entity = oppById.get(r.entityId) ?? null;
        return { ...r, entity };
      });

      return {
        data,
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit),
      };
    });
  }

  async assign(
    orgId: string,
    territoryId: string,
    dto: AssignEntityDto,
  ) {
    await this.assertTerritoryInOrg(orgId, territoryId);

    return this.prisma.withOrganization(orgId, async (tx) => {
      // Cross-tenant FK guard: validate entityId exists in the right
      // table for the caller's org. This is the ONLY guard against
      // a forged id since the FK is polymorphic (DB has no FK on
      // entityId).
      const found = await this.findEntity(tx, orgId, dto.entityType, dto.entityId);
      if (!found) {
        throw new BadRequestException(
          `${dto.entityType} not found for this organization`,
        );
      }

      try {
        return await tx.territoryAssignment.create({
          data: {
            organizationId: orgId,
            territoryId,
            entityType: dto.entityType,
            entityId: dto.entityId,
          },
        });
      } catch (e: any) {
        if (e?.code === 'P2002') {
          throw new ConflictException(
            `${dto.entityType} is already assigned to this territory`,
          );
        }
        throw e;
      }
    });
  }

  async unassign(
    orgId: string,
    territoryId: string,
    assignmentId: string,
  ) {
    await this.assertTerritoryInOrg(orgId, territoryId);

    return this.prisma.withOrganization(orgId, async (tx) => {
      // Defense-in-depth: id + organizationId + territoryId. The
      // territoryId scope makes sure callers can't unassign rows
      // that belong to a sibling territory by id alone.
      const existing = await tx.territoryAssignment.findFirst({
        where: {
          id: assignmentId,
          organizationId: orgId,
          territoryId,
        },
        select: { id: true },
      });
      if (!existing) {
        throw new NotFoundException('Assignment not found');
      }

      await tx.territoryAssignment.delete({
        where: { id: existing.id, organizationId: orgId, territoryId },
      });
    });
  }

  /**
   * Reverse lookup: "which territories is THIS entity in?"
   *
   * Tenant-scoped at every step. Returns the Territory rows the
   * entity is assigned to (deduped via the UNIQUE on assignments).
   */
  async getTerritoriesForEntity(
    orgId: string,
    entityType: EntityType,
    entityId: string,
  ) {
    return this.prisma.withOrganization(orgId, async (tx) => {
      // Validate the entity exists in the caller's org first — clean
      // 404 instead of "what does an empty result mean?" ambiguity.
      const found = await this.findEntity(tx, orgId, entityType, entityId);
      if (!found) {
        throw new NotFoundException(
          `${entityType} not found for this organization`,
        );
      }

      const assignments = await tx.territoryAssignment.findMany({
        where: {
          organizationId: orgId,
          entityType,
          entityId,
        },
        select: { territoryId: true },
      });

      const ids = assignments.map((a) => a.territoryId);
      if (ids.length === 0) return [];

      return tx.territory.findMany({
        where: { id: { in: ids }, organizationId: orgId },
        orderBy: { name: 'asc' },
        select: {
          id: true,
          name: true,
          description: true,
          parentTerritoryId: true,
          managerId: true,
        },
      });
    });
  }

  // ─── Internals ────────────────────────────────────────────────

  private async findEntity(
    tx: any,
    orgId: string,
    entityType: EntityType,
    entityId: string,
  ): Promise<{ id: string } | null> {
    if (entityType === 'client') {
      return tx.client.findFirst({
        where: { id: entityId, organizationId: orgId },
        select: { id: true },
      });
    }
    if (entityType === 'lead') {
      return tx.lead.findFirst({
        where: { id: entityId, organizationId: orgId },
        select: { id: true },
      });
    }
    if (entityType === 'opportunity') {
      return tx.opportunity.findFirst({
        where: { id: entityId, organizationId: orgId },
        select: { id: true },
      });
    }
    // Defensive — DTO @IsIn should have caught this already.
    throw new BadRequestException(`Unknown entity type: ${entityType}`);
  }

  private async assertTerritoryInOrg(orgId: string, territoryId: string) {
    const t = await this.prisma.territory.findFirst({
      where: { id: territoryId, organizationId: orgId },
      select: { id: true },
    });
    if (!t) throw new NotFoundException('Territory not found');
  }
}
