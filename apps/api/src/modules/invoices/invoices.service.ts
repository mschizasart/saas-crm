import {
  Injectable,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { ActivityLogService } from '../activity-log/activity-log.service';

export interface CreateInvoiceDto {
  clientId: string;
  number?: string;
  date: string; // ISO date
  dueDate?: string;
  currencyId?: string;
  currency?: string;
  notes?: string;
  clientNote?: string;
  adminNote?: string;
  terms?: string;
  discount?: number;
  discountType?: string;
  status?: string;
  // New Perfex-style fields
  tags?: string;
  saleAgentId?: string;
  allowedPaymentModes?: string[];
  preventOverdueReminders?: boolean;
  // Recurring
  recurring?: boolean;
  recurringFrequency?: string;
  isRecurring?: boolean;
  recurringEvery?: number;
  recurringType?: string;
  totalCycles?: number;
  items: Array<{
    description: string;
    longDescription?: string;
    quantity?: number;
    unitPrice?: number;
    qty?: number;
    rate?: number;
    taxRate?: number;
    tax1?: string;
    tax2?: string;
    unit?: string;
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
    private activityLog: ActivityLogService,
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
      const number = dto.number || (await this.generateInvoiceNumber(orgId, tx));

      // Normalize items: support both old (quantity/unitPrice/taxRate) and new (qty/rate/tax1) field names
      const normalizedItems = dto.items.map((item) => ({
        qty: item.qty ?? item.quantity ?? 0,
        rate: item.rate ?? item.unitPrice ?? 0,
        description: item.description,
        longDescription: item.longDescription ?? undefined,
        tax1: item.tax1 ?? undefined,
        tax2: item.tax2 ?? undefined,
        taxRate: item.taxRate ?? 0,
        unit: item.unit ?? undefined,
        order: item.order,
      }));

      const totals = this.calculateTotals(
        normalizedItems.map((i) => ({
          quantity: i.qty,
          unitPrice: i.rate,
          taxRate: i.taxRate,
        })),
        dto.discount ?? 0,
      );

      const invoiceData: any = {
        organizationId: orgId,
        clientId: dto.clientId,
        number,
        date: new Date(dto.date),
        dueDate: dto.dueDate ? new Date(dto.dueDate) : null,
        status: dto.status ?? 'draft',
        subTotal: totals.subtotal,
        totalTax: totals.tax,
        discount: totals.discount,
        discountType: dto.discountType ?? 'fixed',
        total: totals.total,
        clientNote: dto.clientNote ?? dto.notes ?? null,
        adminNote: dto.adminNote ?? null,
        terms: dto.terms ?? null,
        currency: dto.currency ?? 'USD',
        currencyId: dto.currencyId ?? null,
        // Recurring fields
        isRecurring: dto.isRecurring ?? dto.recurring ?? false,
        recurringEvery: dto.recurringEvery ?? null,
        recurringType: dto.recurringType ?? dto.recurringFrequency ?? null,
        totalCycles: dto.totalCycles ?? null,
        // Payment modes
        allowedPaymentModes: dto.allowedPaymentModes ?? [],
        createdBy,
      };

      // Add saleAgentId if provided (field may not exist in schema yet)
      if (dto.saleAgentId) {
        (invoiceData as any).saleAgentId = dto.saleAgentId;
      }
      // Add preventOverdueReminders if provided (field may not exist in schema yet)
      if (dto.preventOverdueReminders !== undefined) {
        (invoiceData as any).preventOverdueReminders = dto.preventOverdueReminders;
      }

      const created = await tx.invoice.create({
        data: {
          ...invoiceData,
          items: {
            createMany: {
              data: normalizedItems.map((item, index) => ({
                description: item.description,
                longDesc: item.longDescription ?? null,
                qty: item.qty,
                rate: item.rate,
                tax1: item.tax1 ?? null,
                tax2: item.tax2 ?? null,
                unit: item.unit ?? null,
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

  async update(orgId: string, id: string, dto: Partial<CreateInvoiceDto>, userId?: string) {
    const existing = await this.findOne(orgId, id);
    if (existing.status !== 'draft') {
      throw new BadRequestException(
        'Only draft invoices can be edited',
      );
    }

    return this.prisma.withOrganization(orgId, async (tx) => {
      // Normalize items for totals calculation (support both old and new field names)
      const rawItems = dto.items ?? existing.items.map((i: any) => ({
        description: i.description,
        qty: Number(i.qty ?? i.quantity ?? 0),
        rate: Number(i.rate ?? i.unitPrice ?? 0),
        taxRate: Number(i.taxRate ?? 0),
        tax1: i.tax1,
        tax2: i.tax2,
        longDescription: i.longDesc ?? i.longDescription,
        unit: i.unit,
        order: i.order,
      }));

      const normalizedForCalc = rawItems.map((i: any) => ({
        quantity: i.qty ?? i.quantity ?? 0,
        unitPrice: i.rate ?? i.unitPrice ?? 0,
        taxRate: i.taxRate ?? 0,
      }));

      const totals = this.calculateTotals(
        normalizedForCalc,
        dto.discount ?? Number(existing.discount),
      );

      if (dto.items) {
        await tx.invoiceItem.deleteMany({ where: { invoiceId: id } });
        await tx.invoiceItem.createMany({
          data: dto.items.map((item, index) => ({
            invoiceId: id,
            description: item.description,
            longDesc: item.longDescription ?? null,
            qty: item.qty ?? item.quantity ?? 0,
            rate: item.rate ?? item.unitPrice ?? 0,
            tax1: item.tax1 ?? null,
            tax2: item.tax2 ?? null,
            unit: item.unit ?? null,
            order: item.order ?? index,
          })),
        });
      }

      const updateData: any = {
        ...(dto.clientId && { clientId: dto.clientId }),
        ...(dto.date && { date: new Date(dto.date) }),
        ...(dto.dueDate !== undefined && {
          dueDate: dto.dueDate ? new Date(dto.dueDate) : null,
        }),
        ...(dto.clientNote !== undefined && { clientNote: dto.clientNote }),
        ...(dto.adminNote !== undefined && { adminNote: dto.adminNote }),
        ...(dto.terms !== undefined && { terms: dto.terms }),
        ...(dto.discountType && { discountType: dto.discountType }),
        ...(dto.currencyId !== undefined && { currencyId: dto.currencyId }),
        ...(dto.isRecurring !== undefined && { isRecurring: dto.isRecurring }),
        ...(dto.recurringEvery !== undefined && { recurringEvery: dto.recurringEvery }),
        ...(dto.recurringType !== undefined && { recurringType: dto.recurringType }),
        ...(dto.totalCycles !== undefined && { totalCycles: dto.totalCycles }),
        ...(dto.allowedPaymentModes && { allowedPaymentModes: dto.allowedPaymentModes }),
        subTotal: totals.subtotal,
        totalTax: totals.tax,
        discount: totals.discount,
        total: totals.total,
      };

      // Fields that may not exist in schema yet
      if (dto.saleAgentId !== undefined) {
        (updateData as any).saleAgentId = dto.saleAgentId;
      }
      if (dto.preventOverdueReminders !== undefined) {
        (updateData as any).preventOverdueReminders = dto.preventOverdueReminders;
      }

      const updated = await tx.invoice.update({
        where: { id },
        data: updateData,
        include: {
          client: { select: { id: true, company: true } },
          items: { orderBy: { order: 'asc' } },
        },
      });

      // Log field-level changes
      if (userId) {
        const trackableFields: Record<string, any> = {};
        if (dto.clientId) trackableFields.clientId = dto.clientId;
        if (dto.date) trackableFields.date = dto.date;
        if (dto.dueDate !== undefined) trackableFields.dueDate = dto.dueDate;
        if (dto.notes !== undefined) trackableFields.notes = dto.notes;
        if (dto.currency) trackableFields.currency = dto.currency;
        if (dto.discount !== undefined) trackableFields.discount = dto.discount;

        await this.activityLog.logEntityUpdate(
          orgId,
          userId,
          'invoice',
          id,
          existing,
          trackableFields,
        );
      }

      return updated;
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
          subTotal: (source as any).subTotal ?? (source as any).subtotal ?? 0,
          totalTax: (source as any).totalTax ?? (source as any).tax ?? 0,
          discount: source.discount,
          discountType: (source as any).discountType ?? 'fixed',
          total: source.total,
          clientNote: (source as any).clientNote ?? (source as any).notes ?? null,
          adminNote: (source as any).adminNote ?? null,
          terms: source.terms,
          currencyId: source.currencyId,
          isRecurring: (source as any).isRecurring ?? false,
          recurringEvery: (source as any).recurringEvery ?? null,
          recurringType: (source as any).recurringType ?? null,
          totalCycles: (source as any).totalCycles ?? null,
          allowedPaymentModes: (source as any).allowedPaymentModes ?? [],
          createdBy,
          items: {
            createMany: {
              data: (source.items as any[]).map((item) => ({
                description: item.description,
                longDesc: item.longDesc ?? null,
                qty: item.qty ?? item.quantity ?? 0,
                rate: item.rate ?? item.unitPrice ?? 0,
                tax1: item.tax1 ?? null,
                tax2: item.tax2 ?? null,
                unit: item.unit ?? null,
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

  // ─── cloneToEstimate ───────────────────────────────────────────────────────

  async cloneToEstimate(orgId: string, id: string, createdBy: string) {
    const source = await this.findOne(orgId, id);

    const estimate = await this.prisma.withOrganization(orgId, async (tx) => {
      const count = await tx.estimate.count({ where: { organizationId: orgId } });
      const number = `EST-${String(count + 1).padStart(4, '0')}`;

      let subtotal = 0;
      let tax = 0;
      const discount = Number(source.discount ?? 0);

      for (const item of source.items as any[]) {
        const lineTotal = Number(item.qty ?? item.quantity ?? 0) * Number(item.rate ?? item.unitPrice ?? 0);
        const lineTax = lineTotal * (Number(item.taxRate ?? 0) / 100);
        subtotal += lineTotal;
        tax += lineTax;
      }

      const total = subtotal + tax - discount;

      return tx.estimate.create({
        data: {
          organizationId: orgId,
          clientId: source.clientId ?? null,
          number,
          date: new Date(),
          expiryDate: null,
          status: 'draft',
          subTotal: subtotal,
          totalTax: tax,
          discount,
          total,
          clientNote: (source as any).clientNote ?? null,
          adminNote: (source as any).adminNote ?? null,
          terms: source.terms ?? null,
          currencyId: source.currencyId ?? null,
          createdBy,
          items: {
            createMany: {
              data: (source.items as any[]).map((item: any) => ({
                description: item.description,
                longDesc: item.longDesc ?? null,
                qty: Number(item.qty ?? item.quantity ?? 0),
                rate: Number(item.rate ?? item.unitPrice ?? 0),
                tax1: item.tax1 ?? null,
                tax2: item.tax2 ?? null,
                unit: item.unit ?? null,
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

    this.events.emit('estimate.created', {
      estimate,
      orgId,
      createdBy,
      clonedFromInvoice: id,
    });

    return estimate;
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
