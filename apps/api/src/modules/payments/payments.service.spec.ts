import {
  BadRequestException,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { createMock, DeepMocked } from '@golevelup/ts-jest';
import { PaymentsService } from './payments.service';
import { PrismaService } from '../../database/prisma.service';
import { GatewayFactory } from './gateways/gateway.factory';
import { PdfService } from '../pdf/pdf.service';

function makeWithOrganization(prisma: DeepMocked<PrismaService>) {
  return jest
    .fn()
    .mockImplementation(async (_orgId: string, fn: (tx: any) => any) =>
      fn(prisma as any),
    );
}

describe('PaymentsService', () => {
  let service: PaymentsService;
  let prisma: DeepMocked<PrismaService>;
  let events: DeepMocked<EventEmitter2>;
  let gatewayFactory: DeepMocked<GatewayFactory>;
  let pdf: DeepMocked<PdfService>;

  const ORG_ID = 'org_abc';
  const USER_ID = 'user_123';

  beforeEach(() => {
    prisma = createMock<PrismaService>();
    events = createMock<EventEmitter2>();
    gatewayFactory = createMock<GatewayFactory>();
    pdf = createMock<PdfService>();
    (prisma.withOrganization as any) = makeWithOrganization(prisma);
    service = new PaymentsService(prisma, events, gatewayFactory, pdf);
  });

  // ─── create / status flip ──────────────────────────────────
  describe('create', () => {
    it('marks the invoice paid when payments cover the total and emits payment.created', async () => {
      const created = { id: 'pay_1', amount: 100 };
      const invoice = {
        id: 'inv_1',
        total: 100,
        status: 'sent',
        payments: [{ amount: 100 }], // findUnique returns post-create state
      };
      (prisma.payment.create as jest.Mock).mockResolvedValue(created);
      (prisma.invoice.findUnique as jest.Mock).mockResolvedValue(invoice);
      (prisma.invoice.update as jest.Mock).mockResolvedValue({});

      const result = await service.create(
        ORG_ID,
        { invoiceId: 'inv_1', amount: 100, paymentDate: '2025-01-10' },
        USER_ID,
      );

      expect(prisma.invoice.update).toHaveBeenCalledWith({
        where: { id: 'inv_1' },
        data: { status: 'paid' },
      });
      expect(events.emit).toHaveBeenCalledWith(
        'payment.created',
        expect.objectContaining({
          payment: created,
          invoice: expect.objectContaining({ status: 'paid' }),
          orgId: ORG_ID,
        }),
      );
      expect(result).toBe(created);
    });

    it('marks the invoice partial when paid sum is less than total', async () => {
      (prisma.payment.create as jest.Mock).mockResolvedValue({ id: 'p' });
      (prisma.invoice.findUnique as jest.Mock).mockResolvedValue({
        id: 'inv_1',
        total: 200,
        status: 'sent',
        payments: [{ amount: 50 }, { amount: 50 }],
      });
      (prisma.invoice.update as jest.Mock).mockResolvedValue({});

      await service.create(
        ORG_ID,
        { invoiceId: 'inv_1', amount: 50, paymentDate: '2025-01-10' },
        USER_ID,
      );

      expect(prisma.invoice.update).toHaveBeenCalledWith({
        where: { id: 'inv_1' },
        data: { status: 'partial' },
      });
    });
  });

  // ─── createBatch ───────────────────────────────────────────
  describe('createBatch', () => {
    it('rejects an empty batch', async () => {
      await expect(
        service.createBatch(ORG_ID, { payments: [] } as any, USER_ID),
      ).rejects.toThrow(BadRequestException);
    });

    it('rejects a row with non-positive amount', async () => {
      await expect(
        service.createBatch(
          ORG_ID,
          {
            payments: [
              { invoiceId: 'i1', amount: 0, paymentDate: '2025-01-01' },
            ],
          },
          USER_ID,
        ),
      ).rejects.toThrow(/amount must be > 0/);
    });

    it('rejects a row missing invoiceId', async () => {
      await expect(
        service.createBatch(
          ORG_ID,
          {
            payments: [
              { invoiceId: '' as any, amount: 10, paymentDate: '2025-01-01' },
            ],
          },
          USER_ID,
        ),
      ).rejects.toThrow(/invoiceId/);
    });

    it('recalculates each touched invoice once, regardless of how many payments target it', async () => {
      (prisma.payment.create as jest.Mock).mockResolvedValue({ id: 'p' });
      (prisma.invoice.findUnique as jest.Mock).mockResolvedValue({
        id: 'inv_1',
        total: 100,
        status: 'sent',
        payments: [{ amount: 100 }],
      });
      (prisma.invoice.update as jest.Mock).mockResolvedValue({});

      const r = await service.createBatch(
        ORG_ID,
        {
          payments: [
            { invoiceId: 'inv_1', amount: 50, paymentDate: '2025-01-01' },
            { invoiceId: 'inv_1', amount: 50, paymentDate: '2025-01-02' },
          ],
        },
        USER_ID,
      );

      expect(r.count).toBe(2);
      // Single invoice -> single status update call
      expect(prisma.invoice.update).toHaveBeenCalledTimes(1);
      expect(events.emit).toHaveBeenCalledTimes(2);
    });
  });

  // ─── refund ────────────────────────────────────────────────
  describe('refund', () => {
    it('rejects a non-positive refund amount', async () => {
      await expect(
        service.refund(ORG_ID, 'pay_1', { amount: 0 }, USER_ID),
      ).rejects.toThrow(BadRequestException);
    });

    it('throws NotFoundException when the source payment is missing', async () => {
      (prisma.payment.findFirst as jest.Mock).mockResolvedValue(null);
      await expect(
        service.refund(ORG_ID, 'pay_1', { amount: 10 }, USER_ID),
      ).rejects.toThrow(NotFoundException);
    });

    it('refuses to refund a refund row (negative amount)', async () => {
      (prisma.payment.findFirst as jest.Mock).mockResolvedValue({
        id: 'pay_1',
        amount: -20,
      });
      await expect(
        service.refund(ORG_ID, 'pay_1', { amount: 10 }, USER_ID),
      ).rejects.toThrow(/refund a refund/);
    });

    it('refuses to refund more than the remaining refundable amount', async () => {
      (prisma.payment.findFirst as jest.Mock).mockResolvedValue({
        id: 'pay_1',
        amount: 100,
        refundedAmount: 60,
      });
      await expect(
        service.refund(ORG_ID, 'pay_1', { amount: 50 }, USER_ID),
      ).rejects.toThrow(/exceeds remaining refundable/);
    });

    it('creates a negative-amount payment row + stamps refundedAt and emits payment.refunded', async () => {
      (prisma.payment.findFirst as jest.Mock).mockResolvedValue({
        id: 'pay_1',
        amount: 100,
        invoiceId: 'inv_1',
        clientId: 'c1',
        paymentModeId: null,
        currency: 'USD',
        refundedAmount: 0,
      });
      const refundRow = { id: 'pay_2', amount: -30 };
      (prisma.payment.create as jest.Mock).mockResolvedValue(refundRow);
      (prisma.payment.update as jest.Mock).mockResolvedValue({});
      (prisma.invoice.findUnique as jest.Mock).mockResolvedValue({
        id: 'inv_1',
        total: 100,
        status: 'paid',
        payments: [{ amount: 100 }, { amount: -30 }], // post-refund: net 70
      });
      (prisma.invoice.update as jest.Mock).mockResolvedValue({});

      const result = await service.refund(
        ORG_ID,
        'pay_1',
        { amount: 30, reason: 'Customer request' },
        USER_ID,
      );

      // Negative-amount row
      expect(prisma.payment.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            amount: -30,
            invoiceId: 'inv_1',
            note: expect.stringContaining('Customer request'),
          }),
        }),
      );
      // Original stamped
      expect(prisma.payment.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'pay_1' },
          data: expect.objectContaining({
            refundedAmount: 30,
            refundReason: 'Customer request',
          }),
        }),
      );
      // Invoice status flips to partial (70 < 100)
      expect(prisma.invoice.update).toHaveBeenCalledWith({
        where: { id: 'inv_1' },
        data: { status: 'partial' },
      });
      expect(events.emit).toHaveBeenCalledWith(
        'payment.refunded',
        expect.objectContaining({ original: expect.any(Object), refund: refundRow }),
      );
      expect(result.refund).toBe(refundRow);
    });

    it('translates a P2022 missing-column error to ServiceUnavailableException', async () => {
      const err: any = new Error(
        'column "refundedAt" does not exist on table payments',
      );
      err.code = 'P2022';
      (prisma.payment.findFirst as jest.Mock).mockRejectedValue(err);

      await expect(
        service.refund(ORG_ID, 'pay_1', { amount: 10 }, USER_ID),
      ).rejects.toThrow(ServiceUnavailableException);
    });
  });

  // ─── delete + status recalculation ─────────────────────────
  describe('delete', () => {
    it('flips invoice back to "sent" when removing the last payment', async () => {
      (prisma.payment.findFirst as jest.Mock).mockResolvedValue({
        id: 'pay_1',
        organizationId: ORG_ID,
      });
      (prisma.payment.delete as jest.Mock).mockResolvedValue({
        id: 'pay_1',
        invoiceId: 'inv_1',
      });
      (prisma.invoice.findUnique as jest.Mock).mockResolvedValue({
        id: 'inv_1',
        payments: [],
      });
      (prisma.invoice.update as jest.Mock).mockResolvedValue({});

      await service.delete(ORG_ID, 'pay_1');

      expect(prisma.invoice.update).toHaveBeenCalledWith({
        where: { id: 'inv_1' },
        data: { status: 'sent' },
      });
    });
  });

  // ─── gateway checkout ──────────────────────────────────────
  describe('createCheckoutForInvoice', () => {
    it('rejects when the gateway is unknown', async () => {
      (prisma.invoice.findUnique as jest.Mock).mockResolvedValue({
        id: 'inv_1',
        total: 100,
        payments: [],
      });
      gatewayFactory.has.mockReturnValue(false);

      await expect(
        service.createCheckoutForInvoice('inv_1', 'bogus', '/ok', '/cancel'),
      ).rejects.toThrow(/not available/);
    });

    it('rejects when the invoice is already paid', async () => {
      (prisma.invoice.findUnique as jest.Mock).mockResolvedValue({
        id: 'inv_1',
        total: 100,
        payments: [{ amount: 100 }],
      });
      gatewayFactory.has.mockReturnValue(true);

      await expect(
        service.createCheckoutForInvoice('inv_1', 'stripe', '/ok', '/cancel'),
      ).rejects.toThrow(/already paid/);
    });

    it('charges only the outstanding balance', async () => {
      (prisma.invoice.findUnique as jest.Mock).mockResolvedValue({
        id: 'inv_1',
        number: 'INV-1',
        total: 100,
        payments: [{ amount: 30 }],
        currency: { code: 'EUR' },
      });
      gatewayFactory.has.mockReturnValue(true);
      const gateway = {
        createCheckout: jest.fn().mockResolvedValue({ url: 'https://pay/...' }),
      };
      gatewayFactory.get.mockReturnValue(gateway as any);

      const r = await service.createCheckoutForInvoice(
        'inv_1',
        'stripe',
        '/ok',
        '/cancel',
      );

      expect(gateway.createCheckout).toHaveBeenCalledWith(
        expect.objectContaining({
          amount: 70,
          currency: 'EUR',
          description: 'Invoice INV-1',
        }),
      );
      expect(r).toEqual({ url: 'https://pay/...' });
    });
  });

  // ─── webhook idempotency ───────────────────────────────────
  describe('handleGatewayWebhook', () => {
    it('does not double-record when the same transactionId arrives twice', async () => {
      gatewayFactory.has.mockReturnValue(true);
      const gateway = {
        handleWebhook: jest.fn().mockResolvedValue({
          status: 'success',
          invoiceId: 'inv_1',
          transactionId: 'tx_dup',
          amount: 50,
        }),
      };
      gatewayFactory.get.mockReturnValue(gateway as any);
      (prisma.invoice.findUnique as jest.Mock).mockResolvedValue({
        id: 'inv_1',
        organizationId: ORG_ID,
        total: 100,
      });
      (prisma.payment.findFirst as jest.Mock).mockResolvedValue({
        id: 'existing',
      });

      const r = await service.handleGatewayWebhook('stripe', '{}', 'sig');
      expect(r).toEqual({ received: true });
      expect(prisma.payment.create).not.toHaveBeenCalled();
    });

    it('returns received: true for non-success webhook events', async () => {
      gatewayFactory.has.mockReturnValue(true);
      const gateway = {
        handleWebhook: jest.fn().mockResolvedValue({ status: 'pending' }),
      };
      gatewayFactory.get.mockReturnValue(gateway as any);

      const r = await service.handleGatewayWebhook('stripe', '{}', 'sig');
      expect(r).toEqual({ received: true });
      expect(prisma.payment.create).not.toHaveBeenCalled();
    });
  });

  // ─── getStats month math ───────────────────────────────────
  describe('getStats', () => {
    it('sums payments for this month and last month', async () => {
      (prisma.payment.findMany as jest.Mock)
        .mockResolvedValueOnce([{ amount: 50 }, { amount: 20 }]) // this month
        .mockResolvedValueOnce([{ amount: 10 }]); // last month

      const r = await service.getStats(ORG_ID, '2025-04');
      expect(r.thisMonth.total).toBe(70);
      expect(r.lastMonth.total).toBe(10);
      expect(r.thisMonth.month).toBe('2025-04');
    });
  });
});
