import { BadRequestException, NotFoundException } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { createMock, DeepMocked } from '@golevelup/ts-jest';
import { EstimatesService } from './estimates.service';
import { PrismaService } from '../../database/prisma.service';

/**
 * `withOrganization(orgId, fn)` is the RLS wrapper. We synthesise a proxy that
 * passes the same DeepMocked Prisma instance to the callback so the service
 * sees a transactional `tx` that is identical to the main mock.
 */
function makeWithOrganization(prisma: DeepMocked<PrismaService>) {
  return jest
    .fn()
    .mockImplementation(async (_orgId: string, fn: (tx: any) => any) =>
      fn(prisma as any),
    );
}

describe('EstimatesService', () => {
  let service: EstimatesService;
  let prisma: DeepMocked<PrismaService>;
  let events: DeepMocked<EventEmitter2>;

  const ORG_ID = 'org_abc';
  const USER_ID = 'user_123';

  beforeEach(() => {
    prisma = createMock<PrismaService>();
    events = createMock<EventEmitter2>();
    (prisma.withOrganization as any) = makeWithOrganization(prisma);
    service = new EstimatesService(prisma, events);
  });

  // ─── create + totals math ───────────────────────────────────
  describe('create', () => {
    it('computes subTotal/totalTax/total from line items and emits estimate.created', async () => {
      // 2 lines: 2*50=100 (10% tax = 10), 1*100=100 (20% tax = 20). discount 5.
      // subTotal=200, totalTax=30, discount=5, total=225
      (prisma.product.findMany as jest.Mock).mockResolvedValue([]);
      (prisma.estimate.count as jest.Mock).mockResolvedValue(0);
      const created = { id: 'est_1', number: 'EST-0001', total: 225 };
      (prisma.estimate.create as jest.Mock).mockResolvedValue(created);

      const result = await service.create(
        ORG_ID,
        {
          date: '2025-01-01',
          discount: 5,
          items: [
            { description: 'a', qty: 2, rate: 50, taxRate: 10 },
            { description: 'b', quantity: 1, unitPrice: 100, taxRate: 20 },
          ],
        },
        USER_ID,
      );

      expect(prisma.estimate.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            organizationId: ORG_ID,
            number: 'EST-0001',
            status: 'draft',
            subTotal: 200,
            totalTax: 30,
            discount: 5,
            total: 225,
          }),
        }),
      );
      expect(events.emit).toHaveBeenCalledWith(
        'estimate.created',
        expect.objectContaining({ estimate: created, orgId: ORG_ID, createdBy: USER_ID }),
      );
      expect(result).toBe(created);
    });

    it('rejects items referencing a product that belongs to a different org', async () => {
      // Only 1 of 2 product IDs is found in this org
      (prisma.product.findMany as jest.Mock).mockResolvedValue([{ id: 'prod_a' }]);

      await expect(
        service.create(
          ORG_ID,
          {
            date: '2025-01-01',
            items: [
              { description: 'a', qty: 1, rate: 10, productId: 'prod_a' },
              { description: 'b', qty: 1, rate: 10, productId: 'prod_b' },
            ],
          },
          USER_ID,
        ),
      ).rejects.toThrow(BadRequestException);

      expect(prisma.estimate.create).not.toHaveBeenCalled();
    });

    it('pads the next sequence number to 4 digits (EST-0004 when count=3)', async () => {
      (prisma.product.findMany as jest.Mock).mockResolvedValue([]);
      (prisma.estimate.count as jest.Mock).mockResolvedValue(3);
      (prisma.estimate.create as jest.Mock).mockResolvedValue({ id: 'e' });

      await service.create(
        ORG_ID,
        { date: '2025-01-01', items: [{ description: 'x', qty: 1, rate: 1 }] },
        USER_ID,
      );

      expect(prisma.estimate.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ number: 'EST-0004' }),
        }),
      );
    });
  });

  // ─── findOne ────────────────────────────────────────────────
  describe('findOne', () => {
    it('throws NotFoundException when missing', async () => {
      (prisma.estimate.findFirst as jest.Mock).mockResolvedValue(null);
      await expect(service.findOne(ORG_ID, 'nope')).rejects.toThrow(
        NotFoundException,
      );
    });

    it('returns the estimate when present (tenant-scoped)', async () => {
      const est = { id: 'est_1', organizationId: ORG_ID };
      (prisma.estimate.findFirst as jest.Mock).mockResolvedValue(est);
      await expect(service.findOne(ORG_ID, 'est_1')).resolves.toBe(est);
      expect(prisma.estimate.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'est_1', organizationId: ORG_ID },
        }),
      );
    });
  });

  // ─── update ────────────────────────────────────────────────
  describe('update', () => {
    it('refuses to edit anything other than a draft', async () => {
      (prisma.estimate.findFirst as jest.Mock).mockResolvedValue({
        id: 'e1',
        status: 'sent',
        items: [],
      });
      await expect(
        service.update(ORG_ID, 'e1', { discount: 10 }),
      ).rejects.toThrow(BadRequestException);
    });
  });

  // ─── updateStatus ──────────────────────────────────────────
  describe('updateStatus', () => {
    it('rejects an invalid status', async () => {
      await expect(
        service.updateStatus(ORG_ID, 'e1', 'frobnicated'),
      ).rejects.toThrow(BadRequestException);
    });

    it('emits estimate.status_changed with previous + new status', async () => {
      const prev = { id: 'e1', status: 'draft', items: [] };
      const next = { id: 'e1', status: 'sent' };
      (prisma.estimate.findFirst as jest.Mock).mockResolvedValue(prev);
      (prisma.estimate.update as jest.Mock).mockResolvedValue(next);

      await service.updateStatus(ORG_ID, 'e1', 'sent', USER_ID);

      expect(events.emit).toHaveBeenCalledWith(
        'estimate.status_changed',
        expect.objectContaining({
          estimate: next,
          previousStatus: 'draft',
          newStatus: 'sent',
          userId: USER_ID,
        }),
      );
    });
  });

  // ─── bulkUpdateStatus ──────────────────────────────────────
  describe('bulkUpdateStatus', () => {
    it('throws on an invalid target status', async () => {
      await expect(
        service.bulkUpdateStatus(ORG_ID, ['e1'], 'cancelled'),
      ).rejects.toThrow(BadRequestException);
    });

    it('returns 0/0 for an empty id list', async () => {
      const r = await service.bulkUpdateStatus(ORG_ID, [], 'sent');
      expect(r).toEqual({ updated: 0, skipped: [] });
    });

    it('skips estimates that are already at the target status', async () => {
      (prisma.estimate.findMany as jest.Mock).mockResolvedValue([
        { id: 'e1', status: 'sent' },
      ]);
      (prisma.estimate.update as jest.Mock).mockResolvedValue({});

      const r = await service.bulkUpdateStatus(ORG_ID, ['e1'], 'sent');
      expect(r.updated).toBe(0);
      expect(r.skipped).toEqual([{ id: 'e1', reason: 'already sent' }]);
      expect(prisma.estimate.update).not.toHaveBeenCalled();
    });

    it('refuses to reverse accepted/declined to anything except expired', async () => {
      (prisma.estimate.findMany as jest.Mock).mockResolvedValue([
        { id: 'e1', status: 'accepted' },
        { id: 'e2', status: 'declined' },
      ]);

      const r = await service.bulkUpdateStatus(ORG_ID, ['e1', 'e2'], 'draft');
      expect(r.updated).toBe(0);
      expect(r.skipped).toHaveLength(2);
      expect(r.skipped.every((s) => /cannot transition/.test(s.reason))).toBe(true);
    });

    it('allows accepted → expired (deliberate lapse path)', async () => {
      (prisma.estimate.findMany as jest.Mock).mockResolvedValue([
        { id: 'e1', status: 'accepted' },
      ]);
      (prisma.estimate.update as jest.Mock).mockResolvedValue({});

      const r = await service.bulkUpdateStatus(ORG_ID, ['e1'], 'expired');
      expect(r.updated).toBe(1);
      expect(r.skipped).toHaveLength(0);
    });

    it('reports not-found ids in `skipped`', async () => {
      (prisma.estimate.findMany as jest.Mock).mockResolvedValue([]);
      const r = await service.bulkUpdateStatus(ORG_ID, ['ghost'], 'sent');
      expect(r.skipped).toEqual([{ id: 'ghost', reason: 'not found' }]);
    });

    it('dedupes the input list before processing', async () => {
      (prisma.estimate.findMany as jest.Mock).mockResolvedValue([
        { id: 'e1', status: 'draft' },
      ]);
      (prisma.estimate.update as jest.Mock).mockResolvedValue({});

      const r = await service.bulkUpdateStatus(ORG_ID, ['e1', 'e1', 'e1'], 'sent');
      expect(r.updated).toBe(1);
      expect(prisma.estimate.update).toHaveBeenCalledTimes(1);
    });
  });

  // ─── delete ────────────────────────────────────────────────
  describe('delete', () => {
    it('refuses to delete a non-draft estimate', async () => {
      (prisma.estimate.findFirst as jest.Mock).mockResolvedValue({
        id: 'e1',
        status: 'sent',
        items: [],
      });
      await expect(service.delete(ORG_ID, 'e1')).rejects.toThrow(
        BadRequestException,
      );
    });

    it('removes line items and the estimate, then emits estimate.deleted', async () => {
      (prisma.estimate.findFirst as jest.Mock).mockResolvedValue({
        id: 'e1',
        status: 'draft',
        items: [],
      });
      (prisma.estimateItem.deleteMany as jest.Mock).mockResolvedValue({});
      (prisma.estimate.delete as jest.Mock).mockResolvedValue({});

      await service.delete(ORG_ID, 'e1');

      expect(prisma.estimateItem.deleteMany).toHaveBeenCalledWith({
        where: { estimateId: 'e1' },
      });
      expect(prisma.estimate.delete).toHaveBeenCalledWith({ where: { id: 'e1' } });
      expect(events.emit).toHaveBeenCalledWith('estimate.deleted', {
        id: 'e1',
        orgId: ORG_ID,
      });
    });
  });

  // ─── send ──────────────────────────────────────────────────
  describe('send', () => {
    it('refuses to send a non-draft estimate', async () => {
      (prisma.estimate.findFirst as jest.Mock).mockResolvedValue({
        id: 'e1',
        status: 'sent',
        items: [],
      });
      await expect(service.send(ORG_ID, 'e1')).rejects.toThrow(
        BadRequestException,
      );
    });
  });

  // ─── convertToInvoice ──────────────────────────────────────
  describe('convertToInvoice', () => {
    it('creates an invoice, copies items, marks estimate accepted, and emits estimate.converted', async () => {
      const estimate = {
        id: 'e1',
        clientId: 'c1',
        subTotal: 100,
        totalTax: 10,
        discount: 0,
        total: 110,
        clientNote: 'note',
        terms: null,
        status: 'sent',
        items: [
          { description: 'x', qty: 1, rate: 100, productId: null, order: 0 },
        ],
      };
      (prisma.estimate.findFirst as jest.Mock).mockResolvedValue(estimate);
      (prisma.invoice.count as jest.Mock).mockResolvedValue(7);
      const newInv = { id: 'inv_1', number: 'INV-0008' };
      (prisma.invoice.create as jest.Mock).mockResolvedValue(newInv);
      (prisma.invoiceItem.createMany as jest.Mock).mockResolvedValue({ count: 1 });
      (prisma.estimate.update as jest.Mock).mockResolvedValue({});
      (prisma.invoice.findUnique as jest.Mock).mockResolvedValue(newInv);

      const result = await service.convertToInvoice(ORG_ID, 'e1', USER_ID);

      expect(prisma.invoice.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            number: 'INV-0008',
            clientId: 'c1',
            total: 110,
            status: 'draft',
          }),
        }),
      );
      expect(prisma.estimate.update).toHaveBeenCalledWith({
        where: { id: 'e1' },
        data: { status: 'accepted', convertedToInvoiceId: 'inv_1' },
      });
      expect(events.emit).toHaveBeenCalledWith(
        'estimate.converted',
        expect.objectContaining({
          estimateId: 'e1',
          invoice: newInv,
          orgId: ORG_ID,
        }),
      );
      expect(result).toBe(newInv);
    });
  });

  // ─── duplicate ─────────────────────────────────────────────
  describe('duplicate', () => {
    it('creates a fresh draft from a source estimate and emits estimate.created', async () => {
      const src = {
        id: 'e1',
        clientId: 'c1',
        subTotal: 50,
        totalTax: 5,
        discount: 0,
        total: 55,
        clientNote: null,
        terms: null,
        status: 'accepted',
        items: [{ description: 'x', qty: 1, rate: 50, order: 0 }],
      };
      (prisma.estimate.findFirst as jest.Mock).mockResolvedValue(src);
      (prisma.estimate.count as jest.Mock).mockResolvedValue(2);
      const dup = { id: 'e2', number: 'EST-0003' };
      (prisma.estimate.create as jest.Mock).mockResolvedValue(dup);

      const result = await service.duplicate(ORG_ID, 'e1', USER_ID);

      expect(prisma.estimate.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            number: 'EST-0003',
            status: 'draft',
            total: 55,
          }),
        }),
      );
      expect(events.emit).toHaveBeenCalledWith(
        'estimate.created',
        expect.objectContaining({
          estimate: dup,
          duplicatedFrom: 'e1',
        }),
      );
      expect(result).toBe(dup);
    });
  });

  // ─── getStats ──────────────────────────────────────────────
  describe('getStats', () => {
    it('returns counts grouped by status', async () => {
      (prisma.estimate.count as jest.Mock)
        .mockResolvedValueOnce(1) // draft
        .mockResolvedValueOnce(2) // sent
        .mockResolvedValueOnce(3) // accepted
        .mockResolvedValueOnce(4) // declined
        .mockResolvedValueOnce(5); // expired

      const stats = await service.getStats(ORG_ID);
      expect(stats).toEqual({
        draft: 1,
        sent: 2,
        accepted: 3,
        declined: 4,
        expired: 5,
      });
    });
  });
});
