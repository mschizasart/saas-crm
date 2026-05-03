import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { createMock, DeepMocked } from '@golevelup/ts-jest';
import { InvoicesService } from './invoices.service';
import { PrismaService } from '../../database/prisma.service';
import { ActivityLogService } from '../activity-log/activity-log.service';

function makeWithOrganization(prisma: DeepMocked<PrismaService>) {
  return jest
    .fn()
    .mockImplementation(async (_orgId: string, fn: (tx: any) => any) =>
      fn(prisma as any),
    );
}

describe('InvoicesService', () => {
  let service: InvoicesService;
  let prisma: DeepMocked<PrismaService>;
  let events: DeepMocked<EventEmitter2>;
  let activityLog: DeepMocked<ActivityLogService>;

  const ORG_ID = 'org_1';
  const USER_ID = 'user_1';

  beforeEach(() => {
    prisma = createMock<PrismaService>();
    events = createMock<EventEmitter2>();
    activityLog = createMock<ActivityLogService>();
    (prisma.withOrganization as any) = makeWithOrganization(prisma);
    service = new InvoicesService(prisma, events, activityLog);
  });

  // ─── create ───────────────────────────────────────────────────
  describe('create', () => {
    it('computes totals (subtotal, tax, total) from line items', async () => {
      // 2 items: 10×$5 (no tax) + 1×$100 @ 20% tax
      (prisma.product.findMany as jest.Mock).mockResolvedValue([]);
      (prisma.invoice.count as jest.Mock).mockResolvedValue(0);
      (prisma.invoice.create as jest.Mock).mockImplementation(
        async (args: any) => ({ id: 'inv-1', ...args.data }),
      );
      (prisma.invoice.findUnique as jest.Mock).mockImplementation(
        async () => ({ id: 'inv-1' }),
      );

      await service.create(
        ORG_ID,
        {
          clientId: 'c1',
          date: '2025-01-10',
          items: [
            { description: 'A', quantity: 10, unitPrice: 5, taxRate: 0 },
            { description: 'B', quantity: 1, unitPrice: 100, taxRate: 20 },
          ],
        } as any,
        USER_ID,
      );

      const createCall = (prisma.invoice.create as jest.Mock).mock.calls[0][0];
      expect(createCall.data.subTotal).toBe(150);
      expect(createCall.data.totalTax).toBe(20);
      expect(createCall.data.total).toBe(170);
      expect(createCall.data.number).toMatch(/^INV-\d{4}$/);
      expect(events.emit).toHaveBeenCalledWith(
        'invoice.created',
        expect.objectContaining({ orgId: ORG_ID, createdBy: USER_ID }),
      );
    });

    it('rejects line items whose productId does not belong to the org', async () => {
      // 2 productIds requested, only 1 found → cross-tenant attempt
      (prisma.product.findMany as jest.Mock).mockResolvedValue([{ id: 'p1' }]);
      await expect(
        service.create(
          ORG_ID,
          {
            clientId: 'c1',
            date: '2025-01-10',
            items: [
              { description: 'A', quantity: 1, unitPrice: 1, productId: 'p1' },
              { description: 'B', quantity: 1, unitPrice: 1, productId: 'p_evil' },
            ],
          } as any,
          USER_ID,
        ),
      ).rejects.toThrow(BadRequestException);
    });
  });

  // ─── send + invoice.sent emission ─────────────────────────────
  describe('send', () => {
    it('emits invoice.sent and flips status to sent', async () => {
      (prisma.invoice.findFirst as jest.Mock).mockResolvedValue({
        id: 'inv-1',
        status: 'draft',
        items: [],
      });
      (prisma.invoice.update as jest.Mock).mockResolvedValue({});
      (prisma.invoice.findUnique as jest.Mock).mockResolvedValue({
        id: 'inv-1',
        status: 'sent',
      });

      const result = await service.send(ORG_ID, 'inv-1');
      expect(prisma.invoice.update).toHaveBeenCalledWith({
        where: { id: 'inv-1' },
        data: { status: 'sent' },
      });
      expect(events.emit).toHaveBeenCalledWith(
        'invoice.sent',
        expect.objectContaining({ orgId: ORG_ID }),
      );
      expect(result.status).toBe('sent');
    });

    it('refuses to send a paid invoice (status transition guard)', async () => {
      (prisma.invoice.findFirst as jest.Mock).mockResolvedValue({
        id: 'inv-1',
        status: 'paid',
        items: [],
      });
      await expect(service.send(ORG_ID, 'inv-1')).rejects.toThrow(
        BadRequestException,
      );
    });
  });

  // ─── status transitions ───────────────────────────────────────
  describe('updateStatus (transition map)', () => {
    it('allows draft → sent', async () => {
      (prisma.invoice.findFirst as jest.Mock).mockResolvedValue({
        id: 'i',
        status: 'draft',
        items: [],
      });
      (prisma.invoice.update as jest.Mock).mockResolvedValue({
        id: 'i',
        status: 'sent',
      });
      const out = await service.updateStatus(ORG_ID, 'i', 'sent');
      expect(out.status).toBe('sent');
    });

    it('rejects paid → draft', async () => {
      (prisma.invoice.findFirst as jest.Mock).mockResolvedValue({
        id: 'i',
        status: 'paid',
        items: [],
      });
      await expect(
        service.updateStatus(ORG_ID, 'i', 'draft'),
      ).rejects.toThrow(BadRequestException);
    });

    it('rejects cancelled → anything', async () => {
      (prisma.invoice.findFirst as jest.Mock).mockResolvedValue({
        id: 'i',
        status: 'cancelled',
        items: [],
      });
      await expect(
        service.updateStatus(ORG_ID, 'i', 'sent'),
      ).rejects.toThrow(BadRequestException);
    });
  });

  // ─── bulkUpdateStatus ─────────────────────────────────────────
  describe('bulkUpdateStatus', () => {
    it('rejects "paid" — must use mark-paid endpoint', async () => {
      await expect(
        service.bulkUpdateStatus(ORG_ID, ['i1'], 'paid'),
      ).rejects.toThrow(BadRequestException);
    });

    it('updates only invoices in valid source states; reports skipped', async () => {
      (prisma.invoice.findMany as jest.Mock).mockResolvedValue([
        { id: 'i1', status: 'draft', number: 'A' },
        { id: 'i2', status: 'paid', number: 'B' }, // can't go to cancelled (paid is terminal)
        { id: 'i3', status: 'sent', number: 'C' },
      ]);
      (prisma.invoice.update as jest.Mock).mockResolvedValue({});

      const result = await service.bulkUpdateStatus(
        ORG_ID,
        ['i1', 'i2', 'i3', 'i_missing'],
        'cancelled',
      );

      expect(result.updated).toBe(2);
      expect(result.skipped).toEqual(
        expect.arrayContaining([
          { id: 'i_missing', reason: 'not found' },
          expect.objectContaining({
            id: 'i2',
            reason: expect.stringMatching(/cannot transition from 'paid'/),
          }),
        ]),
      );
    });

    it('returns early when given an empty list', async () => {
      const result = await service.bulkUpdateStatus(ORG_ID, [], 'sent');
      expect(result).toEqual({ updated: 0, skipped: [] });
      expect(prisma.invoice.findMany).not.toHaveBeenCalled();
    });
  });

  // ─── cloneToEstimate ──────────────────────────────────────────
  describe('cloneToEstimate', () => {
    it('creates an EST-####, mirrors items + totals, emits estimate.created', async () => {
      const sourceInvoice = {
        id: 'inv-9',
        clientId: 'c1',
        currencyId: 'usd',
        terms: 'Net 30',
        discount: 0,
        items: [
          { description: 'X', qty: 2, rate: 50, taxRate: 0 },
          { description: 'Y', qty: 1, rate: 25, taxRate: 10 },
        ],
      };
      (prisma.invoice.findFirst as jest.Mock).mockResolvedValue(sourceInvoice);
      (prisma.estimate.count as jest.Mock).mockResolvedValue(7);
      (prisma.estimate.create as jest.Mock).mockImplementation(
        async (args: any) => ({ id: 'est-1', ...args.data }),
      );

      await service.cloneToEstimate(ORG_ID, 'inv-9', USER_ID);

      const createCall = (prisma.estimate.create as jest.Mock).mock.calls[0][0];
      expect(createCall.data.number).toBe('EST-0008');
      expect(createCall.data.subTotal).toBe(125); // 100 + 25
      expect(createCall.data.totalTax).toBe(2.5); // 25 * 0.1
      expect(createCall.data.total).toBe(127.5);
      expect(events.emit).toHaveBeenCalledWith(
        'estimate.created',
        expect.objectContaining({
          orgId: ORG_ID,
          clonedFromInvoice: 'inv-9',
        }),
      );
    });
  });

  // ─── merge ────────────────────────────────────────────────────
  describe('merge', () => {
    it('rejects fewer than 2 invoiceIds', async () => {
      await expect(service.merge(ORG_ID, ['i1'], USER_ID)).rejects.toThrow(
        BadRequestException,
      );
    });

    it('throws Conflict when invoices have different clients', async () => {
      (prisma.invoice.findMany as jest.Mock).mockResolvedValue([
        { id: 'i1', clientId: 'c1', currencyId: 'usd', status: 'draft', items: [] },
        { id: 'i2', clientId: 'c2', currencyId: 'usd', status: 'draft', items: [] },
      ]);
      await expect(
        service.merge(ORG_ID, ['i1', 'i2'], USER_ID),
      ).rejects.toThrow(ConflictException);
    });

    it('throws Conflict when one source is not draft', async () => {
      (prisma.invoice.findMany as jest.Mock).mockResolvedValue([
        { id: 'i1', clientId: 'c1', currencyId: 'usd', status: 'draft', items: [] },
        { id: 'i2', clientId: 'c1', currencyId: 'usd', status: 'sent', items: [] },
      ]);
      await expect(
        service.merge(ORG_ID, ['i1', 'i2'], USER_ID),
      ).rejects.toThrow(ConflictException);
    });

    it('cancels source invoices and creates merged draft', async () => {
      (prisma.invoice.findMany as jest.Mock).mockResolvedValue([
        {
          id: 'i1',
          number: 'INV-0001',
          clientId: 'c1',
          currencyId: 'usd',
          status: 'draft',
          terms: '',
          discountType: 'fixed',
          allowedPaymentModes: [],
          items: [{ description: 'A', qty: 1, rate: 10, order: 0 }],
        },
        {
          id: 'i2',
          number: 'INV-0002',
          clientId: 'c1',
          currencyId: 'usd',
          status: 'draft',
          terms: '',
          discountType: 'fixed',
          allowedPaymentModes: [],
          items: [{ description: 'B', qty: 2, rate: 5, order: 0 }],
        },
      ]);
      (prisma.invoice.count as jest.Mock).mockResolvedValue(2);
      (prisma.invoice.create as jest.Mock).mockResolvedValue({
        id: 'merged',
        number: 'INV-0003',
      });
      (prisma.invoice.update as jest.Mock).mockResolvedValue({});

      const merged = await service.merge(ORG_ID, ['i1', 'i2'], USER_ID);

      expect(merged.id).toBe('merged');
      // Each source updated to cancelled
      expect((prisma.invoice.update as jest.Mock).mock.calls).toHaveLength(2);
      expect((prisma.invoice.update as jest.Mock).mock.calls[0][0]).toMatchObject(
        {
          where: { id: 'i1' },
          data: expect.objectContaining({ status: 'cancelled' }),
        },
      );
      expect(events.emit).toHaveBeenCalledWith(
        'invoice.created',
        expect.objectContaining({ mergedFrom: ['i1', 'i2'] }),
      );
    });
  });

  // ─── delete (only-draft guard) ────────────────────────────────
  describe('delete', () => {
    it('refuses to delete a non-draft invoice', async () => {
      (prisma.invoice.findFirst as jest.Mock).mockResolvedValue({
        id: 'i',
        status: 'sent',
        items: [],
      });
      await expect(service.delete(ORG_ID, 'i')).rejects.toThrow(
        BadRequestException,
      );
    });

    it('deletes a draft invoice and emits event', async () => {
      (prisma.invoice.findFirst as jest.Mock).mockResolvedValue({
        id: 'i',
        status: 'draft',
        items: [],
      });
      (prisma.invoiceItem.deleteMany as jest.Mock).mockResolvedValue({});
      (prisma.invoice.delete as jest.Mock).mockResolvedValue({});

      await service.delete(ORG_ID, 'i');

      expect(events.emit).toHaveBeenCalledWith('invoice.deleted', {
        id: 'i',
        orgId: ORG_ID,
      });
    });
  });
});
