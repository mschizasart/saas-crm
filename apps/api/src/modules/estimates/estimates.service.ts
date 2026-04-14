import {
  Injectable,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service';
import { EventEmitter2 } from '@nestjs/event-emitter';

export interface CreateEstimateDto {
  clientId?: string;
  date: string;
  expiryDate?: string;
  currency?: string;
  notes?: string;
  terms?: string;
  discount?: number;
  items: Array<{
    description: string;
    quantity: number;
    unitPrice: number;
    taxRate?: number;
    order?: number;
  }>;
}

@Injectable()
export class EstimatesService {
  constructor(
    private prisma: PrismaService,
    private events: EventEmitter2,
  ) {}

  // ─── Private helpers ───────────────────────────────────────────────────────

  private async generateEstimateNumber(
    orgId: string,
    tx: any,
  ): Promise<string> {
    const count = await tx.estimate.count({
      where: { organizationId: orgId },
    });
    return `EST-${String(count + 1).padStart(4, '0')}`;
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
        tx.estimate.findMany({
          where,
          skip,
          take: limit,
          orderBy: { createdAt: 'desc' },
          include: {
            client: { select: { id: true, company: true } },
            _count: { select: { items: true } },
          },
        }),
        tx.estimate.count({ where }),
      ]);

      return { data, total, page, limit, totalPages: Math.ceil(total / limit) };
    });
  }

  // ─── findOne ───────────────────────────────────────────────────────────────

  async findOne(orgId: string, id: string) {
    return this.prisma.withOrganization(orgId, async (tx) => {
      const estimate = await tx.estimate.findFirst({
        where: { id, organizationId: orgId },
        include: {
          client: true,
          items: { orderBy: { order: 'asc' } },
          creator: { select: { id: true, firstName: true, lastName: true } },
        },
      });
      if (!estimate) throw new NotFoundException('Estimate not found');
      return estimate;
    });
  }

  // ─── create ────────────────────────────────────────────────────────────────

  async create(orgId: string, dto: CreateEstimateDto, createdBy: string) {
    const estimate = await this.prisma.withOrganization(orgId, async (tx) => {
      const number = await this.generateEstimateNumber(orgId, tx);
      const totals = this.calculateTotals(dto.items, dto.discount ?? 0);

      return tx.estimate.create({
        data: {
          organizationId: orgId,
          clientId: dto.clientId ?? null,
          number,
          date: new Date(dto.date),
          expiryDate: dto.expiryDate ? new Date(dto.expiryDate) : null,
          status: 'draft',
          subtotal: totals.subtotal,
          tax: totals.tax,
          discount: totals.discount,
          total: totals.total,
          notes: dto.notes ?? null,
          terms: dto.terms ?? null,
          currency: dto.currency ?? 'USD',
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
        include: {
          client: { select: { id: true, company: true } },
          items: { orderBy: { order: 'asc' } },
        },
      });
    });

    this.events.emit('estimate.created', { estimate, orgId, createdBy });
    return estimate;
  }

  // ─── update ────────────────────────────────────────────────────────────────

  async update(orgId: string, id: string, dto: Partial<CreateEstimateDto>) {
    const existing = await this.findOne(orgId, id);
    if (existing.status !== 'draft') {
      throw new BadRequestException('Only draft estimates can be edited');
    }

    return this.prisma.withOrganization(orgId, async (tx) => {
      const items = dto.items ?? (existing.items as any[]).map((i: any) => ({
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
        await tx.estimateItem.deleteMany({ where: { estimateId: id } });
        await tx.estimateItem.createMany({
          data: dto.items.map((item, index) => ({
            estimateId: id,
            description: item.description,
            quantity: item.quantity,
            unitPrice: item.unitPrice,
            taxRate: item.taxRate ?? 0,
            total: item.quantity * item.unitPrice,
            order: item.order ?? index,
          })),
        });
      }

      return tx.estimate.update({
        where: { id },
        data: {
          ...(dto.clientId !== undefined && { clientId: dto.clientId }),
          ...(dto.date && { date: new Date(dto.date) }),
          ...(dto.expiryDate !== undefined && {
            expiryDate: dto.expiryDate ? new Date(dto.expiryDate) : null,
          }),
          ...(dto.notes !== undefined && { notes: dto.notes }),
          ...(dto.terms !== undefined && { terms: dto.terms }),
          ...(dto.currency && { currency: dto.currency }),
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
    const estimate = await this.findOne(orgId, id);
    if (estimate.status !== 'draft') {
      throw new BadRequestException('Only draft estimates can be deleted');
    }
    await this.prisma.withOrganization(orgId, async (tx) => {
      await tx.estimateItem.deleteMany({ where: { estimateId: id } });
      await tx.estimate.delete({ where: { id } });
    });
    this.events.emit('estimate.deleted', { id, orgId });
  }

  // ─── send ──────────────────────────────────────────────────────────────────

  async send(orgId: string, id: string) {
    const estimate = await this.findOne(orgId, id);
    if (estimate.status !== 'draft') {
      throw new BadRequestException(
        `Estimate with status '${estimate.status}' cannot be sent`,
      );
    }

    const updated = await this.prisma.withOrganization(orgId, async (tx) => {
      return tx.estimate.update({ where: { id }, data: { status: 'sent' } });
    });

    this.events.emit('estimate.sent', { estimate: updated, orgId });
    return updated;
  }

  // ─── accept ────────────────────────────────────────────────────────────────

  async accept(orgId: string, id: string) {
    await this.findOne(orgId, id);

    const updated = await this.prisma.withOrganization(orgId, async (tx) => {
      return tx.estimate.update({ where: { id }, data: { status: 'accepted' } });
    });

    this.events.emit('estimate.accepted', { estimate: updated, orgId });
    return updated;
  }

  // ─── decline ──────────────────────────────────────────────────────────────

  async decline(orgId: string, id: string) {
    await this.findOne(orgId, id);

    return this.prisma.withOrganization(orgId, async (tx) => {
      return tx.estimate.update({ where: { id }, data: { status: 'declined' } });
    });
  }

  // ─── convertToInvoice ─────────────────────────────────────────────────────

  async convertToInvoice(orgId: string, id: string, createdBy: string) {
    const estimate = await this.findOne(orgId, id);

    const invoice = await this.prisma.withOrganization(orgId, async (tx) => {
      // Generate an invoice number by counting existing invoices
      const invoiceCount = await tx.invoice.count({
        where: { organizationId: orgId },
      });
      const invoiceNumber = `INV-${String(invoiceCount + 1).padStart(4, '0')}`;

      const newInvoice = await tx.invoice.create({
        data: {
          organizationId: orgId,
          clientId: estimate.clientId ?? null,
          number: invoiceNumber,
          date: new Date(),
          dueDate: null,
          status: 'draft',
          subtotal: estimate.subtotal,
          tax: estimate.tax,
          discount: estimate.discount,
          total: estimate.total,
          notes: estimate.notes ?? null,
          terms: estimate.terms ?? null,
          currency: (estimate as any).currency ?? 'USD',
          createdBy,
        },
      });

      await tx.invoiceItem.createMany({
        data: (estimate.items as any[]).map((item: any) => ({
          invoiceId: newInvoice.id,
          description: item.description,
          quantity: item.quantity,
          unitPrice: item.unitPrice,
          taxRate: item.taxRate,
          total: item.total,
          order: item.order,
        })),
      });

      // Mark estimate as accepted and link to new invoice
      await tx.estimate.update({
        where: { id },
        data: {
          status: 'accepted',
          convertedToInvoiceId: newInvoice.id,
        },
      });

      return tx.invoice.findUnique({
        where: { id: newInvoice.id },
        include: {
          client: { select: { id: true, company: true } },
          items: { orderBy: { order: 'asc' } },
        },
      });
    });

    this.events.emit('estimate.converted', { estimateId: id, invoice, orgId, createdBy });
    return invoice;
  }

  // ─── duplicate ────────────────────────────────────────────────────────────

  async duplicate(orgId: string, id: string, createdBy: string) {
    const source = await this.findOne(orgId, id);

    const duplicate = await this.prisma.withOrganization(orgId, async (tx) => {
      const number = await this.generateEstimateNumber(orgId, tx);

      return tx.estimate.create({
        data: {
          organizationId: orgId,
          clientId: source.clientId ?? null,
          number,
          date: new Date(),
          expiryDate: null,
          status: 'draft',
          subtotal: source.subtotal,
          tax: source.tax,
          discount: source.discount,
          total: source.total,
          notes: source.notes ?? null,
          terms: source.terms ?? null,
          currency: (source as any).currency ?? 'USD',
          createdBy,
          items: {
            createMany: {
              data: (source.items as any[]).map((item: any) => ({
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

    this.events.emit('estimate.created', {
      estimate: duplicate,
      orgId,
      createdBy,
      duplicatedFrom: id,
    });

    return duplicate;
  }

  // ─── getStats ─────────────────────────────────────────────────────────────

  async getStats(orgId: string) {
    return this.prisma.withOrganization(orgId, async (tx) => {
      const [draft, sent, accepted, declined, expired] = await Promise.all([
        tx.estimate.count({ where: { organizationId: orgId, status: 'draft' } }),
        tx.estimate.count({ where: { organizationId: orgId, status: 'sent' } }),
        tx.estimate.count({ where: { organizationId: orgId, status: 'accepted' } }),
        tx.estimate.count({ where: { organizationId: orgId, status: 'declined' } }),
        tx.estimate.count({ where: { organizationId: orgId, status: 'expired' } }),
      ]);

      return { draft, sent, accepted, declined, expired };
    });
  }
}
