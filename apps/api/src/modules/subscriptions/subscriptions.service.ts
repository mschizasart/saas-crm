import {
  Injectable,
  NotFoundException,
  BadRequestException,
  ServiceUnavailableException,
  Logger,
} from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { PrismaService } from '../../database/prisma.service';
import { EXPORT_ROW_CAP } from '../../common/csv/csv-writer';

export interface CreateSubscriptionDto {
  clientId: string;
  name: string;
  description?: string;
  unitPrice: number;
  quantity?: number;
  currency?: string;
  // Billing interval (new)
  interval?: 'day' | 'week' | 'month' | 'year';
  intervalCount?: number;
  nextInvoiceAt?: string; // ISO
  // Legacy / existing
  createdAt?: string;
  cancelledAt?: string;
}

export interface UpdateSubscriptionDto {
  name?: string;
  description?: string;
  unitPrice?: number;
  quantity?: number;
  currency?: string;
  status?: 'active' | 'paused' | 'cancelled';
  interval?: 'day' | 'week' | 'month' | 'year';
  intervalCount?: number;
  nextInvoiceAt?: string;
}

type IntervalUnit = 'day' | 'week' | 'month' | 'year';

const VALID_INTERVALS: IntervalUnit[] = ['day', 'week', 'month', 'year'];

function addInterval(
  from: Date,
  interval: IntervalUnit,
  count: number,
): Date {
  const d = new Date(from);
  const c = Math.max(1, Math.floor(count));
  switch (interval) {
    case 'day':
      d.setDate(d.getDate() + c);
      break;
    case 'week':
      d.setDate(d.getDate() + c * 7);
      break;
    case 'month':
      d.setMonth(d.getMonth() + c);
      break;
    case 'year':
      d.setFullYear(d.getFullYear() + c);
      break;
  }
  return d;
}

/**
 * If the underlying Postgres columns for the new interval fields haven't been
 * migrated yet, Prisma throws P2022 ("column does not exist"). We catch that
 * and surface it as 503 so the app keeps booting pre-migration.
 */
function isMissingColumnError(err: any): boolean {
  const msg = String(err?.message ?? '');
  return (
    err?.code === 'P2022' ||
    /column .*(interval|intervalCount|nextInvoiceAt).*/i.test(msg) ||
    /Unknown arg `(interval|intervalCount|nextInvoiceAt)/i.test(msg)
  );
}

@Injectable()
export class SubscriptionsService {
  private readonly logger = new Logger(SubscriptionsService.name);

  constructor(
    private prisma: PrismaService,
    private events: EventEmitter2,
  ) {}

  // ─── Export ────────────────────────────────────────────────
  async findAllForExport(
    orgId: string,
    query: { status?: string; clientId?: string } = {},
  ): Promise<{ rows: any[]; truncated: boolean }> {
    return this.prisma.withOrganization(orgId, async (tx) => {
      const where: any = { organizationId: orgId };
      if (query.status) where.status = query.status;
      if (query.clientId) where.clientId = query.clientId;

      const rows = await tx.clientSubscription.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        take: EXPORT_ROW_CAP + 1,
        include: {
          client: { select: { company: true } },
        },
      });

      const truncated = rows.length > EXPORT_ROW_CAP;
      if (truncated) {
        this.logger.warn(
          `Subscriptions export truncated at ${EXPORT_ROW_CAP} rows for org ${orgId}`,
        );
      }
      return { rows: truncated ? rows.slice(0, EXPORT_ROW_CAP) : rows, truncated };
    });
  }

  // ─── List / Detail ────────────────────────────────────────

  async findAll(
    orgId: string,
    query: { status?: string; clientId?: string } = {},
  ) {
    return this.prisma.withOrganization(orgId, async (tx) => {
      const where: any = { organizationId: orgId };
      if (query.status) where.status = query.status;
      if (query.clientId) where.clientId = query.clientId;
      const data = await tx.clientSubscription.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        include: {
          client: { select: { id: true, company: true } },
        },
      });
      return { data, meta: { total: data.length } };
    });
  }

  async findOne(orgId: string, id: string) {
    return this.prisma.withOrganization(orgId, async (tx) => {
      const sub = await tx.clientSubscription.findFirst({
        where: { id, organizationId: orgId },
        include: { client: { select: { id: true, company: true } } },
      });
      if (!sub) throw new NotFoundException('Subscription not found');
      return sub;
    });
  }

  // ─── Create / Update / Status ─────────────────────────────

  async create(orgId: string, dto: CreateSubscriptionDto) {
    if (!dto.clientId) throw new BadRequestException('clientId is required');
    if (!dto.name) throw new BadRequestException('name is required');
    if (dto.unitPrice === undefined || dto.unitPrice === null) {
      throw new BadRequestException('unitPrice is required');
    }

    const interval: IntervalUnit = VALID_INTERVALS.includes(
      dto.interval as IntervalUnit,
    )
      ? (dto.interval as IntervalUnit)
      : 'month';
    const intervalCount = Math.max(1, Math.floor(dto.intervalCount ?? 1));
    const quantity = Math.max(1, Math.floor(dto.quantity ?? 1));
    const total = Number(dto.unitPrice) * quantity;

    const nextInvoiceAt = dto.nextInvoiceAt
      ? new Date(dto.nextInvoiceAt)
      : addInterval(new Date(), interval, intervalCount);

    const baseData: any = {
      organizationId: orgId,
      clientId: dto.clientId,
      name: dto.name,
      description: dto.description ?? null,
      unitPrice: dto.unitPrice,
      quantity,
      total,
      status: 'active',
      nextDueDate: nextInvoiceAt,
    };

    try {
      return await this.prisma.withOrganization(orgId, async (tx) => {
        return tx.clientSubscription.create({
          data: {
            ...baseData,
            interval,
            intervalCount,
            nextInvoiceAt,
          } as any,
        });
      });
    } catch (err) {
      if (isMissingColumnError(err)) {
        this.logger.warn(
          'ClientSubscription.interval columns missing — run pending ALTER TABLE.',
        );
        throw new ServiceUnavailableException(
          'Subscription interval columns not yet migrated.',
        );
      }
      throw err;
    }
  }

  async update(orgId: string, id: string, dto: UpdateSubscriptionDto) {
    await this.findOne(orgId, id);

    const data: any = {};
    if (dto.name !== undefined) data.name = dto.name;
    if (dto.description !== undefined) data.description = dto.description;
    if (dto.unitPrice !== undefined) data.unitPrice = dto.unitPrice;
    if (dto.quantity !== undefined) data.quantity = dto.quantity;
    if (dto.status !== undefined) data.status = dto.status;
    if (
      dto.interval !== undefined &&
      VALID_INTERVALS.includes(dto.interval as IntervalUnit)
    ) {
      data.interval = dto.interval;
    }
    if (dto.intervalCount !== undefined) {
      data.intervalCount = Math.max(1, Math.floor(dto.intervalCount));
    }
    if (dto.nextInvoiceAt !== undefined) {
      data.nextInvoiceAt = dto.nextInvoiceAt
        ? new Date(dto.nextInvoiceAt)
        : null;
      data.nextDueDate = data.nextInvoiceAt;
    }

    try {
      return await this.prisma.withOrganization(orgId, async (tx) => {
        return tx.clientSubscription.update({
          where: { id },
          data,
        });
      });
    } catch (err) {
      if (isMissingColumnError(err)) {
        throw new ServiceUnavailableException(
          'Subscription interval columns not yet migrated.',
        );
      }
      throw err;
    }
  }

  async pause(orgId: string, id: string) {
    return this.update(orgId, id, { status: 'paused' });
  }
  async resume(orgId: string, id: string) {
    return this.update(orgId, id, { status: 'active' });
  }
  async cancel(orgId: string, id: string) {
    await this.findOne(orgId, id);
    return this.prisma.withOrganization(orgId, async (tx) => {
      return tx.clientSubscription.update({
        where: { id },
        data: { status: 'cancelled', cancelledAt: new Date() },
      });
    });
  }

  /**
   * Scheduled job — run by `SubscriptionsScheduler` every N hours. Finds
   * subscriptions whose `nextInvoiceAt <= now`, creates a draft Invoice for
   * each one (with a single line item), advances `nextInvoiceAt`, and emits
   * a `subscription.invoiced` event.
   *
   * Subscriptions in status `paused` or `cancelled` are skipped (logged, not
   * thrown). Each subscription is processed in its own try/catch so one bad
   * row doesn't stop the rest.
   */
  async runDueBilling() {
    const now = new Date();
    let due: any[] = [];
    try {
      due = await (this.prisma as any).clientSubscription.findMany({
        where: {
          nextInvoiceAt: { lte: now },
        } as any,
      });
    } catch (err) {
      if (isMissingColumnError(err)) {
        this.logger.warn(
          'Skipping subscription billing run — nextInvoiceAt column missing.',
        );
        return { processed: 0, skipped: true };
      }
      throw err;
    }

    let processed = 0;
    for (const sub of due) {
      try {
        if (sub.status === 'paused' || sub.status === 'cancelled') {
          this.logger.log(
            `[subscription ${sub.id}] skipped — status=${sub.status}`,
          );
          continue;
        }

        const invoice = await this.generateInvoiceForSubscription(sub, now);

        // Advance nextInvoiceAt to next cycle
        const interval = (sub.interval ?? 'month') as IntervalUnit;
        const count = Number(sub.intervalCount ?? 1);
        const nextAt = addInterval(
          sub.nextInvoiceAt ?? now,
          interval,
          count,
        );
        await (this.prisma as any).clientSubscription.update({
          where: { id: sub.id },
          data: { nextInvoiceAt: nextAt, nextDueDate: nextAt } as any,
        });

        this.events.emit('subscription.invoiced', { subscription: sub, invoice });
        this.logger.log(
          `[subscription ${sub.id}] invoiced ${invoice.number}; next -> ${nextAt.toISOString()}`,
        );
        processed += 1;
      } catch (err) {
        this.logger.error(
          `Failed to process subscription ${sub.id}: ${(err as Error).message}`,
        );
      }
    }

    return { processed };
  }

  /**
   * Creates a draft invoice with a single line item for the given
   * subscription. Totals: subTotal = qty * rate, totalTax = 0 (no tax column
   * on ClientSubscription yet), total = subTotal.
   *
   * Due date defaults to `date + 14 days`. No org-level `dueNet` setting
   * exists in the schema today; extend here if one is added.
   */
  private async generateInvoiceForSubscription(sub: any, now: Date) {
    const orgId: string = sub.organizationId;
    const qty = Number(sub.quantity ?? 1);
    const rate = Number(sub.unitPrice ?? 0);
    const subTotal = qty * rate;
    const totalTax = 0;
    const total = subTotal + totalTax;

    const date = new Date(now);
    const dueDate = new Date(now);
    dueDate.setDate(dueDate.getDate() + 14);

    // Resolve client for currency
    const client = await (this.prisma as any).client.findFirst({
      where: { id: sub.clientId, organizationId: orgId },
      select: { id: true, currencyId: true },
    });

    return this.prisma.withOrganization(orgId, async (tx: any) => {
      const count = await tx.invoice.count({
        where: { organizationId: orgId },
      });
      const number = `INV-${String(count + 1).padStart(4, '0')}`;

      return tx.invoice.create({
        data: {
          organizationId: orgId,
          clientId: sub.clientId,
          currencyId: client?.currencyId ?? null,
          number,
          status: 'draft',
          date,
          dueDate,
          subTotal,
          totalTax,
          total,
          adminNote: `Auto-generated from subscription ${sub.id}`,
          items: {
            createMany: {
              data: [
                {
                  description: sub.name,
                  qty,
                  rate,
                  order: 0,
                },
              ],
            },
          },
        },
        include: { items: true },
      });
    });
  }
}
