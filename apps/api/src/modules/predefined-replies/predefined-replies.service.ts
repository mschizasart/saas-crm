import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service';

export interface CreatePredefinedReplyDto {
  name: string;
  body: string;
}

@Injectable()
export class PredefinedRepliesService {
  constructor(private prisma: PrismaService) {}

  async findAll(orgId: string, query?: { search?: string }) {
    return this.prisma.withOrganization(orgId, async (tx) => {
      const where: any = { organizationId: orgId };
      if (query?.search) {
        where.OR = [
          { name: { contains: query.search, mode: 'insensitive' } },
          { body: { contains: query.search, mode: 'insensitive' } },
        ];
      }
      return tx.predefinedReply.findMany({
        where,
        orderBy: { name: 'asc' },
      });
    });
  }

  async findOne(orgId: string, id: string) {
    return this.prisma.withOrganization(orgId, async (tx) => {
      const reply = await tx.predefinedReply.findFirst({
        where: { id, organizationId: orgId },
      });
      if (!reply) throw new NotFoundException('Predefined reply not found');
      return reply;
    });
  }

  async create(orgId: string, dto: CreatePredefinedReplyDto) {
    return this.prisma.withOrganization(orgId, async (tx) => {
      return tx.predefinedReply.create({
        data: {
          organizationId: orgId,
          name: dto.name,
          body: dto.body,
        },
      });
    });
  }

  async update(orgId: string, id: string, dto: Partial<CreatePredefinedReplyDto>) {
    await this.findOne(orgId, id);
    return this.prisma.withOrganization(orgId, async (tx) => {
      return tx.predefinedReply.update({
        where: { id },
        data: {
          ...(dto.name !== undefined && { name: dto.name }),
          ...(dto.body !== undefined && { body: dto.body }),
        },
      });
    });
  }

  async delete(orgId: string, id: string) {
    await this.findOne(orgId, id);
    await this.prisma.withOrganization(orgId, async (tx) => {
      await tx.predefinedReply.delete({ where: { id } });
    });
  }
}
