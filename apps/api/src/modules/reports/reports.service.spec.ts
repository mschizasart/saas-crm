import { createMock, DeepMocked } from '@golevelup/ts-jest';
import { ReportsService } from './reports.service';
import { PrismaService } from '../../database/prisma.service';

function makeWithOrganization(prisma: DeepMocked<PrismaService>) {
  return jest
    .fn()
    .mockImplementation(async (_orgId: string, fn: (tx: any) => any) =>
      fn(prisma as any),
    );
}

describe('ReportsService.getExpensesByCategory', () => {
  let service: ReportsService;
  let prisma: DeepMocked<PrismaService>;
  const ORG_ID = 'org_r';

  beforeEach(() => {
    prisma = createMock<PrismaService>();
    (prisma.withOrganization as any) = makeWithOrganization(prisma);
    service = new ReportsService(prisma);
  });

  it('groups expenses by categoryId, computes percentages summing to ~100%', async () => {
    (prisma.expense.groupBy as jest.Mock).mockResolvedValue([
      { categoryId: 'cat_a', currencyId: 'cur_usd', _sum: { amount: 600 }, _count: { _all: 6 } },
      { categoryId: 'cat_b', currencyId: 'cur_usd', _sum: { amount: 400 }, _count: { _all: 4 } },
    ]);
    (prisma.expenseCategory.findMany as jest.Mock).mockResolvedValue([
      { id: 'cat_a', name: 'Travel', color: '#f00' },
      { id: 'cat_b', name: 'Office', color: '#0f0' },
    ]);
    (prisma.currency.findMany as jest.Mock).mockResolvedValue([
      { id: 'cur_usd', code: 'USD', symbol: '$', name: 'US Dollar' },
    ]);
    (prisma.currency.findFirst as jest.Mock).mockResolvedValue({
      id: 'cur_usd',
      code: 'USD',
      symbol: '$',
      name: 'US Dollar',
    });

    const out = await service.getExpensesByCategory(ORG_ID, {});

    expect(out.grandTotal).toBe(1000);
    expect(out.byCategory).toHaveLength(2);
    expect(out.byCategory[0].categoryName).toBe('Travel');
    expect(out.byCategory[0].percentage).toBe(60);
    expect(out.byCategory[1].percentage).toBe(40);

    // Sum of percentages ≈ 100
    const sum = out.byCategory.reduce((s, r) => s + r.percentage, 0);
    expect(Math.abs(sum - 100)).toBeLessThanOrEqual(0.01);
  });

  it('handles uncategorized (categoryId=null) bucket', async () => {
    (prisma.expense.groupBy as jest.Mock).mockResolvedValue([
      { categoryId: null, currencyId: 'cur_usd', _sum: { amount: 250 }, _count: { _all: 3 } },
      { categoryId: 'cat_a', currencyId: 'cur_usd', _sum: { amount: 750 }, _count: { _all: 5 } },
    ]);
    (prisma.expenseCategory.findMany as jest.Mock).mockResolvedValue([
      { id: 'cat_a', name: 'Office', color: null },
    ]);
    (prisma.currency.findMany as jest.Mock).mockResolvedValue([
      { id: 'cur_usd', code: 'USD', symbol: '$', name: 'US Dollar' },
    ]);
    (prisma.currency.findFirst as jest.Mock).mockResolvedValue({
      id: 'cur_usd',
      code: 'USD',
      symbol: '$',
      name: 'US Dollar',
    });

    const out = await service.getExpensesByCategory(ORG_ID, {});

    expect(out.uncategorizedTotal).toBe(250);
    expect(out.uncategorizedCount).toBe(3);
    // Counts only categorised entries
    expect(out.categoryCount).toBe(1);
    const uncat = out.byCategory.find((r) => r.categoryId === null);
    expect(uncat).toBeDefined();
    expect(uncat!.categoryName).toBe('Uncategorized');
  });

  it('flags hasMixedCurrency=true when groups span multiple currencies', async () => {
    (prisma.expense.groupBy as jest.Mock).mockResolvedValue([
      { categoryId: 'cat_a', currencyId: 'cur_usd', _sum: { amount: 100 }, _count: { _all: 1 } },
      { categoryId: 'cat_a', currencyId: 'cur_eur', _sum: { amount: 50 }, _count: { _all: 1 } },
    ]);
    (prisma.expenseCategory.findMany as jest.Mock).mockResolvedValue([
      { id: 'cat_a', name: 'Travel', color: null },
    ]);
    (prisma.currency.findMany as jest.Mock).mockResolvedValue([
      { id: 'cur_usd', code: 'USD', symbol: '$', name: 'US Dollar' },
      { id: 'cur_eur', code: 'EUR', symbol: '€', name: 'Euro' },
    ]);
    (prisma.currency.findFirst as jest.Mock).mockResolvedValue({
      id: 'cur_usd',
      code: 'USD',
      symbol: '$',
      name: 'US Dollar',
    });

    const out = await service.getExpensesByCategory(ORG_ID, {});

    expect(out.hasMixedCurrency).toBe(true);
    const travel = out.byCategory.find((r) => r.categoryName === 'Travel')!;
    expect(travel.hasMixedCurrency).toBe(true);
    expect(travel.byCurrency.map((s) => s.currency)).toEqual(
      expect.arrayContaining(['USD', 'EUR']),
    );
  });

  it('does NOT flag mixed currency when only the org default currency is used', async () => {
    (prisma.expense.groupBy as jest.Mock).mockResolvedValue([
      { categoryId: 'cat_a', currencyId: 'cur_usd', _sum: { amount: 100 }, _count: { _all: 1 } },
      { categoryId: 'cat_b', currencyId: 'cur_usd', _sum: { amount: 50 }, _count: { _all: 1 } },
    ]);
    (prisma.expenseCategory.findMany as jest.Mock).mockResolvedValue([
      { id: 'cat_a', name: 'A', color: null },
      { id: 'cat_b', name: 'B', color: null },
    ]);
    (prisma.currency.findMany as jest.Mock).mockResolvedValue([
      { id: 'cur_usd', code: 'USD', symbol: '$', name: 'US Dollar' },
    ]);
    (prisma.currency.findFirst as jest.Mock).mockResolvedValue({
      id: 'cur_usd',
      code: 'USD',
      symbol: '$',
      name: 'US Dollar',
    });

    const out = await service.getExpensesByCategory(ORG_ID, {});
    expect(out.hasMixedCurrency).toBe(false);
  });

  it('returns 0% percentages on empty data set', async () => {
    (prisma.expense.groupBy as jest.Mock).mockResolvedValue([]);
    (prisma.expenseCategory.findMany as jest.Mock).mockResolvedValue([]);
    (prisma.currency.findMany as jest.Mock).mockResolvedValue([]);
    (prisma.currency.findFirst as jest.Mock).mockResolvedValue(null);

    const out = await service.getExpensesByCategory(ORG_ID, {});
    expect(out.grandTotal).toBe(0);
    expect(out.byCategory).toEqual([]);
    expect(out.uncategorizedTotal).toBe(0);
  });

  it('respects billable filter', async () => {
    (prisma.expense.groupBy as jest.Mock).mockResolvedValue([]);
    (prisma.expenseCategory.findMany as jest.Mock).mockResolvedValue([]);
    (prisma.currency.findMany as jest.Mock).mockResolvedValue([]);
    (prisma.currency.findFirst as jest.Mock).mockResolvedValue(null);

    await service.getExpensesByCategory(ORG_ID, { billable: true });
    const call = (prisma.expense.groupBy as jest.Mock).mock.calls[0][0];
    expect(call.where.billable).toBe(true);
  });

  it('respects clientId filter', async () => {
    (prisma.expense.groupBy as jest.Mock).mockResolvedValue([]);
    (prisma.expenseCategory.findMany as jest.Mock).mockResolvedValue([]);
    (prisma.currency.findMany as jest.Mock).mockResolvedValue([]);
    (prisma.currency.findFirst as jest.Mock).mockResolvedValue(null);

    await service.getExpensesByCategory(ORG_ID, { clientId: 'cli_1' });
    const call = (prisma.expense.groupBy as jest.Mock).mock.calls[0][0];
    expect(call.where.clientId).toBe('cli_1');
  });

  it('sorts categories by total descending', async () => {
    (prisma.expense.groupBy as jest.Mock).mockResolvedValue([
      { categoryId: 'cat_small', currencyId: 'cur_usd', _sum: { amount: 100 }, _count: { _all: 1 } },
      { categoryId: 'cat_big', currencyId: 'cur_usd', _sum: { amount: 800 }, _count: { _all: 4 } },
      { categoryId: 'cat_mid', currencyId: 'cur_usd', _sum: { amount: 200 }, _count: { _all: 2 } },
    ]);
    (prisma.expenseCategory.findMany as jest.Mock).mockResolvedValue([
      { id: 'cat_small', name: 'Small', color: null },
      { id: 'cat_big', name: 'Big', color: null },
      { id: 'cat_mid', name: 'Mid', color: null },
    ]);
    (prisma.currency.findMany as jest.Mock).mockResolvedValue([
      { id: 'cur_usd', code: 'USD', symbol: '$', name: 'US Dollar' },
    ]);
    (prisma.currency.findFirst as jest.Mock).mockResolvedValue({
      id: 'cur_usd',
      code: 'USD',
      symbol: '$',
      name: 'US Dollar',
    });

    const out = await service.getExpensesByCategory(ORG_ID, {});
    expect(out.byCategory.map((r) => r.categoryName)).toEqual([
      'Big',
      'Mid',
      'Small',
    ]);
  });
});
