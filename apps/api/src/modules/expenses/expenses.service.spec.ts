import { ConflictException, NotFoundException } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { createMock, DeepMocked } from '@golevelup/ts-jest';
import { ExpensesService } from './expenses.service';
import { PrismaService } from '../../database/prisma.service';

function makeWithOrganization(prisma: DeepMocked<PrismaService>) {
  return jest
    .fn()
    .mockImplementation(async (_orgId: string, fn: (tx: any) => any) =>
      fn(prisma as any),
    );
}

describe('ExpensesService', () => {
  let service: ExpensesService;
  let prisma: DeepMocked<PrismaService>;
  let events: DeepMocked<EventEmitter2>;

  const ORG_ID = 'org_abc';
  const USER_ID = 'user_123';

  beforeEach(() => {
    prisma = createMock<PrismaService>();
    events = createMock<EventEmitter2>();
    (prisma.withOrganization as any) = makeWithOrganization(prisma);
    service = new ExpensesService(prisma, events);
  });

  describe('create', () => {
    it('creates with sane defaults: USD, billable=false, invoiced=false', async () => {
      const created = { id: 'e1', name: 'Gas' };
      (prisma.expense.create as jest.Mock).mockResolvedValue(created);

      await service.create(
        ORG_ID,
        { name: 'Gas', amount: 50, date: '2025-01-01' },
        USER_ID,
      );

      expect(prisma.expense.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            name: 'Gas',
            amount: 50,
            currency: 'USD',
            billable: false,
            invoiced: false,
            createdBy: USER_ID,
          }),
        }),
      );
      expect(events.emit).toHaveBeenCalledWith(
        'expense.created',
        expect.objectContaining({ expense: created }),
      );
    });

    it('honours an explicit billable=true flag', async () => {
      (prisma.expense.create as jest.Mock).mockResolvedValue({});
      await service.create(
        ORG_ID,
        { name: 'Lunch', amount: 25, date: '2025-01-01', billable: true },
        USER_ID,
      );
      const data = (prisma.expense.create as jest.Mock).mock.calls[0][0].data;
      expect(data.billable).toBe(true);
    });

    it('parses recurring date fields into Date objects', async () => {
      (prisma.expense.create as jest.Mock).mockResolvedValue({});
      await service.create(
        ORG_ID,
        {
          name: 'Subscription',
          amount: 12,
          date: '2025-01-01',
          recurring: true,
          recurringType: 'monthly',
          recurringNextDate: '2025-02-01',
          recurringEndDate: '2025-12-31',
        },
        USER_ID,
      );
      const data = (prisma.expense.create as jest.Mock).mock.calls[0][0].data;
      expect(data.recurring).toBe(true);
      expect(data.recurringNextDate).toBeInstanceOf(Date);
      expect(data.recurringEndDate).toBeInstanceOf(Date);
    });
  });

  describe('findOne', () => {
    it('throws NotFoundException when the expense is missing', async () => {
      (prisma.expense.findFirst as jest.Mock).mockResolvedValue(null);
      await expect(service.findOne(ORG_ID, 'nope')).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('delete', () => {
    it('emits expense.deleted on success', async () => {
      (prisma.expense.findFirst as jest.Mock).mockResolvedValue({
        id: 'e1',
        organizationId: ORG_ID,
      });
      (prisma.expense.delete as jest.Mock).mockResolvedValue({});

      await service.delete(ORG_ID, 'e1');

      expect(prisma.expense.delete).toHaveBeenCalledWith({ where: { id: 'e1' } });
      expect(events.emit).toHaveBeenCalledWith('expense.deleted', {
        id: 'e1',
        orgId: ORG_ID,
      });
    });
  });

  describe('deleteCategory', () => {
    it('refuses to delete a category linked to expenses', async () => {
      (prisma.expenseCategory.findFirst as jest.Mock).mockResolvedValue({
        id: 'cat1',
        _count: { expenses: 3 },
      });
      await expect(service.deleteCategory(ORG_ID, 'cat1')).rejects.toThrow(
        ConflictException,
      );
      expect(prisma.expenseCategory.delete).not.toHaveBeenCalled();
    });

    it('deletes when the category has no expenses', async () => {
      (prisma.expenseCategory.findFirst as jest.Mock).mockResolvedValue({
        id: 'cat1',
        _count: { expenses: 0 },
      });
      (prisma.expenseCategory.delete as jest.Mock).mockResolvedValue({});

      const r = await service.deleteCategory(ORG_ID, 'cat1');
      expect(r).toEqual({ success: true });
    });

    it('throws NotFoundException for a missing category', async () => {
      (prisma.expenseCategory.findFirst as jest.Mock).mockResolvedValue(null);
      await expect(service.deleteCategory(ORG_ID, 'cat1')).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('getStats', () => {
    it('builds a category breakdown sorted by amount and resolves names', async () => {
      const startMonth = '2025-04';
      (prisma.expense.aggregate as jest.Mock)
        .mockResolvedValueOnce({ _sum: { amount: 500 }, _count: { id: 7 } }) // total
        .mockResolvedValueOnce({ _sum: { amount: 100 } }); // billable
      (prisma.expense.groupBy as jest.Mock).mockResolvedValue([
        { categoryId: 'cat_a', _sum: { amount: 300 }, _count: { id: 4 } },
        { categoryId: null, _sum: { amount: 200 }, _count: { id: 3 } },
      ]);
      (prisma.expenseCategory.findMany as jest.Mock).mockResolvedValue([
        { id: 'cat_a', name: 'Travel', color: '#aabbcc' },
      ]);

      const r = await service.getStats(ORG_ID, startMonth);
      expect(r.totalExpenses).toBe(500);
      expect(r.totalCount).toBe(7);
      expect(r.billableTotal).toBe(100);
      expect(r.breakdown).toHaveLength(2);
      expect(r.breakdown[0]).toEqual({
        categoryId: 'cat_a',
        category: { id: 'cat_a', name: 'Travel', color: '#aabbcc' },
        total: 300,
        count: 4,
      });
      // Null categoryId row produces null `category`
      expect(r.breakdown[1].category).toBeNull();
    });

    it('computes month range when no month param is given', async () => {
      (prisma.expense.aggregate as jest.Mock)
        .mockResolvedValueOnce({ _sum: { amount: 0 }, _count: { id: 0 } })
        .mockResolvedValueOnce({ _sum: { amount: 0 } });
      (prisma.expense.groupBy as jest.Mock).mockResolvedValue([]);

      const r = await service.getStats(ORG_ID);
      const start = r.period.start as Date;
      const end = r.period.end as Date;
      expect(start.getDate()).toBe(1);
      expect(end > start).toBe(true);
    });
  });

  describe('update', () => {
    it('only writes provided fields (partial update)', async () => {
      (prisma.expense.findFirst as jest.Mock).mockResolvedValue({ id: 'e1' });
      (prisma.expense.update as jest.Mock).mockResolvedValue({});

      await service.update(ORG_ID, 'e1', { name: 'New name' });
      const updateCall = (prisma.expense.update as jest.Mock).mock.calls[0][0];
      expect(updateCall.data).toEqual({ name: 'New name' });
    });
  });
});
