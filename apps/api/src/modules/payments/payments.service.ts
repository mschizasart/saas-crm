import {
  Injectable,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { GatewayFactory } from './gateways/gateway.factory';

export interface CreatePaymentDto {
  invoiceId: string;
  amount: number;
  paymentDate: string; // ISO date
  paymentModeId?: string;
  transactionId?: string;
  note?: string;
  currency?: string;
}

@Injectable()
export class PaymentsService {
  constructor(
    private prisma: PrismaService,
    private events: EventEmitter2,
    private gatewayFactory: GatewayFactory,
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

  async createPaymentMode(orgId: string, name: string) {
    return this.prisma.withOrganization(orgId, async (tx) => {
      return tx.paymentMode.create({
        data: { organizationId: orgId, name },
      });
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
