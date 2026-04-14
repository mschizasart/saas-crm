import { Injectable, NotFoundException } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { PrismaService } from '../../database/prisma.service';

export interface CreateGoalDto {
  title: string;
  description?: string;
  type: string;
  target: number;
  startDate: string;
  endDate: string;
  // Not persisted (no userId column on schema) — kept for API compat; TODO add column.
  userId?: string;
  notificationWhenReached?: boolean;
}

// Derive a UI-friendly status from the row's dates / achievedAt.
function deriveStatus(goal: any): string {
  if (goal.achievedAt) return 'achieved';
  const now = new Date();
  if (goal.startDate && new Date(goal.startDate) > now) return 'not_started';
  if (goal.endDate && new Date(goal.endDate) < now) return 'failed';
  return 'active';
}

function decorate(goal: any) {
  if (!goal) return goal;
  return { ...goal, status: deriveStatus(goal) };
}

@Injectable()
export class GoalsService {
  constructor(
    private prisma: PrismaService,
    private events: EventEmitter2,
  ) {}

  async findAll(
    orgId: string,
    query: { userId?: string; status?: string; page?: number; limit?: number },
  ) {
    const { status, page = 1, limit = 20 } = query;
    const skip = (page - 1) * limit;

    return this.prisma.withOrganization(orgId, async (tx) => {
      const where: any = { organizationId: orgId };

      const [rows, total] = await Promise.all([
        tx.goal.findMany({
          where,
          skip,
          take: limit,
          orderBy: { createdAt: 'desc' },
        }),
        tx.goal.count({ where }),
      ]);

      let data = rows.map(decorate);
      if (status) data = data.filter((g: any) => g.status === status);

      return { data, total, page, limit, totalPages: Math.ceil(total / limit) };
    });
  }

  async findOne(orgId: string, id: string) {
    return this.prisma.withOrganization(orgId, async (tx) => {
      const goal = await tx.goal.findFirst({
        where: { id, organizationId: orgId },
      });
      if (!goal) throw new NotFoundException('Goal not found');
      return decorate(goal);
    });
  }

  async create(orgId: string, dto: CreateGoalDto) {
    const goal = await this.prisma.withOrganization(orgId, async (tx) => {
      return tx.goal.create({
        data: {
          organizationId: orgId,
          name: dto.title,
          description: dto.description ?? null,
          type: dto.type,
          target: dto.target,
          startDate: new Date(dto.startDate),
          endDate: new Date(dto.endDate),
          notifyWhenAchieved: dto.notificationWhenReached ?? true,
        },
      });
    });

    this.events.emit('goal.created', { goal, orgId });
    return decorate(goal);
  }

  async update(orgId: string, id: string, dto: Partial<CreateGoalDto>) {
    await this.findOne(orgId, id);
    const updated = await this.prisma.withOrganization(orgId, async (tx) => {
      return tx.goal.update({
        where: { id },
        data: {
          ...(dto.title !== undefined && { name: dto.title }),
          ...(dto.description !== undefined && { description: dto.description }),
          ...(dto.type !== undefined && { type: dto.type }),
          ...(dto.target !== undefined && { target: dto.target }),
          ...(dto.startDate !== undefined && { startDate: new Date(dto.startDate) }),
          ...(dto.endDate !== undefined && { endDate: new Date(dto.endDate) }),
          ...(dto.notificationWhenReached !== undefined && {
            notifyWhenAchieved: dto.notificationWhenReached,
          }),
        },
      });
    });
    return decorate(updated);
  }

  async delete(orgId: string, id: string) {
    await this.findOne(orgId, id);
    await this.prisma.withOrganization(orgId, async (tx) => {
      await tx.goal.delete({ where: { id } });
    });
  }

  async updateProgress(orgId: string, id: string, achieved: number) {
    const goal = await this.findOne(orgId, id);
    const reached = goal.target ? achieved >= Number(goal.target) : false;

    const updated = await this.prisma.withOrganization(orgId, async (tx) => {
      return tx.goal.update({
        where: { id },
        data: {
          current: achieved,
          ...(reached && !goal.achievedAt && { achievedAt: new Date() }),
        },
      });
    });

    if (reached && !goal.achievedAt) {
      this.events.emit('goal.achieved', { goal: updated, orgId });
    }

    return decorate(updated);
  }

  async getMyGoals(orgId: string, _userId: string) {
    // Schema has no per-user goals column yet — return all org goals for now.
    // TODO: add userId field to Goal model and filter here.
    return this.prisma.withOrganization(orgId, async (tx) => {
      const rows = await tx.goal.findMany({
        where: { organizationId: orgId },
        orderBy: { createdAt: 'desc' },
      });
      return rows.map(decorate);
    });
  }
}
