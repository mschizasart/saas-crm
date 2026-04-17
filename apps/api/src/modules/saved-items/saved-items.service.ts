import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service';

export interface CreateSavedItemDto {
  description: string;
  longDescription?: string;
  rate: number;
  taxRate?: number;
  tax1?: string;
  tax2?: string;
  unit?: string;
  groupName?: string;
  assignedTo?: string;
  state?: string;
  zipCode?: string;
}

@Injectable()
export class SavedItemsService {
  constructor(private prisma: PrismaService) {}

  async findAll(orgId: string, query?: { search?: string }) {
    return this.prisma.withOrganization(orgId, async (tx) => {
      const where: any = { organizationId: orgId };
      if (query?.search) {
        where.description = { contains: query.search, mode: 'insensitive' };
      }
      return tx.savedItem.findMany({
        where,
        orderBy: { description: 'asc' },
      });
    });
  }

  async findOne(orgId: string, id: string) {
    return this.prisma.withOrganization(orgId, async (tx) => {
      const item = await tx.savedItem.findFirst({
        where: { id, organizationId: orgId },
      });
      if (!item) throw new NotFoundException('Saved item not found');
      return item;
    });
  }

  async create(orgId: string, dto: CreateSavedItemDto) {
    return this.prisma.withOrganization(orgId, async (tx) => {
      return tx.savedItem.create({
        data: {
          organizationId: orgId,
          description: dto.description,
          longDescription: dto.longDescription ?? null,
          rate: dto.rate,
          taxRate: dto.taxRate ?? 0,
          unit: dto.unit ?? null,
          groupName: dto.groupName ?? null,
          ...(dto.tax1 !== undefined && { tax1: dto.tax1 }),
          ...(dto.tax2 !== undefined && { tax2: dto.tax2 }),
          ...(dto.assignedTo !== undefined && { assignedTo: dto.assignedTo }),
          ...(dto.state !== undefined && { state: dto.state }),
          ...(dto.zipCode !== undefined && { zipCode: dto.zipCode }),
        } as any,
      });
    });
  }

  async update(orgId: string, id: string, dto: Partial<CreateSavedItemDto>) {
    await this.findOne(orgId, id);
    return this.prisma.withOrganization(orgId, async (tx) => {
      return tx.savedItem.update({
        where: { id },
        data: {
          ...(dto.description !== undefined && { description: dto.description }),
          ...(dto.longDescription !== undefined && { longDescription: dto.longDescription }),
          ...(dto.rate !== undefined && { rate: dto.rate }),
          ...(dto.taxRate !== undefined && { taxRate: dto.taxRate }),
          ...(dto.tax1 !== undefined && { tax1: dto.tax1 }),
          ...(dto.tax2 !== undefined && { tax2: dto.tax2 }),
          ...(dto.unit !== undefined && { unit: dto.unit }),
          ...(dto.groupName !== undefined && { groupName: dto.groupName }),
          ...(dto.assignedTo !== undefined && { assignedTo: dto.assignedTo }),
          ...(dto.state !== undefined && { state: dto.state }),
          ...(dto.zipCode !== undefined && { zipCode: dto.zipCode }),
        } as any,
      });
    });
  }

  async delete(orgId: string, id: string) {
    await this.findOne(orgId, id);
    await this.prisma.withOrganization(orgId, async (tx) => {
      await tx.savedItem.delete({ where: { id } });
    });
  }
}
