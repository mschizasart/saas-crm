import {
  Injectable,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service';
import { EventEmitter2 } from '@nestjs/event-emitter';

export interface CreateInvoiceDto {
  clientId: string;
  date: string; // ISO date
  dueDate?: string;
  currencyId?: string;
  currency?: string;
  notes?: string;
  terms?: string;
  discount?: number;
  recurring?: boolean;
  recurringFrequency?: string;
  items: Array<{
    description: string;
    quantity: number;
    unitPrice: number;
    taxRate?: number;
    order?: number;
  }>;
}

// ─── Status transition map ──────────────────────────────────────────────────
const ALLOWED_TRANSITIONS: Record<string, string[]> = {
  draft: ['sent', 'cancelled'],
  sent: ['viewed', 'partial', 'paid', 'overdue', 'cancelled'],
  viewed: ['partial', 'paid', 'overdue', 'cancelled'],
  partial: ['paid', 'overdue', 'cancelled'],
  overdue: ['partial', 'paid', 'cancelled'],
  paid: [],
  cancelled: [],
};

@Injectable()
export class InvoicesService {
  constructor(
    private prisma: PrismaService,
    private events: EventEmitter2,
  ) {}

  // ─── Private helpers ───────────────────────────────────────────────────────

  private async generateInvoiceNumber(
    orgId: string,
    tx: any,
  ): Promise<string> {
    const count = await tx.invoice.count({
      where: { organizationId: orgId },
    });
    return `INV-${String(count + 1).padStart(4, '0')}`;
  }

  private calculateTotals(
    items: Array<{
      quantity: number;
      unitPrice: number;
      taxRate?: number;
    }>,
    discount = 0,
  ): { subtotal: number; tax: number; discount: number; total: number } {
    let subtotal = 0;
    let tax = 0;

    for (const item of items) {
      const lineTotal = item.quantity * item.unitPrice;
      const lineTax = lineTotal * ((item.taxRate ?? 0) / 100);
      subtotal += lineTotal;
      tax += lineTax;
    }

    const total = subtotal + tax - discount;
    return { subtotal, tax, discount, total };
  }

  // ─── findAll ───────────────────────────────────────────────────────────────

  async findAll(
    orgId: string,
    query: {
      search?: string;
      status?: string;
      clientId?: string;
      page?: number;
      limit?: number;
    },
  ) {
    const { search, status, clientId, page = 1, limit = 20 } = query;
    const skip = (page - 1) * limit;

    return this.prisma.withOrganization(orgId, async (tx) => {
      const where: any = { organizationId: orgId };
      if (status) where.status = status;
      if (clientId) where.clientId = clientId;
      if (search) {
        where.OR = [
          { number: { contains: search, mode: 'insensitive' } },
          { client: { company: { contains: search, mode: 'insensitive' } } },
        ];
      }

      const [data, total] = await Promise.all([
        tx.invoice.findMany({
          where,
          skip,
          take: limit,
          orderBy: { createdAt: 'desc' },
          include: {
            client: { select: { id: true, company: true } },
            _count: { select: { payments: true } },
          },
        }),
        tx.invoice.count({ where }),
      ]);

      return { data, total, page, limit, totalPages: Math.ceil(total / limit) };
    });
  }

  // ─── findOne ───────────────────────────────────────────────────────────────

  async findOne(orgId: string, id: string) {
    return this.prisma.withOrganization(orgId, async (tx) => {
      const invoice = await tx.invoice.findFirst({
        where: { id, organizationId: orgId },
        include: {
          client: true,
          items: { orderBy: { order: 'asc' } },
          payments: { orderBy: { paymentDate: 'desc' } },
        },
      });
      if (!invoice) throw new NotFoundException('Invoice not found');
      return invoice;
    });
  }

  // ─── create ────────────────────────────────────────────────────────────────

  async create(orgId: string, dto: CreateInvoiceDto, createdBy: string) {
    const invoice = await this.prisma.withOrganization(orgId, async (tx) => {
      const number = await this.generateInvoiceNumber(orgId, tx);
      const totals = this.calculateTotals(dto.items, dto.discount ?? 0);

      const created = await tx.invoice.create({
        data: {
          organizationId: orgId,
          clientId: dto.clientId,
          number,
          date: new Date(dto.date),
          dueDate: dto.dueDate ? new Date(dto.dueDate) : null,
          status: 'draft',
          subtotal: totals.subtotal,
          tax: totals.tax,
          discount: totals.discount,
          total: totals.total,
          notes: dto.notes ?? null,
          terms: dto.terms ?? null,
          currency: dto.currency ?? 'USD',
          currencyId: dto.currencyId ?? null,
          recurring: dto.recurring ?? false,
          recurringFrequency: dto.recurringFrequency ?? null,
          createdBy,
          items: {
            createMany: {
              data: dto.items.map((item, index) => ({
                description: item.description,
                quantity: item.quantity,
                unitPrice: item.unitPrice,
                taxRate: item.taxRate ?? 0,
                total: item.quantity * item.unitPrice,
                order: item.order ?? index,
              })),
            },
          },
        },
      });

      // Re-fetch with client.contacts populated so event listeners (email) can use them
      return tx.invoice.findUnique({
        where: { id: created.id },
        include: {
          client: {
            include: {
              contacts: {
                where: { type: 'contact', active: true },
                take: 5,
              },
            },
          },
          organization: { select: { id: true, name: true } },
          items: { orderBy: { order: 'asc' } },
        },
      });
    });

    this.events.emit('invoice.created', { invoice, orgId, createdBy });
    return invoice;
  }

  // ─── update ────────────────────────────────────────────────────────────────

  async update(orgId: string, id: string, dto: Partial<CreateInvoiceDto>) {
    const existing = await this.findOne(orgId, id);
    if (existing.status !== 'draft') {
      throw new BadRequestException(
        'Only draft invoices can be edited',
      );
    }

    return this.prisma.withOrganization(orgId, async (tx) => {
      const items = dto.items ?? existing.items.map((i: any) => ({
        description: i.description,
        quantity: Number(i.quantity),
        unitPrice: Number(i.unitPrice),
        taxRate: Number(i.taxRate),
        order: i.order,
      }));

      const totals = this.calculateTotals(
        items,
        dto.discount ?? Number(existing.discount),
      );

      if (dto.items) {
        await tx.invoiceItem.deleteMany({ where: { invoiceId: id } });
        await tx.invoiceItem.createMany({
          data: dto.items.map((item, index) => ({
            invoiceId: id,
            description: item.description,
            quantity: item.quantity,
            unitPrice: item.unitPrice,
            taxRate: item.taxRate ?? 0,
            total: item.quantity * item.unitPrice,
            order: item.order ?? index,
          })),
        });
      }

      return tx.invoice.update({
        where: { id },
        data: {
          ...(dto.clientId && { clientId: dto.clientId }),
          ...(dto.date && { date: new Date(dto.date) }),
          ...(dto.dueDate !== undefined && {
            dueDate: dto.dueDate ? new Date(dto.dueDate) : null,
          }),
          ...(dto.notes !== undefined && { notes: dto.notes }),
          ...(dto.terms !== undefined && { terms: dto.terms }),
          ...(dto.currency && { currency: dto.currency }),
          ...(dto.currencyId !== undefined && { currencyId: dto.currencyId }),
          ...(dto.recurring !== undefined && { recurring: dto.recurring }),
          ...(dto.recurringFrequency !== undefined && {
            recurringFrequency: dto.recurringFrequency,
          }),
          subtotal: totals.subtotal,
          tax: totals.tax,
          discount: totals.discount,
          total: totals.total,
        },
        include: {
          client: { select: { id: true, company: true } },
          items: { orderBy: { order: 'asc' } },
        },
      });
    });
  }

  // ─── delete ────────────────────────────────────────────────────────────────

  async delete(orgId: string, id: string) {
    const invoice = await this.findOne(orgId, id);
    if (invoice.status !== 'draft') {
      throw new BadRequestException('Only draft invoices can be deleted');
    }
    await this.prisma.withOrganization(orgId, async (tx) => {
      await tx.invoiceItem.deleteMany({ where: { invoiceId: id } });
      await tx.invoice.delete({ where: { id } });
    });
    this.events.emit('invoice.deleted', { id, orgId });
  }

  // ─── updateStatus ──────────────────────────────────────────────────────────

  async updateStatus(orgId: string, id: string, status: string) {
    const invoice = await this.findOne(orgId, id);
    const allowed = ALLOWED_TRANSITIONS[invoice.status] ?? [];
    if (!allowed.includes(status)) {
      throw new BadRequestException(
        `Cannot transition invoice from '${invoice.status}' to '${status}'`,
      );
    }

    const updated = await this.prisma.withOrganization(orgId, async (tx) => {
      return tx.invoice.update({ where: { id }, data: { status } });
    });

    this.events.emit('invoice.status_changed', {
      invoice: updated,
      orgId,
      previousStatus: invoice.status,
      newStatus: status,
    });

    return updated;
  }

  // ─── send ──────────────────────────────────────────────────────────────────

  async send(orgId: string, id: string) {
    const invoice = await this.findOne(orgId, id);
    if (!ALLOWED_TRANSITIONS[invoice.status]?.includes('sent')) {
      throw new BadRequestException(
        `Invoice with status '${invoice.status}' cannot be sent`,
      );
    }

    const updated = await this.prisma.withOrganization(orgId, async (tx) => {
      await tx.invoice.update({ where: { id }, data: { status: 'sent' } });
      return tx.invoice.findUnique({
        where: { id },
        include: {
          client: {
            include: {
              contacts: {
                where: { type: 'contact', active: true },
                take: 5,
              },
            },
          },
          organization: { select: { id: true, name: true } },
          items: { orderBy: { order: 'asc' } },
        },
      });
    });

    this.events.emit('invoice.sent', { invoice: updated, orgId });
    return updated;
  }

  // ─── markPaid ─────────────────────────────────────────────────────────────

  async markPaid(orgId: string, id: string) {
    await this.findOne(orgId, id);
    return this.prisma.withOrganization(orgId, async (tx) => {
      return tx.invoice.update({ where: { id }, data: { status: 'paid' } });
    });
  }

  // ─── duplicate ────────────────────────────────────────────────────────────

  async duplicate(orgId: string, id: string, createdBy: string) {
    const source = await this.findOne(orgId, id);

    const duplicate = await this.prisma.withOrganization(orgId, async (tx) => {
      const number = await this.generateInvoiceNumber(orgId, tx);

      return tx.invoice.create({
        data: {
          organizationId: orgId,
          clientId: source.clientId,
          number,
          date: new Date(),
          dueDate: null,
          status: 'draft',
          subtotal: source.subtotal,
          tax: source.tax,
          discount: source.discount,
          total: source.total,
          notes: source.notes,
          terms: source.terms,
          currency: source.currency,
          currencyId: source.currencyId,
          recurring: source.recurring,
          recurringFrequency: source.recurringFrequency,
          createdBy,
          items: {
            createMany: {
              data: (source.items as any[]).map((item) => ({
                description: item.description,
                quantity: item.quantity,
                unitPrice: item.unitPrice,
                taxRate: item.taxRate,
                total: item.total,
                order: item.order,
              })),
            },
          },
        },
        include: {
          client: { select: { id: true, company: true } },
          items: { orderBy: { order: 'asc' } },
        },
      });
    });

    this.events.emit('invoice.created', {
      invoice: duplicate,
      orgId,
      createdBy,
      duplicatedFrom: id,
    });

    return duplicate;
  }

  // ─── getOverdue ───────────────────────────────────────────────────────────

  async getOverdue(orgId: string): Promise<{ count: number }> {
    const now = new Date();

    const result = await this.prisma.withOrganization(orgId, async (tx) => {
      const overdueInvoices = await tx.invoice.findMany({
        where: {
          organizationId: orgId,
          status: { notIn: ['paid', 'cancelled'] },
          dueDate: { lt: now },
        },
        select: { id: true },
      });

      if (overdueInvoices.length === 0) return { count: 0 };

      const ids = overdueInvoices.map((i: any) => i.id);
      await tx.invoice.updateMany({
        where: { id: { in: ids } },
        data: { status: 'overdue' },
      });

      return { count: overdueInvoices.length };
    });

    return result;
  }

  // ─── getStats ─────────────────────────────────────────────────────────────

  async getStats(orgId: string) {
    return this.prisma.withOrganization(orgId, async (tx) => {
      const now = new Date();
      const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
      const endOfMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59, 999);

      const [outstanding, overdue, paidThisMonth, draftCount] =
        await Promise.all([
          // Total outstanding = sum of totals for non-paid/cancelled invoices
          tx.invoice.aggregate({
            where: {
              organizationId: orgId,
              status: { notIn: ['paid', 'cancelled'] },
            },
            _sum: { total: true },
          }),

          // Total overdue = sum of totals for overdue invoices
          tx.invoice.aggregate({
            where: {
              organizationId: orgId,
              status: 'overdue',
            },
            _sum: { total: true },
          }),

          // Total paid this month = sum of totals for invoices paid in current month
          tx.invoice.aggregate({
            where: {
              organizationId: orgId,
              status: 'paid',
              updatedAt: { gte: startOfMonth, lte: endOfMonth },
            },
            _sum: { total: true },
          }),

          // Count of draft invoices
          tx.invoice.count({
            where: {
              organizationId: orgId,
              status: 'draft',
            },
          }),
        ]);

      return {
        totalOutstanding: Number(outstanding._sum.total ?? 0),
        totalOverdue: Number(overdue._sum.total ?? 0),
        totalPaidThisMonth: Number(paidThisMonth._sum.total ?? 0),
        totalDraftCount: draftCount,
      };
    });
  }
}
