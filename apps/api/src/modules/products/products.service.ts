import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { PrismaService } from '../../database/prisma.service';
import { EXPORT_ROW_CAP } from '../../common/csv/csv-writer';

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

export type StockMovementReason =
  | 'invoice_sent'
  | 'manual_adjustment'
  | 'return'
  | 'purchase'
  | 'correction';

@Injectable()
export class ProductsService {
  private readonly logger = new Logger(ProductsService.name);

  constructor(private prisma: PrismaService) {}

  // ─── Export ───────────────────────────────────────────────
  async findAllForExport(
    orgId: string,
    query: { search?: string; active?: boolean } = {},
  ): Promise<{ rows: any[]; truncated: boolean }> {
    const { search, active } = query;
    const where: any = { organizationId: orgId };
    if (active !== undefined) where.active = active;
    if (search) {
      where.OR = [
        { name: { contains: search, mode: 'insensitive' } },
        { sku: { contains: search, mode: 'insensitive' } },
        { description: { contains: search, mode: 'insensitive' } },
      ];
    }

    return this.prisma.withOrganization(orgId, async (tx) => {
      const rows = await tx.product.findMany({
        where,
        orderBy: { name: 'asc' },
        take: EXPORT_ROW_CAP + 1,
      });
      const truncated = rows.length > EXPORT_ROW_CAP;
      if (truncated) {
        this.logger.warn(
          `Products export truncated at ${EXPORT_ROW_CAP} rows for org ${orgId}`,
        );
      }
      return { rows: truncated ? rows.slice(0, EXPORT_ROW_CAP) : rows, truncated };
    });
  }

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

    return this.prisma.withOrganization(orgId, async (tx) => {
      const [data, total] = await Promise.all([
        tx.product.findMany({
          where,
          skip,
          take: limit,
          orderBy: { name: 'asc' },
        }),
        tx.product.count({ where }),
      ]);
      return { data, total, page, limit, totalPages: Math.ceil(total / limit) };
    });
  }

  async findOne(orgId: string, id: string) {
    return this.prisma.withOrganization(orgId, async (tx) => {
      const product = await tx.product.findFirst({
        where: { id, organizationId: orgId },
      });
      if (!product) throw new NotFoundException('Product not found');
      return product;
    });
  }

  async create(orgId: string, dto: CreateProductDto) {
    return this.prisma.withOrganization(orgId, async (tx) => {
      return tx.product.create({
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

    return this.prisma.withOrganization(orgId, async (tx) => {
      return tx.product.update({ where: { id }, data });
    });
  }

  async delete(orgId: string, id: string) {
    await this.findOne(orgId, id);
    await this.prisma.withOrganization(orgId, async (tx) => {
      await tx.product.delete({ where: { id } });
    });
  }

  /**
   * Adjust stock (manual / correction / return / purchase).
   * Atomically updates product.stockQuantity and writes a StockMovement row.
   *
   * Rules:
   *  - product must have trackInventory = true, otherwise BadRequest.
   *  - negative balance is rejected unless reason is 'correction'.
   */
  async adjustStock(
    orgId: string,
    id: string,
    delta: number,
    reason: StockMovementReason | string,
    userId?: string,
    note?: string,
    opts?: { invoiceId?: string; creditNoteId?: string },
  ) {
    if (!Number.isFinite(delta) || delta === 0) {
      throw new BadRequestException('delta must be a non-zero integer');
    }
    const normalisedDelta = Math.trunc(delta);

    return this.prisma.withOrganization(orgId, async (tx) => {
      const product = await tx.product.findFirst({
        where: { id, organizationId: orgId },
      });
      if (!product) throw new NotFoundException('Product not found');
      if (!product.trackInventory) {
        throw new BadRequestException(
          'Product does not track inventory',
        );
      }

      const nextBalance = product.stockQuantity + normalisedDelta;
      if (nextBalance < 0 && reason !== 'correction') {
        throw new BadRequestException(
          `Stock would go negative (${nextBalance}). Use reason 'correction' to force.`,
        );
      }

      const updated = await tx.product.update({
        where: { id },
        data: { stockQuantity: nextBalance },
      });

      const movement = await tx.stockMovement.create({
        data: {
          organizationId: orgId,
          productId: id,
          delta: normalisedDelta,
          balanceAfter: nextBalance,
          reason,
          invoiceId: opts?.invoiceId ?? null,
          creditNoteId: opts?.creditNoteId ?? null,
          userId: userId ?? null,
          note: note ?? null,
        },
      });

      return { product: updated, movement };
    });
  }

  async getMovements(
    orgId: string,
    productId: string,
    query: { page?: number; limit?: number } = {},
  ) {
    const { page = 1, limit = 20 } = query;
    const skip = (page - 1) * limit;

    return this.prisma.withOrganization(orgId, async (tx) => {
      // Confirm product belongs to org
      const exists = await tx.product.findFirst({
        where: { id: productId, organizationId: orgId },
        select: { id: true },
      });
      if (!exists) throw new NotFoundException('Product not found');

      const [data, total] = await Promise.all([
        tx.stockMovement.findMany({
          where: { organizationId: orgId, productId },
          orderBy: { createdAt: 'desc' },
          skip,
          take: limit,
        }),
        tx.stockMovement.count({
          where: { organizationId: orgId, productId },
        }),
      ]);

      return { data, total, page, limit, totalPages: Math.ceil(total / limit) };
    });
  }

  async getLowStock(orgId: string) {
    // Prisma cannot compare two columns natively; use raw SQL
    return this.prisma.withOrganization(orgId, async (tx) => {
      return tx.$queryRaw`
        SELECT * FROM "products"
        WHERE "organizationId" = ${orgId}
          AND "trackInventory" = true
          AND "active" = true
          AND "stockQuantity" <= "lowStockAlert"
        ORDER BY "stockQuantity" ASC
      `;
    });
  }

  async getLowStockProducts(orgId: string) {
    return this.getLowStock(orgId);
  }

  async search(orgId: string, query: string) {
    return this.prisma.withOrganization(orgId, async (tx) => {
      return tx.product.findMany({
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
    });
  }

  // ──────────────────────────────────────────────────────────────
  //  Integration: auto-decrement stock when an invoice is sent.
  //  Prefers the InvoiceItem.productId FK (added in migration 004);
  //  falls back to case-insensitive description matching for legacy
  //  invoice lines that pre-date the FK.
  // ──────────────────────────────────────────────────────────────
  @OnEvent('invoice.sent')
  async onInvoiceSent(payload: {
    invoice: {
      id: string;
      organizationId: string;
      items?: Array<{ description: string; qty: any; productId?: string | null }>;
    } | null;
    orgId: string;
  }) {
    try {
      const invoice = payload?.invoice;
      const orgId = payload?.orgId ?? invoice?.organizationId;
      if (!invoice || !orgId || !invoice.items?.length) return;

      for (const item of invoice.items) {
        const qty = Number(item.qty ?? 0);
        if (!qty || qty <= 0) continue;

        let product: { id: string; trackInventory: boolean } | null = null;

        // 1) Preferred path — FK lookup. Reject products from other orgs
        //    defensively even though the FK should already enforce it.
        if (item.productId) {
          product = await this.prisma.product.findFirst({
            where: {
              id: item.productId,
              organizationId: orgId,
            },
            select: { id: true, trackInventory: true },
          });
        }

        // 2) Transitional fallback — match by case-insensitive description.
        //    Will go away once all in-flight invoices have been re-saved
        //    with the FK populated.
        if (!product) {
          const desc = (item.description ?? '').trim();
          if (!desc) continue;
          product = await this.prisma.product.findFirst({
            where: {
              organizationId: orgId,
              name: { equals: desc, mode: 'insensitive' },
            },
            select: { id: true, trackInventory: true },
          });
        }

        if (!product || !product.trackInventory) continue;

        try {
          await this.adjustStock(
            orgId,
            product.id,
            -Math.trunc(qty),
            'invoice_sent',
            undefined,
            `Auto-decrement from invoice ${invoice.id}`,
            { invoiceId: invoice.id },
          );
        } catch (err) {
          // Don't fail the whole event if one line item breaks (e.g. negative).
          this.logger.warn(
            `Stock auto-decrement skipped for product ${product.id}: ${(err as Error).message}`,
          );
        }
      }
    } catch (err) {
      this.logger.error(
        `onInvoiceSent stock hook failed: ${(err as Error).message}`,
      );
    }
  }
}
