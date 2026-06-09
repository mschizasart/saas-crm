import {
  Injectable,
  BadRequestException,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service';
import {
  CreateBundleDto,
  UpdateBundleDto,
  BundleItemDto,
} from './cpq.dto';

/**
 * Product-bundle CRUD.
 *
 * Bundles are admin-curated "kits" of products that sales reps can drop onto
 * a Quote as a single line. Each bundle item carries its own quantity and
 * discount; the Quote uses the bundle's pre-computed price (with discounts)
 * to seed the line `unitPrice`.
 *
 * Tenant isolation: every query carries `organizationId` explicitly. Every
 * `productId` from user input is cross-tenant validated against the caller's
 * org BEFORE we open the write transaction so the failure mode is a clean
 * 400 — not a silent FK miss.
 *
 * Defense-in-depth: every `update` / `delete` includes `organizationId` in
 * the `where` clause so even an authenticated cross-tenant id won't escape.
 */
@Injectable()
export class ProductBundlesService {
  constructor(private prisma: PrismaService) {}

  // ─── Helpers ──────────────────────────────────────────────────

  /**
   * Validate that every productId on the item list belongs to the caller's
   * org. Done in a single query so we don't N+1; uses Set to dedupe.
   */
  private async assertProductsBelongToOrg(
    orgId: string,
    items: BundleItemDto[],
  ): Promise<void> {
    const ids = Array.from(
      new Set(items.map((i) => i.productId).filter(Boolean)),
    );
    if (ids.length === 0) {
      throw new BadRequestException('Bundle must contain at least one item');
    }
    const found = await this.prisma.product.findMany({
      where: { id: { in: ids }, organizationId: orgId },
      select: { id: true },
    });
    if (found.length !== ids.length) {
      throw new BadRequestException(
        'One or more products do not belong to your organization',
      );
    }
  }

  // ─── List ─────────────────────────────────────────────────────

  async list(
    orgId: string,
    query: { search?: string; active?: boolean; page?: number; limit?: number },
  ) {
    const { search, active, page = 1, limit = 20 } = query;
    const skip = (page - 1) * limit;

    return this.prisma.withOrganization(orgId, async (tx) => {
      const where: any = { organizationId: orgId };
      if (active !== undefined) where.active = active;
      if (search) {
        where.OR = [
          { name: { contains: search, mode: 'insensitive' } },
          { description: { contains: search, mode: 'insensitive' } },
        ];
      }

      const [data, total] = await Promise.all([
        tx.productBundle.findMany({
          where,
          skip,
          take: limit,
          orderBy: { createdAt: 'desc' },
          include: {
            _count: { select: { items: true } },
          },
        }),
        tx.productBundle.count({ where }),
      ]);

      return {
        data,
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit),
      };
    });
  }

  // ─── Find one ─────────────────────────────────────────────────

  async findOne(orgId: string, id: string) {
    return this.prisma.withOrganization(orgId, async (tx) => {
      const bundle = await tx.productBundle.findFirst({
        where: { id, organizationId: orgId },
        include: {
          items: {
            orderBy: { order: 'asc' },
            include: {
              product: {
                select: {
                  id: true,
                  name: true,
                  sku: true,
                  unitPrice: true,
                },
              },
            },
          },
        },
      });
      if (!bundle) throw new NotFoundException('Bundle not found');
      return bundle;
    });
  }

  // ─── Create ───────────────────────────────────────────────────

  async create(
    orgId: string,
    userId: string,
    dto: CreateBundleDto,
  ) {
    await this.assertProductsBelongToOrg(orgId, dto.items);

    return this.prisma.withOrganization(orgId, async (tx) => {
      const bundle = await tx.productBundle.create({
        data: {
          organizationId: orgId,
          name: dto.name,
          description: dto.description ?? null,
          createdById: userId,
          items: {
            createMany: {
              data: dto.items.map((it, idx) => ({
                organizationId: orgId,
                productId: it.productId,
                quantity: it.quantity,
                discountPercent: it.discountPercent ?? 0,
                order: it.order ?? idx,
              })),
            },
          },
        },
        include: { items: { orderBy: { order: 'asc' } } },
      });
      return bundle;
    });
  }

  // ─── Update ───────────────────────────────────────────────────

  async update(orgId: string, id: string, dto: UpdateBundleDto) {
    await this.findOne(orgId, id); // 404 + org-scope

    if (dto.items) {
      await this.assertProductsBelongToOrg(orgId, dto.items);
    }

    return this.prisma.withOrganization(orgId, async (tx) => {
      // Defense-in-depth: every write includes organizationId in `where`.
      const updated = await tx.productBundle.update({
        where: { id, organizationId: orgId },
        data: {
          ...(dto.name !== undefined && { name: dto.name }),
          ...(dto.description !== undefined && { description: dto.description }),
        },
      });

      // If items were provided, replace them wholesale inside the same
      // tx so an aborted request can't leave the bundle half-populated.
      if (dto.items) {
        await tx.bundleItem.deleteMany({
          where: { bundleId: id, organizationId: orgId },
        });
        await tx.bundleItem.createMany({
          data: dto.items.map((it, idx) => ({
            organizationId: orgId,
            bundleId: id,
            productId: it.productId,
            quantity: it.quantity,
            discountPercent: it.discountPercent ?? 0,
            order: it.order ?? idx,
          })),
        });
      }

      return tx.productBundle.findFirst({
        where: { id, organizationId: orgId },
        include: { items: { orderBy: { order: 'asc' } } },
      });
    });
  }

  // ─── Remove ───────────────────────────────────────────────────

  async remove(orgId: string, id: string) {
    await this.findOne(orgId, id);

    // Refuse delete if any DRAFT quote references this bundle. Sent /
    // accepted / rejected / expired quotes are fine: the FK is SET NULL on
    // delete and their lineTotal is already frozen, so deleting the bundle
    // definition won't disturb the historical record.
    const draftRef = await this.prisma.quoteLineItem.findFirst({
      where: {
        organizationId: orgId,
        bundleId: id,
        quote: { status: 'draft', organizationId: orgId },
      },
      select: { id: true },
    });
    if (draftRef) {
      throw new BadRequestException(
        'Bundle is referenced by one or more draft quotes — remove from those quotes first',
      );
    }

    await this.prisma.withOrganization(orgId, async (tx) => {
      await tx.productBundle.delete({
        where: { id, organizationId: orgId },
      });
    });
  }
}
