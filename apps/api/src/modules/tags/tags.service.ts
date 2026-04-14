import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service';

export interface CreateTagDto {
  name: string;
  color?: string;
}

export type UpdateTagDto = Partial<CreateTagDto>;

@Injectable()
export class TagsService {
  constructor(private prisma: PrismaService) {}

  async findAll(orgId: string) {
    return this.prisma.withOrganization(orgId, async (tx) => {
      return tx.tag.findMany({
        where: { organizationId: orgId },
        orderBy: { name: 'asc' },
        include: { _count: { select: { taggables: true } } },
      });
    });
  }

  async findOne(orgId: string, id: string) {
    return this.prisma.withOrganization(orgId, async (tx) => {
      const tag = await tx.tag.findFirst({
        where: { id, organizationId: orgId },
      });
      if (!tag) throw new NotFoundException('Tag not found');
      return tag;
    });
  }

  async create(orgId: string, dto: CreateTagDto) {
    return this.prisma.withOrganization(orgId, async (tx) => {
      return tx.tag.create({
        data: {
          organizationId: orgId,
          name: dto.name,
          color: dto.color ?? '#6b7280',
        },
      });
    });
  }

  async update(orgId: string, id: string, dto: UpdateTagDto) {
    await this.findOne(orgId, id);
    return this.prisma.withOrganization(orgId, async (tx) => {
      return tx.tag.update({
        where: { id },
        data: {
          ...(dto.name !== undefined && { name: dto.name }),
          ...(dto.color !== undefined && { color: dto.color }),
        },
      });
    });
  }

  async delete(orgId: string, id: string) {
    await this.findOne(orgId, id);
    await this.prisma.withOrganization(orgId, async (tx) => {
      await tx.tag.delete({ where: { id } });
    });
  }

  async assignTag(
    orgId: string,
    relType: string,
    relId: string,
    tagId: string,
  ) {
    await this.findOne(orgId, tagId);
    const prismaAny = this.prisma as any;
    return prismaAny.taggable.upsert({
      where: { tagId_relType_relId: { tagId, relType, relId } },
      create: { tagId, relType, relId },
      update: {},
    });
  }

  async removeTag(
    orgId: string,
    relType: string,
    relId: string,
    tagId: string,
  ) {
    await this.findOne(orgId, tagId);
    const prismaAny = this.prisma as any;
    await prismaAny.taggable.deleteMany({
      where: { tagId, relType, relId },
    });
  }

  async getTagsFor(orgId: string, relType: string, relId: string) {
    return this.prisma.withOrganization(orgId, async (tx) => {
      const taggables = await tx.taggable.findMany({
        where: { relType, relId, tag: { organizationId: orgId } },
        include: { tag: true },
      });
      return taggables.map((t: any) => t.tag);
    });
  }

  async findByTag(orgId: string, tagId: string, relType?: string) {
    await this.findOne(orgId, tagId);
    return this.prisma.withOrganization(orgId, async (tx) => {
      return tx.taggable.findMany({
        where: { tagId, ...(relType && { relType }) },
      });
    });
  }
}
