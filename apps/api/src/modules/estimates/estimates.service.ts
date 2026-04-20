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
  // Accept both legacy `notes` and Prisma-native `clientNote`.
  // The service maps both to the `clientNote` column.
  notes?: string;
  clientNote?: string;
  terms?: string;
  discount?: number;
  items: Array<{
    description: string;
    longDescription?: string;
    // Accept both legacy names (quantity/unitPrice/taxRate) and Prisma-native (qty/rate/tax1/tax2).
    // `taxRate` is a percentage used for totals math; `tax1`/`tax2` are Tax record IDs stored on the line.
    quantity?: number;
    unitPrice?: number;
    taxRate?: number;
    qty?: number;
    rate?: number;
    tax1?: string;
    tax2?: string;
    unit?: string;
    order?: number;
  }>;
}

interface NormalizedItem {
  description: string;
  longDescription?: string;
  qty: number;
  rate: number;
  tax1?: string;
  tax2?: string;
  unit?: string;
  order?: number;
  /** Percentage — used only for totals calculation, not stored to Prisma. */
  taxRate: number;
}

function normalizeItems(items: CreateEstimateDto['items']): NormalizedItem[] {
  return items.map((item) => ({
    description: item.description,
    longDescription: item.longDescription,
    qty: Number(item.qty ?? item.quantity ?? 0),
    rate: Number(item.rate ?? item.unitPrice ?? 0),
    tax1: item.tax1,
    tax2: item.tax2,
    unit: item.unit,
    order: item.order,
    taxRate: Number(item.taxRate ?? 0),
  }));
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
    items: NormalizedItem[],
    discount = 0,
  ): { subTotal: number; totalTax: number; discount: number; total: number } {
    let subTotal = 0;
    let totalTax = 0;

    for (const item of items) {
      const lineTotal = item.qty * item.rate;
      const lineTax = lineTotal * ((item.taxRate ?? 0) / 100);
      subTotal += lineTotal;
      totalTax += lineTax;
    }

    const total = subTotal + totalTax - discount;
    return { subTotal, totalTax, discount, total };
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
      const normalized = normalizeItems(dto.items);
      const totals = this.calculateTotals(normalized, dto.discount ?? 0);

      return tx.estimate.create({
        data: {
          organizationId: orgId,
          clientId: dto.clientId ?? null,
          number,
          date: new Date(dto.date),
          expiryDate: dto.expiryDate ? new Date(dto.expiryDate) : null,
          status: 'draft',
          subTotal: totals.subTotal,
          totalTax: totals.totalTax,
          discount: totals.discount,
          total: totals.total,
          clientNote: dto.clientNote ?? dto.notes ?? null,
          terms: dto.terms ?? null,
          items: {
            createMany: {
              data: normalized.map((item, index) => ({
                description: item.description,
                longDesc: item.longDescription,
                qty: item.qty,
                rate: item.rate,
                tax1: item.tax1,
                tax2: item.tax2,
                unit: item.unit,
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
      const rawItems = dto.items ?? (existing.items as any[]).map((i: any) => ({
        description: i.description,
        longDescription: i.longDesc,
        qty: Number(i.qty),
        rate: Number(i.rate),
        tax1: i.tax1,
        tax2: i.tax2,
        unit: i.unit,
        order: i.order,
      }));
      const normalized = normalizeItems(rawItems as CreateEstimateDto['items']);

      const totals = this.calculateTotals(
        normalized,
        dto.discount ?? Number(existing.discount),
      );

      if (dto.items) {
        await tx.estimateItem.deleteMany({ where: { estimateId: id } });
        await tx.estimateItem.createMany({
          data: normalized.map((item, index) => ({
            estimateId: id,
            description: item.description,
            longDesc: item.longDescription,
            qty: item.qty,
            rate: item.rate,
            tax1: item.tax1,
            tax2: item.tax2,
            unit: item.unit,
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
          ...((dto.clientNote !== undefined || dto.notes !== undefined) && {
            clientNote: dto.clientNote ?? dto.notes,
          }),
          ...(dto.terms !== undefined && { terms: dto.terms }),
          subTotal: totals.subTotal,
          totalTax: totals.totalTax,
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

  // ─── updateStatus (generic, for kanban drops) ───────────────────────────

  async updateStatus(
    orgId: string,
    id: string,
    status: string,
    userId?: string,
  ) {
    const allowed = ['draft', 'sent', 'declined', 'accepted', 'expired'];
    if (!allowed.includes(status)) {
      throw new BadRequestException(
        `Invalid estimate status '${status}'. Allowed: ${allowed.join(', ')}`,
      );
    }

    const existing = await this.findOne(orgId, id);
    const previousStatus = existing.status;

    const updated = await this.prisma.withOrganization(orgId, async (tx) => {
      return tx.estimate.update({ where: { id }, data: { status } });
    });

    // Log the change without triggering side-effect events (no emails/etc).
    this.events.emit('estimate.status_changed', {
      estimate: updated,
      orgId,
      previousStatus,
      newStatus: status,
      userId,
    });

    return updated;
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
      await tx.estimate.update({ where: { id }, data: { status: 'sent' } });
      // Re-fetch with client contacts and org info for email listener
      return tx.estimate.findUnique({
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
          items: { orderBy: { order: 'asc' } },
        },
      });
    });

    // Fetch org info separately for the event
    const org = await this.prisma.organization.findUnique({
      where: { id: orgId },
      select: { id: true, name: true },
    });

    this.events.emit('estimate.sent', { estimate: { ...updated, organization: org }, orgId });
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
          subTotal: estimate.subTotal,
          totalTax: estimate.totalTax,
          discount: estimate.discount,
          total: estimate.total,
          clientNote: estimate.clientNote ?? null,
          terms: estimate.terms ?? null,
        },
      });

      await tx.invoiceItem.createMany({
        data: (estimate.items as any[]).map((item: any) => ({
          invoiceId: newInvoice.id,
          description: item.description,
          longDesc: item.longDesc,
          qty: item.qty,
          rate: item.rate,
          tax1: item.tax1,
          tax2: item.tax2,
          unit: item.unit,
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
          subTotal: source.subTotal,
          totalTax: source.totalTax,
          discount: source.discount,
          total: source.total,
          clientNote: source.clientNote ?? null,
          terms: source.terms ?? null,
          items: {
            createMany: {
              data: (source.items as any[]).map((item: any) => ({
                description: item.description,
                longDesc: item.longDesc,
                qty: item.qty,
                rate: item.rate,
                tax1: item.tax1,
                tax2: item.tax2,
                unit: item.unit,
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
