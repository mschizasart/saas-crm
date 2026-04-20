import {
  Injectable,
  NotFoundException,
  BadRequestException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { GatewayFactory } from './gateways/gateway.factory';
import { PdfService } from '../pdf/pdf.service';
import { renderReceiptHtml } from '../pdf/templates/receipt.template';

export interface CreatePaymentDto {
  invoiceId: string;
  amount: number;
  paymentDate: string; // ISO date
  paymentModeId?: string;
  paymentMode?: string; // legacy alias, resolves to paymentModeId
  transactionId?: string;
  note?: string;
  currency?: string;
}

export interface BatchPaymentDto {
  payments: CreatePaymentDto[];
}

export interface RefundPaymentDto {
  amount: number;
  reason?: string;
  refundDate?: string;
}

@Injectable()
export class PaymentsService {
  constructor(
    private prisma: PrismaService,
    private events: EventEmitter2,
    private gatewayFactory: GatewayFactory,
    private pdfService: PdfService,
  ) {}

  // ─── Gateway Checkout & Webhooks ───────────────────────────

  listGateways() {
    return this.gatewayFactory.list();
  }

  async createCheckoutForInvoice(
    invoiceId: string,
    gatewayName: string,
    successUrl: string,
    cancelUrl: string,
  ) {
    const invoice = await this.prisma.invoice.findUnique({
      where: { id: invoiceId },
      include: {
        client: { select: { id: true, company: true } },
        currency: { select: { code: true } },
        payments: true,
      },
    });
    if (!invoice) throw new NotFoundException('Invoice not found');
    if (!this.gatewayFactory.has(gatewayName)) {
      throw new BadRequestException(
        `Payment gateway '${gatewayName}' is not available`,
      );
    }

    const paidSum = invoice.payments.reduce(
      (acc, p) => acc + Number(p.amount),
      0,
    );
    const balance = Number(invoice.total) - paidSum;
    if (balance <= 0) {
      throw new BadRequestException('Invoice is already paid');
    }

    const gateway = this.gatewayFactory.get(gatewayName);
    return gateway.createCheckout({
      invoiceId: invoice.id,
      amount: balance,
      currency: invoice.currency?.code ?? 'USD',
      description: `Invoice ${invoice.number}`,
      successUrl,
      cancelUrl,
    });
  }

  async handleGatewayWebhook(
    gatewayName: string,
    rawBody: Buffer | string,
    signature: string,
  ) {
    if (!this.gatewayFactory.has(gatewayName)) {
      throw new BadRequestException(
        `Payment gateway '${gatewayName}' is not available`,
      );
    }
    const gateway = this.gatewayFactory.get(gatewayName);
    const result = await gateway.handleWebhook(rawBody, signature);
    if (!result || result.status !== 'success' || !result.invoiceId) {
      return { received: true };
    }

    // Lookup invoice to get orgId
    const invoice = await this.prisma.invoice.findUnique({
      where: { id: result.invoiceId },
    });
    if (!invoice) return { received: true };

    // Idempotency: skip if a payment with this transactionId already exists
    if (result.transactionId) {
      const existing = await this.prisma.payment.findFirst({
        where: {
          organizationId: invoice.organizationId,
          transactionId: result.transactionId,
        },
      });
      if (existing) return { received: true };
    }

    await this.create(
      invoice.organizationId,
      {
        invoiceId: invoice.id,
        amount: result.amount ?? Number(invoice.total),
        paymentDate: new Date().toISOString(),
        transactionId: result.transactionId,
        note: `Paid via ${gatewayName}`,
      },
      'system',
    );

    return { received: true };
  }

  // ─── Payments CRUD ─────────────────────────────────────────

  async findAll(
    orgId: string,
    query: { invoiceId?: string; clientId?: string; page?: number; limit?: number },
  ) {
    const { invoiceId, clientId, page = 1, limit = 20 } = query;
    const skip = (page - 1) * limit;

    return this.prisma.withOrganization(orgId, async (tx) => {
      const where: any = { organizationId: orgId };
      if (invoiceId) where.invoiceId = invoiceId;
      if (clientId) where.clientId = clientId;

      const [data, total] = await Promise.all([
        tx.payment.findMany({
          where,
          skip,
          take: limit,
          orderBy: { paymentDate: 'desc' },
          include: {
            invoice: { select: { id: true, number: true, total: true, status: true } },
            client: { select: { id: true, company: true } },
          },
        }),
        tx.payment.count({ where }),
      ]);

      return { data, total, page, limit, totalPages: Math.ceil(total / limit) };
    });
  }

  async findOne(orgId: string, id: string) {
    return this.prisma.withOrganization(orgId, async (tx) => {
      const payment = await tx.payment.findFirst({
        where: { id, organizationId: orgId },
        include: {
          invoice: { select: { id: true, number: true, total: true, status: true } },
          client: { select: { id: true, company: true } },
        },
      });
      if (!payment) throw new NotFoundException('Payment not found');
      return payment;
    });
  }

  // Render a full payment receipt PDF for the given payment. Loads the payment
  // (with invoice, client, payment mode) + the organization record, runs it
  // through the receipt template, and returns a PDF buffer.
  async getReceiptPdf(orgId: string, paymentId: string) {
    const payment = await this.prisma.withOrganization(orgId, async (tx) => {
      const p = await tx.payment.findFirst({
        where: { id: paymentId, organizationId: orgId },
        include: {
          invoice: {
            select: {
              id: true,
              number: true,
              total: true,
              status: true,
              currency: { select: { code: true } },
            },
          },
          client: true,
          paymentMode: { select: { id: true, name: true } },
        },
      });
      if (!p) throw new NotFoundException('Payment not found');
      return p;
    });

    const organization = await this.prisma.organization.findUnique({
      where: { id: orgId },
    });

    const html = renderReceiptHtml(payment, (payment as any).client, organization);
    const pdf = await this.pdfService.generatePdf(html);
    return { pdf, payment };
  }

  async create(orgId: string, dto: CreatePaymentDto, createdBy: string) {
    const payment = await this.prisma.withOrganization(orgId, async (tx) => {
      const created = await tx.payment.create({
        data: {
          organizationId: orgId,
          invoiceId: dto.invoiceId,
          amount: dto.amount,
          paymentDate: new Date(dto.paymentDate),
          paymentModeId: dto.paymentModeId,
          transactionId: dto.transactionId,
          note: dto.note,
          currency: dto.currency,
        },
      });

      // Recalculate invoice status
      const invoice = await tx.invoice.findUnique({
        where: { id: dto.invoiceId },
        include: { payments: true },
      });

      if (invoice) {
        const paidSum = invoice.payments.reduce(
          (acc, p) => acc + Number(p.amount),
          0,
        );
        const invoiceTotal = Number(invoice.total);
        let newStatus: string;
        if (paidSum >= invoiceTotal) {
          newStatus = 'paid';
        } else if (paidSum > 0) {
          newStatus = 'partial';
        } else {
          newStatus = invoice.status;
        }
        await tx.invoice.update({ where: { id: invoice.id }, data: { status: newStatus } });
        const updatedInvoice = { ...invoice, status: newStatus };
        this.events.emit('payment.created', { payment: created, invoice: updatedInvoice, orgId });
      }

      return created;
    });

    return payment;
  }

  /**
   * Batch create payments. All rows are created in a single transaction so if
   * any individual row fails validation the entire batch is rolled back.
   * Reuses the same per-invoice status recalculation logic as `create`.
   */
  async createBatch(
    orgId: string,
    dto: BatchPaymentDto,
    createdBy: string,
  ) {
    if (!dto?.payments?.length) {
      throw new BadRequestException('payments array is required');
    }

    // Validate all rows up-front
    for (const p of dto.payments) {
      if (!p.invoiceId) {
        throw new BadRequestException('Each payment requires invoiceId');
      }
      if (!(Number(p.amount) > 0)) {
        throw new BadRequestException('Each payment amount must be > 0');
      }
      if (!p.paymentDate) {
        throw new BadRequestException('Each payment requires paymentDate');
      }
    }

    const created = await this.prisma.withOrganization(orgId, async (tx) => {
      const results: any[] = [];
      const touchedInvoices = new Set<string>();
      for (const p of dto.payments) {
        const modeId = p.paymentModeId ?? p.paymentMode ?? null;
        const row = await tx.payment.create({
          data: {
            organizationId: orgId,
            invoiceId: p.invoiceId,
            amount: p.amount,
            paymentDate: new Date(p.paymentDate),
            paymentModeId: modeId,
            transactionId: p.transactionId,
            note: p.note,
            currency: p.currency,
          },
        });
        results.push(row);
        touchedInvoices.add(p.invoiceId);
      }

      // Recalculate status for each touched invoice once (not per payment)
      for (const invoiceId of touchedInvoices) {
        const invoice = await tx.invoice.findUnique({
          where: { id: invoiceId },
          include: { payments: true },
        });
        if (!invoice) continue;
        const paidSum = invoice.payments.reduce(
          (acc, pp) => acc + Number(pp.amount),
          0,
        );
        const invoiceTotal = Number(invoice.total);
        let newStatus: string;
        if (paidSum >= invoiceTotal) {
          newStatus = 'paid';
        } else if (paidSum > 0) {
          newStatus = 'partial';
        } else {
          newStatus = invoice.status;
        }
        await tx.invoice.update({
          where: { id: invoice.id },
          data: { status: newStatus },
        });
      }

      return results;
    });

    for (const c of created) {
      this.events.emit('payment.created', { payment: c, orgId, batch: true });
    }

    return { count: created.length, payments: created };
  }

  /**
   * Refund an existing payment. Writes a negative-amount Payment row linked
   * to the same invoice, stamps `refundedAt` + `refundedAmount` on the
   * original row, and recomputes the invoice status.
   *
   * The `refundedAt`/`refundedAmount` columns are new — if the DB migration
   * hasn't been applied yet we catch the Prisma unknown-column error and
   * return 503 so the rest of the app keeps building.
   */
  async refund(
    orgId: string,
    paymentId: string,
    dto: RefundPaymentDto,
    createdBy: string,
  ) {
    if (!(Number(dto.amount) > 0)) {
      throw new BadRequestException('Refund amount must be > 0');
    }

    try {
      return await this.prisma.withOrganization(orgId, async (tx) => {
        const original = await tx.payment.findFirst({
          where: { id: paymentId, organizationId: orgId },
        });
        if (!original) throw new NotFoundException('Payment not found');
        if (Number(original.amount) <= 0) {
          throw new BadRequestException(
            'Cannot refund a refund/adjustment row',
          );
        }

        const alreadyRefunded = Number(
          (original as any).refundedAmount ?? 0,
        );
        if (alreadyRefunded + Number(dto.amount) > Number(original.amount)) {
          throw new BadRequestException(
            'Refund amount exceeds remaining refundable amount',
          );
        }

        const refundDate = dto.refundDate
          ? new Date(dto.refundDate)
          : new Date();

        // Negative-amount row linked to the same invoice.
        const refundRow = await tx.payment.create({
          data: {
            organizationId: orgId,
            invoiceId: original.invoiceId,
            clientId: original.clientId,
            paymentModeId: original.paymentModeId,
            amount: -Math.abs(Number(dto.amount)),
            currency: original.currency,
            transactionId: null,
            note:
              `Refund of payment ${original.id}` +
              (dto.reason ? ` — ${dto.reason}` : ''),
            paymentDate: refundDate,
          },
        });

        // Stamp the original
        await tx.payment.update({
          where: { id: original.id },
          data: {
            refundedAt: refundDate,
            refundedAmount: alreadyRefunded + Number(dto.amount),
            refundReason: dto.reason ?? null,
          } as any,
        });

        // Recalculate invoice status
        const invoice = await tx.invoice.findUnique({
          where: { id: original.invoiceId },
          include: { payments: true },
        });
        if (invoice) {
          const paidSum = invoice.payments.reduce(
            (acc, p) => acc + Number(p.amount),
            0,
          );
          const invoiceTotal = Number(invoice.total);
          let newStatus: string;
          if (paidSum >= invoiceTotal) {
            newStatus = 'paid';
          } else if (paidSum > 0) {
            newStatus = 'partial';
          } else {
            newStatus = 'unpaid';
          }
          await tx.invoice.update({
            where: { id: invoice.id },
            data: { status: newStatus },
          });
        }

        this.events.emit('payment.refunded', {
          orgId,
          original,
          refund: refundRow,
        });

        return { original: { ...original, refundedAmount: alreadyRefunded + Number(dto.amount), refundedAt: refundDate }, refund: refundRow };
      });
    } catch (err: any) {
      // Missing column (migration not yet applied)
      const msg = String(err?.message ?? '');
      if (
        err?.code === 'P2022' ||
        /column .*refunded(At|Amount|Reason).*/i.test(msg) ||
        /Unknown arg `refunded/i.test(msg)
      ) {
        throw new ServiceUnavailableException(
          'Refund columns not yet migrated. Run the pending ALTER TABLE on "payments".',
        );
      }
      throw err;
    }
  }

  async delete(orgId: string, id: string) {
    await this.findOne(orgId, id);
    await this.prisma.withOrganization(orgId, async (tx) => {
      const payment = await tx.payment.delete({ where: { id } });

      // Recalculate invoice status after deletion
      const invoice = await tx.invoice.findUnique({
        where: { id: payment.invoiceId },
        include: { payments: true },
      });

      if (invoice) {
        const remainingSum = invoice.payments.reduce(
          (acc, p) => acc + Number(p.amount),
          0,
        );
        let newStatus: string;
        if (remainingSum <= 0) {
          newStatus = 'sent';
        } else {
          newStatus = 'partial';
        }
        await tx.invoice.update({ where: { id: invoice.id }, data: { status: newStatus } });
      }
    });
  }

  // ─── Payment Modes ─────────────────────────────────────────

  async getPaymentModes(orgId: string) {
    return this.prisma.withOrganization(orgId, async (tx) => {
      return tx.paymentMode.findMany({
        where: { organizationId: orgId },
        orderBy: { name: 'asc' },
      });
    });
  }

  async createPaymentMode(orgId: string, name: string, description?: string) {
    return this.prisma.withOrganization(orgId, async (tx) => {
      return tx.paymentMode.create({
        data: { organizationId: orgId, name, description: description ?? null },
      });
    });
  }

  async updatePaymentMode(
    orgId: string,
    id: string,
    dto: { name?: string; description?: string; active?: boolean },
  ) {
    return this.prisma.withOrganization(orgId, async (tx) => {
      const existing = await tx.paymentMode.findFirst({
        where: { id, organizationId: orgId },
      });
      if (!existing) throw new NotFoundException('Payment mode not found');
      return tx.paymentMode.update({
        where: { id },
        data: {
          ...(dto.name !== undefined && { name: dto.name }),
          ...(dto.description !== undefined && { description: dto.description }),
          ...(dto.active !== undefined && { active: dto.active }),
        },
      });
    });
  }

  async deletePaymentMode(orgId: string, id: string) {
    return this.prisma.withOrganization(orgId, async (tx) => {
      const existing = await tx.paymentMode.findFirst({
        where: { id, organizationId: orgId },
      });
      if (!existing) throw new NotFoundException('Payment mode not found');
      await tx.paymentMode.delete({ where: { id } });
    });
  }

  // ─── Stats ─────────────────────────────────────────────────

  async getStats(orgId: string, month?: string) {
    const now = new Date();
    let year: number;
    let monthIndex: number;

    if (month) {
      // Parse YYYY-MM
      const [y, m] = month.split('-').map(Number);
      year = y;
      monthIndex = m - 1;
    } else {
      year = now.getFullYear();
      monthIndex = now.getMonth();
    }

    const thisMonthStart = new Date(year, monthIndex, 1);
    const thisMonthEnd = new Date(year, monthIndex + 1, 1);

    const lastMonthStart = new Date(year, monthIndex - 1, 1);
    const lastMonthEnd = new Date(year, monthIndex, 1);

    return this.prisma.withOrganization(orgId, async (tx) => {
      const [thisMonthPayments, lastMonthPayments] = await Promise.all([
        tx.payment.findMany({
          where: {
            organizationId: orgId,
            paymentDate: { gte: thisMonthStart, lt: thisMonthEnd },
          },
          select: { amount: true },
        }),
        tx.payment.findMany({
          where: {
            organizationId: orgId,
            paymentDate: { gte: lastMonthStart, lt: lastMonthEnd },
          },
          select: { amount: true },
        }),
      ]);

      const thisMonthTotal = thisMonthPayments.reduce(
        (acc, p) => acc + Number(p.amount),
        0,
      );
      const lastMonthTotal = lastMonthPayments.reduce(
        (acc, p) => acc + Number(p.amount),
        0,
      );

      return {
        thisMonth: { total: thisMonthTotal, month: thisMonthStart.toISOString().slice(0, 7) },
        lastMonth: { total: lastMonthTotal, month: lastMonthStart.toISOString().slice(0, 7) },
      };
    });
  }
}
