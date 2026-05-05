import {
  BadRequestException,
  ConflictException,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { createMock, DeepMocked } from '@golevelup/ts-jest';
import { CreditNotesService } from './credit-notes.service';
import { PrismaService } from '../../database/prisma.service';
import { PdfService } from '../pdf/pdf.service';

function makeWithOrganization(prisma: DeepMocked<PrismaService>) {
  return jest
    .fn()
    .mockImplementation(async (_orgId: string, fn: (tx: any) => any) =>
      fn(prisma as any),
    );
}

describe('CreditNotesService', () => {
  let service: CreditNotesService;
  let prisma: DeepMocked<PrismaService>;
  let events: DeepMocked<EventEmitter2>;
  let pdf: DeepMocked<PdfService>;

  const ORG_ID = 'org_abc';
  const USER_ID = 'user_123';

  beforeEach(() => {
    prisma = createMock<PrismaService>();
    events = createMock<EventEmitter2>();
    pdf = createMock<PdfService>();
    (prisma.withOrganization as any) = makeWithOrganization(prisma);
    service = new CreditNotesService(prisma, events, pdf);
  });

  describe('create', () => {
    it('computes totals and emits credit_note.created', async () => {
      // 2 lines: 2*10 (10% tax)=22, 1*5 (no tax)=5 → subTotal 25, tax 2, total 27
      (prisma.creditNote.count as jest.Mock).mockResolvedValue(0);
      const created = { id: 'cn_1', number: 'CN-0001' };
      (prisma.creditNote.create as jest.Mock).mockResolvedValue(created);

      await service.create(
        ORG_ID,
        {
          date: '2025-01-01',
          items: [
            { description: 'a', quantity: 2, unitPrice: 10, taxRate: 10 },
            { description: 'b', quantity: 1, unitPrice: 5 },
          ],
        },
        USER_ID,
      );

      expect(prisma.creditNote.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            number: 'CN-0001',
            subTotal: 25,
            totalTax: 2,
            total: 27,
            remainingAmount: 27,
            status: 'open',
          }),
        }),
      );
      expect(events.emit).toHaveBeenCalledWith(
        'credit_note.created',
        expect.objectContaining({ creditNote: created }),
      );
    });
  });

  describe('void', () => {
    it('refuses to void an already-voided credit note', async () => {
      (prisma.creditNote.findFirst as jest.Mock).mockResolvedValue({
        id: 'cn_1',
        status: 'void',
        items: [],
      });
      await expect(service.void(ORG_ID, 'cn_1')).rejects.toThrow(
        BadRequestException,
      );
    });

    it('refuses to void an applied credit note', async () => {
      (prisma.creditNote.findFirst as jest.Mock).mockResolvedValue({
        id: 'cn_1',
        status: 'applied',
        items: [],
      });
      await expect(service.void(ORG_ID, 'cn_1')).rejects.toThrow(
        /Applied credit notes/,
      );
    });

    it('flips status to void and emits credit_note.voided', async () => {
      (prisma.creditNote.findFirst as jest.Mock).mockResolvedValue({
        id: 'cn_1',
        status: 'open',
        items: [],
      });
      const voided = { id: 'cn_1', status: 'void' };
      (prisma.creditNote.update as jest.Mock).mockResolvedValue(voided);

      const r = await service.void(ORG_ID, 'cn_1');
      expect(r).toBe(voided);
      expect(events.emit).toHaveBeenCalledWith(
        'credit_note.voided',
        expect.objectContaining({ creditNote: voided }),
      );
    });
  });

  describe('apply', () => {
    it('refuses to apply anything other than an open credit note', async () => {
      (prisma.creditNote.findFirst as jest.Mock).mockResolvedValue({
        id: 'cn_1',
        status: 'closed',
        items: [],
      });
      await expect(service.apply(ORG_ID, 'cn_1')).rejects.toThrow(
        /Only open credit notes/,
      );
    });
  });

  describe('applyToInvoice', () => {
    it('refuses to apply a void credit note', async () => {
      (prisma.creditNote.findFirst as jest.Mock).mockResolvedValue({
        id: 'cn_1',
        status: 'void',
        items: [],
        total: 50,
      });
      await expect(
        service.applyToInvoice(ORG_ID, 'cn_1', 'inv_1'),
      ).rejects.toThrow(ConflictException);
    });

    it('refuses when the credit note has zero remaining balance', async () => {
      (prisma.creditNote.findFirst as jest.Mock).mockResolvedValue({
        id: 'cn_1',
        status: 'open',
        items: [],
        total: 50,
        appliedTotal: 50,
      });
      await expect(
        service.applyToInvoice(ORG_ID, 'cn_1', 'inv_1'),
      ).rejects.toThrow(/no remaining balance/);
    });

    it('refuses when the invoice belongs to a different client than the credit note', async () => {
      (prisma.creditNote.findFirst as jest.Mock).mockResolvedValue({
        id: 'cn_1',
        status: 'open',
        items: [],
        total: 50,
        appliedTotal: 0,
        clientId: 'client_a',
      });
      // The same mock is used for invoice lookup inside the txn
      (prisma.invoice.findFirst as jest.Mock).mockResolvedValue({
        id: 'inv_1',
        clientId: 'client_b',
        total: 100,
        payments: [],
      });

      await expect(
        service.applyToInvoice(ORG_ID, 'cn_1', 'inv_1'),
      ).rejects.toThrow(/different clients/);
    });

    it('caps the application amount at min(invoice remaining, credit remaining)', async () => {
      // Credit remaining 80; invoice remaining 30 → apply 30, mark partial
      (prisma.creditNote.findFirst as jest.Mock).mockResolvedValue({
        id: 'cn_1',
        number: 'CN-0001',
        status: 'open',
        items: [],
        total: 100,
        appliedTotal: 20,
        currency: 'USD',
        clientId: 'c1',
      });
      (prisma.invoice.findFirst as jest.Mock).mockResolvedValue({
        id: 'inv_1',
        clientId: 'c1',
        total: 100,
        payments: [{ amount: 70 }],
        currency: 'USD',
      });
      (prisma.payment.create as jest.Mock).mockResolvedValue({});
      (prisma.invoice.update as jest.Mock).mockResolvedValue({});
      (prisma.creditNote.update as jest.Mock).mockResolvedValue({
        id: 'cn_1',
        appliedTotal: 50,
      });

      const r = await service.applyToInvoice(ORG_ID, 'cn_1', 'inv_1');
      expect(r.amountApplied).toBe(30);
      // Net 100, total 100 → invoice fully paid
      expect(r.invoiceStatus).toBe('paid');
      // CN remaining was 80 → 50 left after 30 applied → status stays open (not fully applied)
      expect(prisma.creditNote.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'cn_1' },
          data: expect.objectContaining({ appliedTotal: 50 }),
        }),
      );
    });

    it('marks the credit note "applied" once the entire balance is consumed', async () => {
      (prisma.creditNote.findFirst as jest.Mock).mockResolvedValue({
        id: 'cn_1',
        number: 'CN-0001',
        status: 'open',
        items: [],
        total: 50,
        appliedTotal: 0,
        currency: 'USD',
        clientId: 'c1',
      });
      (prisma.invoice.findFirst as jest.Mock).mockResolvedValue({
        id: 'inv_1',
        clientId: 'c1',
        total: 100,
        payments: [],
        currency: 'USD',
      });
      (prisma.payment.create as jest.Mock).mockResolvedValue({});
      (prisma.invoice.update as jest.Mock).mockResolvedValue({});
      (prisma.creditNote.update as jest.Mock).mockImplementation(
        async ({ data }: any) => ({ id: 'cn_1', ...data }),
      );

      const r = await service.applyToInvoice(ORG_ID, 'cn_1', 'inv_1');

      expect(r.amountApplied).toBe(50);
      expect(prisma.creditNote.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ status: 'applied', appliedTotal: 50 }),
        }),
      );
    });

    it('translates a missing-column P2022 error to ServiceUnavailableException', async () => {
      (prisma.creditNote.findFirst as jest.Mock).mockResolvedValue({
        id: 'cn_1',
        status: 'open',
        items: [],
        total: 50,
        appliedTotal: 0,
        clientId: 'c1',
      });
      const err: any = new Error('column "appliedTotal" does not exist');
      err.code = 'P2022';
      (prisma.invoice.findFirst as jest.Mock).mockRejectedValue(err);

      await expect(
        service.applyToInvoice(ORG_ID, 'cn_1', 'inv_1'),
      ).rejects.toThrow(ServiceUnavailableException);
    });
  });

  describe('bulkUpdateStatus', () => {
    it('rejects an unsupported status', async () => {
      await expect(
        service.bulkUpdateStatus(ORG_ID, ['cn_1'], 'applied'),
      ).rejects.toThrow(BadRequestException);
    });

    it('skips already-applied credit notes', async () => {
      (prisma.creditNote.findMany as jest.Mock).mockResolvedValue([
        { id: 'cn_1', status: 'applied' },
      ]);

      const r = await service.bulkUpdateStatus(ORG_ID, ['cn_1'], 'closed');
      expect(r.updated).toBe(0);
      expect(r.skipped[0].reason).toMatch(/applied credit notes/);
    });

    it('refuses to mutate void credit notes', async () => {
      (prisma.creditNote.findMany as jest.Mock).mockResolvedValue([
        { id: 'cn_1', status: 'void' },
      ]);
      const r = await service.bulkUpdateStatus(ORG_ID, ['cn_1'], 'open');
      expect(r.updated).toBe(0);
      expect(r.skipped[0].reason).toMatch(/terminal/);
    });

    it('updates open → closed and emits credit_note.status_changed', async () => {
      (prisma.creditNote.findMany as jest.Mock).mockResolvedValue([
        { id: 'cn_1', status: 'open' },
      ]);
      (prisma.creditNote.update as jest.Mock).mockResolvedValue({});

      const r = await service.bulkUpdateStatus(ORG_ID, ['cn_1'], 'closed');
      expect(r.updated).toBe(1);
      expect(events.emit).toHaveBeenCalledWith(
        'credit_note.status_changed',
        expect.objectContaining({ previousStatus: 'open', newStatus: 'closed' }),
      );
    });
  });

  describe('delete', () => {
    it('refuses to delete a non-draft credit note', async () => {
      (prisma.creditNote.findFirst as jest.Mock).mockResolvedValue({
        id: 'cn_1',
        status: 'open',
        items: [],
      });
      await expect(service.delete(ORG_ID, 'cn_1')).rejects.toThrow(
        BadRequestException,
      );
    });
  });

  describe('findOne', () => {
    it('throws NotFoundException when missing', async () => {
      (prisma.creditNote.findFirst as jest.Mock).mockResolvedValue(null);
      await expect(service.findOne(ORG_ID, 'nope')).rejects.toThrow(
        NotFoundException,
      );
    });
  });
});
