import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service';

export interface CreateProductDto {
  name: string;
  description?: string;
  sku?: string;
  unitPrice: number;
  costPrice?: number;
  taxRate?: number;
  unit?: string;
  stockQuantity?: number;
  lowStockAlert?: number;
  trackInventory?: boolean;
  active?: boolean;
}

@Injectable()
export class ProductsService {
  constructor(private prisma: PrismaService) {}

  async findAll(
    orgId: string,
    query: { search?: string; active?: boolean; page?: number; limit?: number },
  ) {
    const { search, active, page = 1, limit = 20 } = query;
    const skip = (page - 1) * limit;
    const where: any = { organizationId: orgId };
    if (active !== undefined) where.active = active;
    if (search) {
      where.OR = [
        { name: { contains: search, mode: 'insensitive' } },
        { sku: { contains: search, mode: 'insensitive' } },
        { description: { contains: search, mode: 'insensitive' } },
      ];
    }

    const [data, total] = await Promise.all([
      this.prisma.product.findMany({
        where,
        skip,
        take: limit,
        orderBy: { name: 'asc' },
      }),
      this.prisma.product.count({ where }),
    ]);

    return { data, total, page, limit, totalPages: Math.ceil(total / limit) };
  }

  async findOne(orgId: string, id: string) {
    const product = await this.prisma.product.findFirst({
      where: { id, organizationId: orgId },
    });
    if (!product) throw new NotFoundException('Product not found');
    return product;
  }

  async create(orgId: string, dto: CreateProductDto) {
    return this.prisma.product.create({
      data: {
        organizationId: orgId,
        name: dto.name,
        description: dto.description ?? null,
        sku: dto.sku ?? null,
        unitPrice: dto.unitPrice,
        costPrice: dto.costPrice ?? null,
        taxRate: dto.taxRate ?? 0,
        unit: dto.unit ?? null,
        stockQuantity: dto.stockQuantity ?? 0,
        lowStockAlert: dto.lowStockAlert ?? 5,
        trackInventory: dto.trackInventory ?? false,
        active: dto.active ?? true,
      },
    });
  }

  async update(orgId: string, id: string, dto: Partial<CreateProductDto>) {
    await this.findOne(orgId, id);
    const data: any = {};
    if (dto.name !== undefined) data.name = dto.name;
    if (dto.description !== undefined) data.description = dto.description;
    if (dto.sku !== undefined) data.sku = dto.sku;
    if (dto.unitPrice !== undefined) data.unitPrice = dto.unitPrice;
    if (dto.costPrice !== undefined) data.costPrice = dto.costPrice;
    if (dto.taxRate !== undefined) data.taxRate = dto.taxRate;
    if (dto.unit !== undefined) data.unit = dto.unit;
    if (dto.stockQuantity !== undefined) data.stockQuantity = dto.stockQuantity;
    if (dto.lowStockAlert !== undefined) data.lowStockAlert = dto.lowStockAlert;
    if (dto.trackInventory !== undefined) data.trackInventory = dto.trackInventory;
    if (dto.active !== undefined) data.active = dto.active;

    return this.prisma.product.update({ where: { id }, data });
  }

  async delete(orgId: string, id: string) {
    await this.findOne(orgId, id);
    await this.prisma.product.delete({ where: { id } });
  }

  async adjustStock(orgId: string, id: string, quantity: number, _reason?: string) {
    const product = await this.findOne(orgId, id);
    return this.prisma.product.update({
      where: { id },
      data: { stockQuantity: product.stockQuantity + quantity },
    });
  }

  async getLowStock(orgId: string) {
    return this.prisma.product.findMany({
      where: {
        organizationId: orgId,
        trackInventory: true,
        active: true,
        stockQuantity: { lte: this.prisma.product.fields?.lowStockAlert as any },
      },
    });
  }

  async getLowStockProducts(orgId: string) {
    // Use raw query to compare stockQuantity <= lowStockAlert
    return this.prisma.$queryRaw`
      SELECT * FROM "products"
      WHERE "organizationId" = ${orgId}
        AND "trackInventory" = true
        AND "active" = true
        AND "stockQuantity" <= "lowStockAlert"
      ORDER BY "stockQuantity" ASC
    `;
  }

  async search(orgId: string, query: string) {
    return this.prisma.product.findMany({
      where: {
        organizationId: orgId,
        active: true,
        OR: [
          { name: { contains: query, mode: 'insensitive' } },
          { sku: { contains: query, mode: 'insensitive' } },
        ],
      },
      take: 10,
      orderBy: { name: 'asc' },
    });
  }
}
