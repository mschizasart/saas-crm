import {
  Injectable,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service';
import {
  CreateStageDto,
  UpdateStageDto,
  ReorderStageItem,
} from './opportunities.dto';

/**
 * Stage / pipeline CRUD.
 *
 * Stages are per-org. Delete refuses while any opportunity references
 * the stage (RESTRICT FK at the DB level + explicit check here for a
 * friendly error message). Reorder rewrites every passed `order` in a
 * single transaction.
 */
@Injectable()
export class PipelinesService {
  constructor(private prisma: PrismaService) {}

  async list(orgId: string) {
    return this.prisma.withOrganization(orgId, async (tx) => {
      return tx.opportunityStage.findMany({
        where: { organizationId: orgId },
        orderBy: [{ order: 'asc' }, { createdAt: 'asc' }],
        include: { _count: { select: { opportunities: true } } },
      });
    });
  }

  async create(orgId: string, dto: CreateStageDto) {
    return this.prisma.withOrganization(orgId, async (tx) => {
      // Default the order to (max + 1) so new stages append at the end
      // of the kanban unless the caller passes one explicitly.
      let order = dto.order;
      if (order === undefined) {
        const max = await tx.opportunityStage.aggregate({
          where: { organizationId: orgId },
          _max: { order: true },
        });
        order = (max._max.order ?? 0) + 1;
      }

      return tx.opportunityStage.create({
        data: {
          organizationId: orgId,
          name: dto.name,
          order,
          probability: dto.probability,
          isWon: dto.isWon ?? false,
          isLost: dto.isLost ?? false,
        },
      });
    });
  }

  async update(orgId: string, id: string, dto: UpdateStageDto) {
    return this.prisma.withOrganization(orgId, async (tx) => {
      const existing = await tx.opportunityStage.findFirst({
        where: { id, organizationId: orgId },
      });
      if (!existing) throw new NotFoundException('Stage not found');

      return tx.opportunityStage.update({
        where: { id },
        data: {
          ...(dto.name !== undefined && { name: dto.name }),
          ...(dto.order !== undefined && { order: dto.order }),
          ...(dto.probability !== undefined && { probability: dto.probability }),
          ...(dto.isWon !== undefined && { isWon: dto.isWon }),
          ...(dto.isLost !== undefined && { isLost: dto.isLost }),
        },
      });
    });
  }

  async remove(orgId: string, id: string) {
    return this.prisma.withOrganization(orgId, async (tx) => {
      const existing = await tx.opportunityStage.findFirst({
        where: { id, organizationId: orgId },
      });
      if (!existing) throw new NotFoundException('Stage not found');

      // Refuse to delete a stage that's still in use — better UX than
      // letting the FK RESTRICT bubble up as a 500.
      const inUse = await tx.opportunity.count({
        where: { organizationId: orgId, stageId: id },
      });
      if (inUse > 0) {
        throw new BadRequestException(
          `Cannot delete stage: ${inUse} opportunit${inUse === 1 ? 'y is' : 'ies are'} still in this stage. Move them first.`,
        );
      }

      await tx.opportunityStage.delete({ where: { id } });
    });
  }

  /**
   * Bulk reorder. Accepts a list of `{ id, order }` and updates each
   * in a single transaction so the kanban can never end up half-rewritten.
   */
  async reorder(orgId: string, items: ReorderStageItem[]) {
    if (!Array.isArray(items) || items.length === 0) {
      throw new BadRequestException('Body must be a non-empty array of { id, order }');
    }

    return this.prisma.withOrganization(orgId, async (tx) => {
      // Dedup guard: if the caller sends the same id twice with different
      // orders, both updates would run silently and the last one wins.
      // Refuse the request instead so the caller fixes their payload.
      const seen = new Set<string>();
      for (const item of items) {
        if (seen.has(item.id)) {
          throw new BadRequestException('Duplicate stage id in reorder');
        }
        seen.add(item.id);
      }

      // Verify every id belongs to the org BEFORE writing.
      const ids = items.map((i) => i.id);
      const existing = await tx.opportunityStage.findMany({
        where: { id: { in: ids }, organizationId: orgId },
        select: { id: true },
      });
      if (existing.length !== ids.length) {
        throw new BadRequestException('One or more stage ids are invalid for this organization');
      }

      // Sequential awaits inside the org-scoped tx so the SET LOCAL
      // tenant context applies to every UPDATE.
      for (const item of items) {
        await tx.opportunityStage.update({
          where: { id: item.id },
          data: { order: item.order },
        });
      }

      return tx.opportunityStage.findMany({
        where: { organizationId: orgId },
        orderBy: [{ order: 'asc' }, { createdAt: 'asc' }],
      });
    });
  }
}
