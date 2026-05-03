import { BadRequestException, NotFoundException } from '@nestjs/common';
import { createMock, DeepMocked } from '@golevelup/ts-jest';
import { ProductsService } from './products.service';
import { PrismaService } from '../../database/prisma.service';

function makeWithOrganization(prisma: DeepMocked<PrismaService>) {
  return jest
    .fn()
    .mockImplementation(async (_orgId: string, fn: (tx: any) => any) =>
      fn(prisma as any),
    );
}

describe('ProductsService', () => {
  let service: ProductsService;
  let prisma: DeepMocked<PrismaService>;

  const ORG_ID = 'org_p';

  beforeEach(() => {
    prisma = createMock<PrismaService>();
    (prisma.withOrganization as any) = makeWithOrganization(prisma);
    service = new ProductsService(prisma);
  });

  // ─── adjustStock ──────────────────────────────────────────────
  describe('adjustStock', () => {
    it('rejects zero / non-finite delta', async () => {
      await expect(
        service.adjustStock(ORG_ID, 'p1', 0, 'manual_adjustment'),
      ).rejects.toThrow(BadRequestException);
      await expect(
        service.adjustStock(ORG_ID, 'p1', NaN, 'manual_adjustment'),
      ).rejects.toThrow(BadRequestException);
    });

    it('throws NotFoundException when product is missing', async () => {
      (prisma.product.findFirst as jest.Mock).mockResolvedValue(null);
      await expect(
        service.adjustStock(ORG_ID, 'p1', 5, 'manual_adjustment'),
      ).rejects.toThrow(NotFoundException);
    });

    it('rejects when product has trackInventory=false', async () => {
      (prisma.product.findFirst as jest.Mock).mockResolvedValue({
        id: 'p1',
        stockQuantity: 10,
        trackInventory: false,
      });
      await expect(
        service.adjustStock(ORG_ID, 'p1', 1, 'manual_adjustment'),
      ).rejects.toThrow(/does not track inventory/);
    });

    it('rejects negative balance unless reason is "correction"', async () => {
      (prisma.product.findFirst as jest.Mock).mockResolvedValue({
        id: 'p1',
        stockQuantity: 3,
        trackInventory: true,
      });

      await expect(
        service.adjustStock(ORG_ID, 'p1', -5, 'manual_adjustment'),
      ).rejects.toThrow(/negative/);

      // But correction is allowed — even into negative
      (prisma.product.update as jest.Mock).mockResolvedValue({
        id: 'p1',
        stockQuantity: -2,
      });
      (prisma.stockMovement.create as jest.Mock).mockResolvedValue({});
      const out = await service.adjustStock(
        ORG_ID,
        'p1',
        -5,
        'correction',
      );
      expect(out.product.stockQuantity).toBe(-2);
    });

    it('writes a StockMovement row with correct delta + balanceAfter', async () => {
      (prisma.product.findFirst as jest.Mock).mockResolvedValue({
        id: 'p1',
        stockQuantity: 7,
        trackInventory: true,
      });
      (prisma.product.update as jest.Mock).mockResolvedValue({
        id: 'p1',
        stockQuantity: 12,
      });
      (prisma.stockMovement.create as jest.Mock).mockResolvedValue({
        id: 'm1',
      });

      await service.adjustStock(
        ORG_ID,
        'p1',
        5.7, // truncated to 5
        'purchase',
        'user1',
        'restock',
        { invoiceId: 'inv1' },
      );

      expect(prisma.stockMovement.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          productId: 'p1',
          delta: 5,
          balanceAfter: 12,
          reason: 'purchase',
          userId: 'user1',
          note: 'restock',
          invoiceId: 'inv1',
        }),
      });
    });
  });

  // ─── @OnEvent('invoice.sent') ─────────────────────────────────
  describe('onInvoiceSent', () => {
    it('decrements stock when productId is set + product tracks inventory', async () => {
      // First call (product lookup by FK)
      (prisma.product.findFirst as jest.Mock).mockResolvedValue({
        id: 'p1',
        trackInventory: true,
      });

      // adjustStock paths
      const adjustSpy = jest
        .spyOn(service, 'adjustStock')
        .mockResolvedValue({} as any);

      await service.onInvoiceSent({
        invoice: {
          id: 'inv1',
          organizationId: ORG_ID,
          items: [{ description: 'X', qty: 3, productId: 'p1' }],
        },
        orgId: ORG_ID,
      });

      expect(adjustSpy).toHaveBeenCalledWith(
        ORG_ID,
        'p1',
        -3,
        'invoice_sent',
        undefined,
        expect.stringContaining('Auto-decrement'),
        { invoiceId: 'inv1' },
      );
    });

    it('falls back to description match when productId is null', async () => {
      // FK lookup not attempted (productId null)
      (prisma.product.findFirst as jest.Mock).mockResolvedValueOnce({
        id: 'p2',
        trackInventory: true,
      });
      const adjustSpy = jest
        .spyOn(service, 'adjustStock')
        .mockResolvedValue({} as any);

      await service.onInvoiceSent({
        invoice: {
          id: 'inv2',
          organizationId: ORG_ID,
          items: [{ description: 'Widget A', qty: 2 }],
        },
        orgId: ORG_ID,
      });

      // findFirst was called with the description in `name` filter
      const call = (prisma.product.findFirst as jest.Mock).mock.calls[0][0];
      expect(call.where.name).toEqual({
        equals: 'Widget A',
        mode: 'insensitive',
      });
      expect(adjustSpy).toHaveBeenCalledWith(
        ORG_ID,
        'p2',
        -2,
        'invoice_sent',
        undefined,
        expect.any(String),
        { invoiceId: 'inv2' },
      );
    });

    it('skips items with non-positive qty', async () => {
      const adjustSpy = jest
        .spyOn(service, 'adjustStock')
        .mockResolvedValue({} as any);

      await service.onInvoiceSent({
        invoice: {
          id: 'inv',
          organizationId: ORG_ID,
          items: [
            { description: 'X', qty: 0, productId: 'p1' },
            { description: 'Y', qty: -1, productId: 'p2' },
          ],
        },
        orgId: ORG_ID,
      });

      expect(adjustSpy).not.toHaveBeenCalled();
    });

    it('logs a warning but never throws when stock would go negative', async () => {
      (prisma.product.findFirst as jest.Mock).mockResolvedValue({
        id: 'p1',
        trackInventory: true,
      });
      jest
        .spyOn(service, 'adjustStock')
        .mockRejectedValue(new BadRequestException('negative'));

      await expect(
        service.onInvoiceSent({
          invoice: {
            id: 'inv',
            organizationId: ORG_ID,
            items: [{ description: 'X', qty: 100, productId: 'p1' }],
          },
          orgId: ORG_ID,
        }),
      ).resolves.toBeUndefined();
    });

    it('is a no-op when product lacks trackInventory', async () => {
      (prisma.product.findFirst as jest.Mock).mockResolvedValue({
        id: 'p1',
        trackInventory: false,
      });
      const adjustSpy = jest
        .spyOn(service, 'adjustStock')
        .mockResolvedValue({} as any);

      await service.onInvoiceSent({
        invoice: {
          id: 'inv',
          organizationId: ORG_ID,
          items: [{ description: 'X', qty: 2, productId: 'p1' }],
        },
        orgId: ORG_ID,
      });

      expect(adjustSpy).not.toHaveBeenCalled();
    });

    it('handles missing invoice gracefully', async () => {
      await expect(
        service.onInvoiceSent({ invoice: null, orgId: ORG_ID }),
      ).resolves.toBeUndefined();
    });
  });

  // ─── getLowStock ──────────────────────────────────────────────
  describe('getLowStock', () => {
    it('uses raw SQL filtering on stockQuantity <= lowStockAlert', async () => {
      (prisma.$queryRaw as jest.Mock).mockResolvedValue([
        { id: 'p1', name: 'Foo', stockQuantity: 1 },
      ]);
      const out = await service.getLowStock(ORG_ID);
      expect(prisma.$queryRaw).toHaveBeenCalled();
      expect(out).toHaveLength(1);
    });
  });
});
