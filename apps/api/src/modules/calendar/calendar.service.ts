import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service';

export interface CreateEventDto {
  title: string;
  description?: string;
  startDate: string;
  endDate?: string;
  allDay?: boolean;
  type?: string;
  color?: string;
  userId?: string;
  relatedType?: string;
  relatedId?: string;
}

@Injectable()
export class CalendarService {
  constructor(private prisma: PrismaService) {}

  async findAll(
    orgId: string,
    query: { from?: string; to?: string; userId?: string; type?: string },
  ) {
    return this.prisma.withOrganization(orgId, async (tx) => {
      const where: any = { organizationId: orgId };

      if (query.from || query.to) {
        where.startDate = {};
        if (query.from) where.startDate.gte = new Date(query.from);
        if (query.to) where.startDate.lte = new Date(query.to);
      }
      if (query.userId) where.userId = query.userId;
      if (query.type) where.type = query.type;

      return tx.event.findMany({
        where,
        orderBy: { startDate: 'asc' },
      });
    });
  }

  async findOne(orgId: string, id: string) {
    return this.prisma.withOrganization(orgId, async (tx) => {
      const event = await tx.event.findFirst({
        where: { id, organizationId: orgId },
      });
      if (!event) throw new NotFoundException('Event not found');
      return event;
    });
  }

  async create(orgId: string, dto: CreateEventDto, createdBy: string) {
    return this.prisma.withOrganization(orgId, async (tx) => {
      return tx.event.create({
        data: {
          organizationId: orgId,
          title: dto.title,
          description: dto.description ?? null,
          startDate: new Date(dto.startDate),
          endDate: dto.endDate ? new Date(dto.endDate) : null,
          allDay: dto.allDay ?? false,
          type: dto.type ?? 'event',
          color: dto.color ?? null,
          userId: dto.userId ?? null,
          relatedType: dto.relatedType ?? null,
          relatedId: dto.relatedId ?? null,
          createdBy,
        },
      });
    });
  }

  async update(orgId: string, id: string, dto: Partial<CreateEventDto>) {
    await this.findOne(orgId, id);
    return this.prisma.withOrganization(orgId, async (tx) => {
      return tx.event.update({
        where: { id },
        data: {
          ...(dto.title !== undefined && { title: dto.title }),
          ...(dto.description !== undefined && { description: dto.description }),
          ...(dto.startDate !== undefined && { startDate: new Date(dto.startDate) }),
          ...(dto.endDate !== undefined && {
            endDate: dto.endDate ? new Date(dto.endDate) : null,
          }),
          ...(dto.allDay !== undefined && { allDay: dto.allDay }),
          ...(dto.type !== undefined && { type: dto.type }),
          ...(dto.color !== undefined && { color: dto.color }),
          ...(dto.userId !== undefined && { userId: dto.userId }),
          ...(dto.relatedType !== undefined && { relatedType: dto.relatedType }),
          ...(dto.relatedId !== undefined && { relatedId: dto.relatedId }),
        },
      });
    });
  }

  async delete(orgId: string, id: string) {
    await this.findOne(orgId, id);
    await this.prisma.withOrganization(orgId, async (tx) => {
      await tx.event.delete({ where: { id } });
    });
  }

  async getUpcoming(orgId: string, userId?: string, limit = 10) {
    return this.prisma.withOrganization(orgId, async (tx) => {
      const where: any = {
        organizationId: orgId,
        startDate: { gte: new Date() },
      };
      if (userId) where.userId = userId;
      return tx.event.findMany({
        where,
        orderBy: { startDate: 'asc' },
        take: limit,
      });
    });
  }
}
