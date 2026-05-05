import {
  BadRequestException,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { createMock, DeepMocked } from '@golevelup/ts-jest';
import { SubscriptionsService } from './subscriptions.service';
import { PrismaService } from '../../database/prisma.service';

function makeWithOrganization(prisma: DeepMocked<PrismaService>) {
  return jest
    .fn()
    .mockImplementation(async (_orgId: string, fn: (tx: any) => any) =>
      fn(prisma as any),
    );
}

describe('SubscriptionsService', () => {
  let service: SubscriptionsService;
  let prisma: DeepMocked<PrismaService>;
  let events: DeepMocked<EventEmitter2>;

  const ORG_ID = 'org_abc';

  beforeEach(() => {
    prisma = createMock<PrismaService>();
    events = createMock<EventEmitter2>();
    (prisma.withOrganization as any) = makeWithOrganization(prisma);
    service = new SubscriptionsService(prisma, events);
  });

  describe('create', () => {
    it('rejects when clientId is missing', async () => {
      await expect(
        service.create(ORG_ID, {
          clientId: '',
          name: 'Plan',
          unitPrice: 10,
        } as any),
      ).rejects.toThrow(/clientId/);
    });

    it('rejects when name is missing', async () => {
      await expect(
        service.create(ORG_ID, {
          clientId: 'c1',
          name: '',
          unitPrice: 10,
        } as any),
      ).rejects.toThrow(/name/);
    });

    it('rejects when unitPrice is undefined', async () => {
      await expect(
        service.create(ORG_ID, {
          clientId: 'c1',
          name: 'Plan',
        } as any),
      ).rejects.toThrow(/unitPrice/);
    });

    it('defaults interval to "month" when none is provided and computes total = unitPrice*qty', async () => {
      const created = { id: 's1', total: 200 };
      (prisma.clientSubscription.create as jest.Mock).mockResolvedValue(
        created,
      );

      await service.create(ORG_ID, {
        clientId: 'c1',
        name: 'Plan',
        unitPrice: 100,
        quantity: 2,
      });

      const data = (prisma.clientSubscription.create as jest.Mock).mock
        .calls[0][0].data;
      expect(data.interval).toBe('month');
      expect(data.intervalCount).toBe(1);
      expect(data.total).toBe(200);
      expect(data.status).toBe('active');
      expect(data.nextInvoiceAt).toBeInstanceOf(Date);
    });

    it('falls back to "month" when interval is invalid', async () => {
      (prisma.clientSubscription.create as jest.Mock).mockResolvedValue({});
      await service.create(ORG_ID, {
        clientId: 'c1',
        name: 'Plan',
        unitPrice: 5,
        interval: 'fortnight' as any,
      });
      const data = (prisma.clientSubscription.create as jest.Mock).mock
        .calls[0][0].data;
      expect(data.interval).toBe('month');
    });

    it('translates a missing-column P2022 error to ServiceUnavailableException', async () => {
      const err: any = new Error('column "interval" does not exist');
      err.code = 'P2022';
      (prisma.clientSubscription.create as jest.Mock).mockRejectedValue(err);

      await expect(
        service.create(ORG_ID, {
          clientId: 'c1',
          name: 'Plan',
          unitPrice: 10,
        }),
      ).rejects.toThrow(ServiceUnavailableException);
    });
  });

  describe('cancel', () => {
    it('throws NotFoundException for unknown subscription', async () => {
      (prisma.clientSubscription.findFirst as jest.Mock).mockResolvedValue(
        null,
      );
      await expect(service.cancel(ORG_ID, 's1')).rejects.toThrow(
        NotFoundException,
      );
    });

    it('stamps cancelledAt and sets status to cancelled', async () => {
      (prisma.clientSubscription.findFirst as jest.Mock).mockResolvedValue({
        id: 's1',
        status: 'active',
      });
      (prisma.clientSubscription.update as jest.Mock).mockResolvedValue({
        id: 's1',
        status: 'cancelled',
      });

      await service.cancel(ORG_ID, 's1');
      const data = (prisma.clientSubscription.update as jest.Mock).mock
        .calls[0][0].data;
      expect(data.status).toBe('cancelled');
      expect(data.cancelledAt).toBeInstanceOf(Date);
    });
  });

  describe('pause / resume', () => {
    it('pause sets status to paused', async () => {
      (prisma.clientSubscription.findFirst as jest.Mock).mockResolvedValue({
        id: 's1',
        status: 'active',
      });
      (prisma.clientSubscription.update as jest.Mock).mockResolvedValue({});

      await service.pause(ORG_ID, 's1');
      const data = (prisma.clientSubscription.update as jest.Mock).mock
        .calls[0][0].data;
      expect(data.status).toBe('paused');
    });

    it('resume sets status back to active', async () => {
      (prisma.clientSubscription.findFirst as jest.Mock).mockResolvedValue({
        id: 's1',
        status: 'paused',
      });
      (prisma.clientSubscription.update as jest.Mock).mockResolvedValue({});

      await service.resume(ORG_ID, 's1');
      const data = (prisma.clientSubscription.update as jest.Mock).mock
        .calls[0][0].data;
      expect(data.status).toBe('active');
    });
  });

  describe('runDueBilling', () => {
    it('returns skipped:true when nextInvoiceAt column is missing', async () => {
      const err: any = new Error('column "nextInvoiceAt" does not exist');
      err.code = 'P2022';
      (prisma.clientSubscription.findMany as jest.Mock).mockRejectedValue(err);

      const r = await service.runDueBilling();
      expect(r).toEqual({ processed: 0, skipped: true });
    });

    it('skips paused/cancelled subscriptions but processes active ones', async () => {
      const past = new Date(Date.now() - 1000);
      (prisma.clientSubscription.findMany as jest.Mock).mockResolvedValue([
        {
          id: 's_active',
          status: 'active',
          organizationId: ORG_ID,
          clientId: 'c1',
          name: 'Active Plan',
          quantity: 1,
          unitPrice: 50,
          interval: 'month',
          intervalCount: 1,
          nextInvoiceAt: past,
        },
        {
          id: 's_paused',
          status: 'paused',
          organizationId: ORG_ID,
          nextInvoiceAt: past,
        },
        {
          id: 's_cancelled',
          status: 'cancelled',
          organizationId: ORG_ID,
          nextInvoiceAt: past,
        },
      ]);
      (prisma.client.findFirst as jest.Mock).mockResolvedValue({
        id: 'c1',
        currencyId: 'cur_usd',
      });
      (prisma.invoice.count as jest.Mock).mockResolvedValue(0);
      const invoice = { id: 'inv_1', number: 'INV-0001' };
      (prisma.invoice.create as jest.Mock).mockResolvedValue(invoice);
      (prisma.clientSubscription.update as jest.Mock).mockResolvedValue({});

      const r = await service.runDueBilling();

      expect(r.processed).toBe(1);
      // Only the active sub should drive an invoice creation
      expect(prisma.invoice.create).toHaveBeenCalledTimes(1);
      // nextInvoiceAt advanced
      expect(prisma.clientSubscription.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 's_active' },
          data: expect.objectContaining({
            nextInvoiceAt: expect.any(Date),
          }),
        }),
      );
      expect(events.emit).toHaveBeenCalledWith(
        'subscription.invoiced',
        expect.objectContaining({ invoice }),
      );
    });

    it('continues processing the rest of the queue when one row throws', async () => {
      const past = new Date(Date.now() - 1000);
      (prisma.clientSubscription.findMany as jest.Mock).mockResolvedValue([
        {
          id: 's_bad',
          status: 'active',
          organizationId: ORG_ID,
          clientId: 'c_bad',
          name: 'Bad',
          quantity: 1,
          unitPrice: 10,
          interval: 'month',
          intervalCount: 1,
          nextInvoiceAt: past,
        },
        {
          id: 's_good',
          status: 'active',
          organizationId: ORG_ID,
          clientId: 'c_good',
          name: 'Good',
          quantity: 1,
          unitPrice: 20,
          interval: 'month',
          intervalCount: 1,
          nextInvoiceAt: past,
        },
      ]);
      (prisma.client.findFirst as jest.Mock).mockResolvedValue({
        id: 'c',
        currencyId: null,
      });
      (prisma.invoice.count as jest.Mock).mockResolvedValue(0);
      // First call throws, second succeeds
      (prisma.invoice.create as jest.Mock)
        .mockRejectedValueOnce(new Error('boom'))
        .mockResolvedValueOnce({ id: 'i', number: 'INV-0001' });
      (prisma.clientSubscription.update as jest.Mock).mockResolvedValue({});

      const r = await service.runDueBilling();
      expect(r.processed).toBe(1);
    });
  });
});
