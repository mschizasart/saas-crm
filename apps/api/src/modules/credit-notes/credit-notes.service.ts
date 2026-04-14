import {
  Injectable,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service';
import { EventEmitter2 } from '@nestjs/event-emitter';

export interface CreateCreditNoteDto {
  clientId?: string;
  invoiceId?: string;
  date: string;
  currency?: string;
  notes?: string;
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
export class CreditNotesService {
  constructor(
    private prisma: PrismaService,
    private events: EventEmitter2,
  ) {}

  // ─── Private helpers ───────────────────────────────────────────────────────

  private async generateCreditNoteNumber(
    orgId: string,
    tx: any,
  ): Promise<string> {
    const count = await tx.creditNote.count({
      where: { organizationId: orgId },
    });
    return `CN-${String(count + 1).padStart(4, '0')}`;
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
        tx.creditNote.findMany({
          where,
          skip,
          take: limit,
          orderBy: { createdAt: 'desc' },
          include: {
            client: { select: { id: true, company: true } },
            invoice: { select: { id: true, number: true } },
          },
        }),
        tx.creditNote.count({ where }),
      ]);

      return { data, total, page, limit, totalPages: Math.ceil(total / limit) };
    });
  }

  // ─── findOne ───────────────────────────────────────────────────────────────

  async findOne(orgId: string, id: string) {
    return this.prisma.withOrganization(orgId, async (tx) => {
      const creditNote = await tx.creditNote.findFirst({
        where: { id, organizationId: orgId },
        include: {
          client: true,
          invoice: true,
          items: { orderBy: { order: 'asc' } },
          createdByUser: { select: { id: true, name: true, email: true } },
        },
      });
      if (!creditNote) throw new NotFoundException('Credit note not found');
      return creditNote;
    });
  }

  // ─── create ────────────────────────────────────────────────────────────────

  async create(
    orgId: string,
    dto: CreateCreditNoteDto,
    createdBy: string,
  ) {
    const creditNote = await this.prisma.withOrganization(orgId, async (tx) => {
      const number = await this.generateCreditNoteNumber(orgId, tx);
      const totals = this.calculateTotals(dto.items, dto.discount ?? 0);

      return tx.creditNote.create({
        data: {
          organizationId: orgId,
          clientId: dto.clientId ?? null,
          invoiceId: dto.invoiceId ?? null,
          number,
          date: new Date(dto.date),
          status: 'open',
          subtotal: totals.subtotal,
          tax: totals.tax,
          discount: totals.discount,
          total: totals.total,
          notes: dto.notes ?? null,
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
          invoice: { select: { id: true, number: true } },
          items: { orderBy: { order: 'asc' } },
        },
      });
    });

    this.events.emit('credit_note.created', { creditNote, orgId, createdBy });
    return creditNote;
  }

  // ─── update ────────────────────────────────────────────────────────────────

  async update(orgId: string, id: string, dto: Partial<CreateCreditNoteDto>) {
    const existing = await this.findOne(orgId, id);
    if (existing.status !== 'draft') {
      throw new BadRequestException('Only draft credit notes can be edited');
    }

    return this.prisma.withOrganization(orgId, async (tx) => {
      const items =
        dto.items ??
        (existing.items as any[]).map((i: any) => ({
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
        await tx.creditNoteItem.deleteMany({ where: { creditNoteId: id } });
        await tx.creditNoteItem.createMany({
          data: dto.items.map((item, index) => ({
            creditNoteId: id,
            description: item.description,
            quantity: item.quantity,
            unitPrice: item.unitPrice,
            taxRate: item.taxRate ?? 0,
            total: item.quantity * item.unitPrice,
            order: item.order ?? index,
          })),
        });
      }

      return tx.creditNote.update({
        where: { id },
        data: {
          ...(dto.clientId !== undefined && { clientId: dto.clientId }),
          ...(dto.invoiceId !== undefined && { invoiceId: dto.invoiceId }),
          ...(dto.date && { date: new Date(dto.date) }),
          ...(dto.notes !== undefined && { notes: dto.notes }),
          ...(dto.currency && { currency: dto.currency }),
          subtotal: totals.subtotal,
          tax: totals.tax,
          discount: totals.discount,
          total: totals.total,
        },
        include: {
          client: { select: { id: true, company: true } },
          invoice: { select: { id: true, number: true } },
          items: { orderBy: { order: 'asc' } },
        },
      });
    });
  }

  // ─── delete ────────────────────────────────────────────────────────────────

  async delete(orgId: string, id: string) {
    const creditNote = await this.findOne(orgId, id);
    if (creditNote.status !== 'draft') {
      throw new BadRequestException('Only draft credit notes can be deleted');
    }
    await this.prisma.withOrganization(orgId, async (tx) => {
      await tx.creditNoteItem.deleteMany({ where: { creditNoteId: id } });
      await tx.creditNote.delete({ where: { id } });
    });
    this.events.emit('credit_note.deleted', { id, orgId });
  }

  // ─── void ──────────────────────────────────────────────────────────────────

  async void(orgId: string, id: string) {
    const existing = await this.findOne(orgId, id);
    if (existing.status === 'voided') {
      throw new BadRequestException('Credit note is already voided');
    }
    if (existing.status === 'applied') {
      throw new BadRequestException('Applied credit notes cannot be voided');
    }

    const updated = await this.prisma.withOrganization(orgId, async (tx) => {
      return tx.creditNote.update({
        where: { id },
        data: { status: 'voided' },
      });
    });

    this.events.emit('credit_note.voided', { creditNote: updated, orgId });
    return updated;
  }

  // ─── apply ─────────────────────────────────────────────────────────────────

  async apply(orgId: string, id: string) {
    const existing = await this.findOne(orgId, id);
    if (existing.status !== 'open') {
      throw new BadRequestException(
        `Only open credit notes can be applied (current status: ${existing.status})`,
      );
    }

    const updated = await this.prisma.withOrganization(orgId, async (tx) => {
      // If linked to an invoice, create a payment and recompute invoice status
      if (existing.invoiceId) {
        await tx.payment.create({
          data: {
            invoiceId: existing.invoiceId,
            organizationId: orgId,
            amount: existing.total,
            currency: existing.currency ?? 'USD',
            paymentDate: new Date(),
            method: 'credit_note',
            reference: existing.number,
            notes: `Applied from credit note ${existing.number}`,
          },
        });

        // Fetch invoice total + all payments (including the one just created)
        const invoice = await tx.invoice.findFirst({
          where: { id: existing.invoiceId },
          include: { payments: true },
        });

        if (invoice) {
          const paidTotal = (invoice.payments as any[]).reduce(
            (sum: number, p: any) => sum + Number(p.amount),
            0,
          );
          const invoiceTotal = Number(invoice.total);
          const newInvoiceStatus = paidTotal >= invoiceTotal ? 'paid' : 'partial';
          await tx.invoice.update({
            where: { id: existing.invoiceId },
            data: { status: newInvoiceStatus },
          });
        }
      }

      return tx.creditNote.update({
        where: { id },
        data: { status: 'applied' },
      });
    });

    this.events.emit('credit_note.applied', {
      creditNote: updated,
      orgId,
      invoiceId: existing.invoiceId,
    });
    return updated;
  }
}
