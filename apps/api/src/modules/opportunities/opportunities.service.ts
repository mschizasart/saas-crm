import {
  Injectable,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service';
import {
  CreateOpportunityDto,
  UpdateOpportunityDto,
} from './opportunities.dto';

/**
 * CRUD + stage transitions for opportunities.
 *
 * Every query is explicitly scoped to `organizationId` (the service
 * layer is the only tenant boundary — there is no RLS in this DB).
 *
 * `moveStage()` is the load-bearing method: it writes the opportunity
 * update AND the `opportunity_stage_history` row inside a single
 * `prisma.$transaction([...])` so the audit log can never drift.
 */
@Injectable()
export class OpportunitiesService {
  constructor(private prisma: PrismaService) {}

  // ─── List / Find ──────────────────────────────────────────────

  async list(
    orgId: string,
    query: {
      search?: string;
      stageId?: string;
      ownerId?: string;
      page?: number;
      limit?: number;
    },
  ) {
    const { search, stageId, ownerId, page = 1, limit = 20 } = query;
    const skip = (page - 1) * limit;

    return this.prisma.withOrganization(orgId, async (tx) => {
      const where: any = { organizationId: orgId };

      if (search) {
        where.OR = [
          { name: { contains: search, mode: 'insensitive' } },
          { description: { contains: search, mode: 'insensitive' } },
        ];
      }
      if (stageId) where.stageId = stageId;
      if (ownerId) where.ownerId = ownerId;

      const [data, total] = await Promise.all([
        tx.opportunity.findMany({
          where,
          skip,
          take: limit,
          orderBy: { createdAt: 'desc' },
          include: {
            stage: { select: { id: true, name: true, probability: true, isWon: true, isLost: true, order: true } },
            owner: { select: { id: true, firstName: true, lastName: true, email: true } },
            client: { select: { id: true, company: true } },
            lead:   { select: { id: true, name: true } },
          },
        }),
        tx.opportunity.count({ where }),
      ]);

      return { data, total, page, limit, totalPages: Math.ceil(total / limit) };
    });
  }

  async findOne(orgId: string, id: string) {
    return this.prisma.withOrganization(orgId, async (tx) => {
      const opp = await tx.opportunity.findFirst({
        where: { id, organizationId: orgId },
        include: {
          stage: true,
          owner: { select: { id: true, firstName: true, lastName: true, email: true } },
          client: { select: { id: true, company: true } },
          lead:   { select: { id: true, name: true } },
          stageHistory: {
            orderBy: { changedAt: 'desc' },
            take: 50,
            include: {
              changedBy: { select: { id: true, firstName: true, lastName: true } },
            },
          },
        },
      });
      if (!opp) throw new NotFoundException('Opportunity not found');
      return opp;
    });
  }

  // ─── Create ──────────────────────────────────────────────────

  async create(orgId: string, userId: string, dto: CreateOpportunityDto) {
    return this.prisma.withOrganization(orgId, async (tx) => {
      // Validate stage belongs to the org (FK alone allows cross-tenant ids
      // — guard explicitly so a forged stageId can't escape the tenant).
      const stage = await tx.opportunityStage.findFirst({
        where: { id: dto.stageId, organizationId: orgId },
        select: { id: true },
      });
      if (!stage) {
        throw new BadRequestException('Stage not found for this organization');
      }

      // Validate owner is a user in this org.
      const owner = await tx.user.findFirst({
        where: { id: dto.ownerId, organizationId: orgId },
        select: { id: true },
      });
      if (!owner) {
        throw new BadRequestException('Owner not found for this organization');
      }

      // Validate optional client / lead belong to the org.
      if (dto.clientId) {
        const client = await tx.client.findFirst({
          where: { id: dto.clientId, organizationId: orgId },
          select: { id: true },
        });
        if (!client) throw new BadRequestException('Client not found for this organization');
      }
      if (dto.leadId) {
        const lead = await tx.lead.findFirst({
          where: { id: dto.leadId, organizationId: orgId },
          select: { id: true },
        });
        if (!lead) throw new BadRequestException('Lead not found for this organization');
      }

      const created = await tx.opportunity.create({
        data: {
          organizationId: orgId,
          name: dto.name,
          clientId: dto.clientId ?? null,
          leadId: dto.leadId ?? null,
          ownerId: dto.ownerId,
          stageId: dto.stageId,
          // Prisma `Decimal` accepts a plain number — no precision loss
          // because the DTO has been validated as a finite number.
          amount: dto.amount ?? 0,
          currency: dto.currency ?? 'USD',
          closeDate: new Date(dto.closeDate),
          description: dto.description ?? null,
          source: dto.source ?? null,
        },
      });

      // Seed the stage-history audit log with the create event.
      await tx.opportunityStageHistory.create({
        data: {
          organizationId: orgId,
          opportunityId: created.id,
          fromStageId: null,
          toStageId: dto.stageId,
          changedById: userId,
        },
      });

      return created;
    });
  }

  // ─── Update ──────────────────────────────────────────────────

  async update(orgId: string, id: string, dto: UpdateOpportunityDto) {
    await this.findOne(orgId, id);

    return this.prisma.withOrganization(orgId, async (tx) => {
      // If the caller is changing the stage via the generic update path,
      // refuse — they must use `moveStage()` so the history row is
      // written atomically. This keeps the audit log honest.
      if (dto.stageId !== undefined) {
        throw new BadRequestException(
          'Use POST /opportunities/:id/move-stage to change the stage',
        );
      }

      // Cross-tenant guard on optional relations.
      if (dto.ownerId !== undefined && dto.ownerId !== null) {
        const owner = await tx.user.findFirst({
          where: { id: dto.ownerId, organizationId: orgId },
          select: { id: true },
        });
        if (!owner) throw new BadRequestException('Owner not found for this organization');
      }
      if (dto.clientId !== undefined && dto.clientId !== null) {
        const client = await tx.client.findFirst({
          where: { id: dto.clientId, organizationId: orgId },
          select: { id: true },
        });
        if (!client) throw new BadRequestException('Client not found for this organization');
      }
      if (dto.leadId !== undefined && dto.leadId !== null) {
        const lead = await tx.lead.findFirst({
          where: { id: dto.leadId, organizationId: orgId },
          select: { id: true },
        });
        if (!lead) throw new BadRequestException('Lead not found for this organization');
      }

      return tx.opportunity.update({
        where: { id, organizationId: orgId },
        data: {
          ...(dto.name !== undefined && { name: dto.name }),
          ...(dto.clientId !== undefined && { clientId: dto.clientId }),
          ...(dto.leadId !== undefined && { leadId: dto.leadId }),
          ...(dto.ownerId !== undefined && { ownerId: dto.ownerId }),
          ...(dto.amount !== undefined && { amount: dto.amount }),
          ...(dto.currency !== undefined && { currency: dto.currency }),
          ...(dto.closeDate !== undefined && { closeDate: new Date(dto.closeDate) }),
          ...(dto.description !== undefined && { description: dto.description }),
          ...(dto.source !== undefined && { source: dto.source }),
        },
      });
    });
  }

  // ─── Delete ──────────────────────────────────────────────────

  async remove(orgId: string, id: string) {
    await this.findOne(orgId, id);
    await this.prisma.withOrganization(orgId, async (tx) => {
      await tx.opportunity.delete({ where: { id } });
    });
  }

  // ─── Move Stage (audited, transactional) ─────────────────────

  /**
   * Change the stage of an opportunity.
   *
   * The opportunity UPDATE and the stage_history INSERT happen inside
   * a single `prisma.$transaction([...])` so the two writes either
   * both succeed or both roll back. Without this, a crashed request
   * could silently drop a transition from the audit log.
   *
   * No-op if the new stage equals the current stage (returns the row
   * unchanged so the UI gets a consistent shape back).
   */
  async moveStage(
    orgId: string,
    userId: string,
    id: string,
    newStageId: string,
  ) {
    // Pre-flight: load + tenant-validate everything BEFORE opening the
    // raw $transaction (the tenant-guard happens via the org-scoped
    // `findFirst` inside withOrganization which already runs in its own
    // transaction with SET LOCAL).
    const { current, newStage } = await this.prisma.withOrganization(
      orgId,
      async (tx) => {
        const opp = await tx.opportunity.findFirst({
          where: { id, organizationId: orgId },
          select: { id: true, stageId: true },
        });
        if (!opp) throw new NotFoundException('Opportunity not found');

        const stage = await tx.opportunityStage.findFirst({
          where: { id: newStageId, organizationId: orgId },
          select: { id: true },
        });
        if (!stage) {
          throw new BadRequestException(
            'Target stage not found for this organization',
          );
        }

        return { current: opp, newStage: stage };
      },
    );

    if (current.stageId === newStageId) {
      // Nothing to do — return the fresh opportunity so the caller still
      // gets a consistent shape.
      return this.findOne(orgId, id);
    }

    // Atomic UPDATE + history INSERT. We use the array form of
    // $transaction here so both writes commit together; the SET LOCAL
    // organization context is set inside via the explicit
    // `organizationId` filter on each write. (We can't reuse
    // withOrganization here because it expects a single callback, and
    // Prisma forbids nesting $transaction inside an interactive txn.)
    await this.prisma.$transaction([
      this.prisma.opportunity.update({
        where: { id, organizationId: orgId },
        data: { stageId: newStageId },
      }),
      this.prisma.opportunityStageHistory.create({
        data: {
          organizationId: orgId,
          opportunityId: id,
          fromStageId: current.stageId,
          toStageId: newStageId,
          changedById: userId,
        },
      }),
    ]);

    return this.findOne(orgId, id);
  }

  // ─── Kanban ──────────────────────────────────────────────────

  /**
   * Returns every stage in the pipeline, each with up to 100 most
   * recent opportunities. The web UI renders one column per stage.
   */
  async kanban(orgId: string) {
    return this.prisma.withOrganization(orgId, async (tx) => {
      const stages = await tx.opportunityStage.findMany({
        where: { organizationId: orgId },
        orderBy: [{ order: 'asc' }, { createdAt: 'asc' }],
      });

      const opps = await tx.opportunity.findMany({
        where: { organizationId: orgId },
        orderBy: { createdAt: 'desc' },
        // Generous cap; UI may further limit per column to 100.
        take: stages.length * 100,
        include: {
          owner: { select: { id: true, firstName: true, lastName: true } },
          client: { select: { id: true, company: true } },
          lead:   { select: { id: true, name: true } },
        },
      });

      // Bucket opportunities per stage and cap at 100 each.
      const byStage = new Map<string, typeof opps>();
      for (const stage of stages) byStage.set(stage.id, []);
      for (const opp of opps) {
        const bucket = byStage.get(opp.stageId);
        if (bucket && bucket.length < 100) bucket.push(opp);
      }

      return stages.map((stage) => ({
        stage,
        opportunities: byStage.get(stage.id) ?? [],
      }));
    });
  }
}
