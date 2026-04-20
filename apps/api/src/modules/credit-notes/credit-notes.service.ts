import {
  Injectable,
  NotFoundException,
  BadRequestException,
  ConflictException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { PdfService } from '../pdf/pdf.service';
import { renderCreditNoteHtml } from '../pdf/templates/credit-note.template';

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
    private pdfService: PdfService,
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
  ): { subTotal: number; totalTax: number; discount: number; total: number } {
    let subTotal = 0;
    let totalTax = 0;

    for (const item of items) {
      const lineTotal = item.quantity * item.unitPrice;
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
      // Optional contact clientId — when set, forces the client filter to the
      // contact's own clientId (portal users cannot see other clients' notes).
      contactClientId?: string | null;
    },
  ) {
    const { search, status, page = 1, limit = 20 } = query;
    const skip = (page - 1) * limit;
    // Portal contacts are hard-scoped to their own client. If a contact has no
    // linked clientId we return an empty result rather than all the org's data.
    const clientId =
      query.contactClientId !== undefined
        ? (query.contactClientId ?? '__no_client__')
        : query.clientId;

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
        },
      });
      if (!creditNote) throw new NotFoundException('Credit note not found');
      return creditNote;
    });
  }

  // Render a credit-note PDF. Loads the credit note with items/client/invoice
  // plus the organization branding, runs the credit-note template, returns a
  // PDF buffer alongside the raw model for any downstream checks.
  async getPdf(orgId: string, id: string) {
    const creditNote = await this.findOne(orgId, id);
    const organization = await this.prisma.organization.findUnique({
      where: { id: orgId },
    });
    const html = renderCreditNoteHtml(creditNote, organization);
    const pdf = await this.pdfService.generatePdf(html);
    return { pdf, creditNote };
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
          subTotal: totals.subTotal,
          totalTax: totals.totalTax,
          discount: totals.discount,
          total: totals.total,
          remainingAmount: totals.total,
          clientNote: dto.notes ?? null,
          items: {
            createMany: {
              data: dto.items.map((item, index) => ({
                description: item.description,
                qty: item.quantity,
                rate: item.unitPrice,
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
          quantity: Number(i.qty),
          unitPrice: Number(i.rate),
          taxRate: 0,
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
            qty: item.quantity,
            rate: item.unitPrice,
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
          ...(dto.notes !== undefined && { clientNote: dto.notes }),
          subTotal: totals.subTotal,
          totalTax: totals.totalTax,
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
    if (existing.status === 'void') {
      throw new BadRequestException('Credit note is already voided');
    }
    if (existing.status === 'applied') {
      throw new BadRequestException('Applied credit notes cannot be voided');
    }

    const updated = await this.prisma.withOrganization(orgId, async (tx) => {
      return tx.creditNote.update({
        where: { id },
        data: { status: 'void' },
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

  // ─── applyToInvoice ────────────────────────────────────────────────────────
  // Apply a credit note's remaining balance against an arbitrary invoice.
  // Creates a Payment (paymentMode='credit_note', transactionId=<cn number>),
  // bumps the credit note's appliedTotal, and transitions the invoice status
  // to paid / partial depending on the resulting balance.

  async applyToInvoice(orgId: string, id: string, invoiceId: string) {
    const creditNote = await this.findOne(orgId, id);

    if (creditNote.status === 'void') {
      throw new ConflictException('Credit note is voided');
    }

    // Remaining = total - sum(applications so far). We read `appliedTotal`
    // defensively because the column is freshly added; fall back to 0.
    const cnTotal = Number(creditNote.total ?? 0);
    const cnApplied = Number((creditNote as any).appliedTotal ?? 0);
    const cnRemaining = cnTotal - cnApplied;

    if (cnRemaining <= 0) {
      throw new ConflictException('Credit note has no remaining balance');
    }

    try {
      return await this.prisma.withOrganization(orgId, async (tx) => {
        const invoice = await tx.invoice.findFirst({
          where: { id: invoiceId, organizationId: orgId },
          include: { payments: true },
        });
        if (!invoice) throw new NotFoundException('Invoice not found');

        if (
          invoice.clientId &&
          creditNote.clientId &&
          invoice.clientId !== creditNote.clientId
        ) {
          throw new ConflictException(
            'Credit note and invoice belong to different clients',
          );
        }

        const invTotal = Number(invoice.total ?? 0);
        const paidSoFar = (invoice.payments as any[]).reduce(
          (s, p) => s + Number(p.amount ?? 0),
          0,
        );
        const invRemaining = invTotal - paidSoFar;

        if (invRemaining <= 0) {
          throw new ConflictException('Invoice has no outstanding balance');
        }

        const applyAmount = Math.min(cnRemaining, invRemaining);

        await tx.payment.create({
          data: {
            organizationId: orgId,
            invoiceId: invoice.id,
            clientId: invoice.clientId ?? null,
            amount: applyAmount,
            currency: (invoice as any).currency ?? creditNote.currency ?? 'USD',
            paymentDate: new Date(),
            transactionId: creditNote.number,
            note: `Applied from credit note ${creditNote.number}`,
          },
        });

        const newInvoicePaid = paidSoFar + applyAmount;
        const newInvoiceStatus =
          newInvoicePaid >= invTotal ? 'paid' : 'partial';
        await tx.invoice.update({
          where: { id: invoice.id },
          data: { status: newInvoiceStatus },
        });

        const newApplied = cnApplied + applyAmount;
        const cnFullyApplied = newApplied >= cnTotal;
        const updated = await tx.creditNote.update({
          where: { id: creditNote.id },
          data: {
            appliedTotal: newApplied,
            ...(cnFullyApplied && { status: 'applied' }),
          },
        });

        return {
          creditNote: updated,
          invoiceId: invoice.id,
          amountApplied: applyAmount,
          invoiceStatus: newInvoiceStatus,
        };
      });
    } catch (err: any) {
      // Migration guard: if appliedTotal column hasn't been ALTER TABLE'd yet
      // Prisma will throw PrismaClientKnownRequestError P2022 / "column does
      // not exist". Return 503 so the UI can show a migration-pending banner.
      const msg = String(err?.message ?? '');
      if (
        err?.code === 'P2022' ||
        /column .*appliedTotal.* does not exist/i.test(msg) ||
        /Unknown argument `appliedTotal`/i.test(msg)
      ) {
        throw new ServiceUnavailableException(
          'Schema migration pending: credit_notes.appliedTotal column missing. Run the ALTER TABLE.',
        );
      }
      throw err;
    }
  }
}
