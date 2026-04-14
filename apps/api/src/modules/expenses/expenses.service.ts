import {
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service';
import { EventEmitter2 } from '@nestjs/event-emitter';

export interface CreateExpenseDto {
  name: string;
  amount: number;
  date: string;
  categoryId?: string;
  clientId?: string;
  projectId?: string;
  currency?: string;
  note?: string;
  billable?: boolean;
}

@Injectable()
export class ExpensesService {
  constructor(
    private prisma: PrismaService,
    private events: EventEmitter2,
  ) {}

  // ─── Categories ────────────────────────────────────────────────────────────

  async getCategories(orgId: string) {
    return this.prisma.withOrganization(orgId, async (tx) => {
      return tx.expenseCategory.findMany({
        where: { organizationId: orgId },
        orderBy: { name: 'asc' },
        include: {
          _count: { select: { expenses: true } },
        },
      });
    });
  }

  async createCategory(orgId: string, name: string, color?: string) {
    return this.prisma.withOrganization(orgId, async (tx) => {
      return tx.expenseCategory.create({
        data: {
          organizationId: orgId,
          name,
          color: color ?? null,
        },
      });
    });
  }

  // ─── findAll ───────────────────────────────────────────────────────────────

  async findAll(
    orgId: string,
    query: {
      search?: string;
      categoryId?: string;
      clientId?: string;
      projectId?: string;
      billable?: boolean;
      page?: number;
      limit?: number;
    },
  ) {
    const {
      search,
      categoryId,
      clientId,
      projectId,
      billable,
      page = 1,
      limit = 20,
    } = query;
    const skip = (page - 1) * limit;

    return this.prisma.withOrganization(orgId, async (tx) => {
      const where: any = { organizationId: orgId };
      if (categoryId) where.categoryId = categoryId;
      if (clientId) where.clientId = clientId;
      if (projectId) where.projectId = projectId;
      if (billable !== undefined) where.billable = billable;
      if (search) {
        where.OR = [
          { name: { contains: search, mode: 'insensitive' } },
          { note: { contains: search, mode: 'insensitive' } },
        ];
      }

      const [data, total] = await Promise.all([
        tx.expense.findMany({
          where,
          skip,
          take: limit,
          orderBy: { date: 'desc' },
          include: {
            category: { select: { id: true, name: true, color: true } },
            client: { select: { id: true, company: true } },
            project: { select: { id: true, name: true } },
          },
        }),
        tx.expense.count({ where }),
      ]);

      return { data, total, page, limit, totalPages: Math.ceil(total / limit) };
    });
  }

  // ─── findOne ───────────────────────────────────────────────────────────────

  async findOne(orgId: string, id: string) {
    return this.prisma.withOrganization(orgId, async (tx) => {
      const expense = await tx.expense.findFirst({
        where: { id, organizationId: orgId },
        include: {
          category: true,
          client: true,
          project: true,
          createdByUser: { select: { id: true, name: true, email: true } },
        },
      });
      if (!expense) throw new NotFoundException('Expense not found');
      return expense;
    });
  }

  // ─── create ────────────────────────────────────────────────────────────────

  async create(orgId: string, dto: CreateExpenseDto, createdBy: string) {
    const expense = await this.prisma.withOrganization(orgId, async (tx) => {
      return tx.expense.create({
        data: {
          organizationId: orgId,
          name: dto.name,
          amount: dto.amount,
          date: new Date(dto.date),
          categoryId: dto.categoryId ?? null,
          clientId: dto.clientId ?? null,
          projectId: dto.projectId ?? null,
          currency: dto.currency ?? 'USD',
          note: dto.note ?? null,
          billable: dto.billable ?? false,
          invoiced: false,
          createdBy,
        },
        include: {
          category: { select: { id: true, name: true, color: true } },
          client: { select: { id: true, company: true } },
          project: { select: { id: true, name: true } },
        },
      });
    });

    this.events.emit('expense.created', { expense, orgId, createdBy });
    return expense;
  }

  // ─── update ────────────────────────────────────────────────────────────────

  async update(orgId: string, id: string, dto: Partial<CreateExpenseDto>) {
    await this.findOne(orgId, id);

    return this.prisma.withOrganization(orgId, async (tx) => {
      return tx.expense.update({
        where: { id },
        data: {
          ...(dto.name !== undefined && { name: dto.name }),
          ...(dto.amount !== undefined && { amount: dto.amount }),
          ...(dto.date !== undefined && { date: new Date(dto.date) }),
          ...(dto.categoryId !== undefined && { categoryId: dto.categoryId }),
          ...(dto.clientId !== undefined && { clientId: dto.clientId }),
          ...(dto.projectId !== undefined && { projectId: dto.projectId }),
          ...(dto.currency !== undefined && { currency: dto.currency }),
          ...(dto.note !== undefined && { note: dto.note }),
          ...(dto.billable !== undefined && { billable: dto.billable }),
        },
        include: {
          category: { select: { id: true, name: true, color: true } },
          client: { select: { id: true, company: true } },
          project: { select: { id: true, name: true } },
        },
      });
    });
  }

  // ─── delete ────────────────────────────────────────────────────────────────

  async delete(orgId: string, id: string) {
    await this.findOne(orgId, id);
    await this.prisma.withOrganization(orgId, async (tx) => {
      await tx.expense.delete({ where: { id } });
    });
    this.events.emit('expense.deleted', { id, orgId });
  }

  // ─── getStats ─────────────────────────────────────────────────────────────

  async getStats(orgId: string, month?: string) {
    return this.prisma.withOrganization(orgId, async (tx) => {
      let startDate: Date;
      let endDate: Date;

      if (month) {
        // Expect format YYYY-MM
        const [year, mon] = month.split('-').map(Number);
        startDate = new Date(year, mon - 1, 1);
        endDate = new Date(year, mon, 0, 23, 59, 59, 999);
      } else {
        const now = new Date();
        startDate = new Date(now.getFullYear(), now.getMonth(), 1);
        endDate = new Date(
          now.getFullYear(),
          now.getMonth() + 1,
          0,
          23,
          59,
          59,
          999,
        );
      }

      const dateFilter = { gte: startDate, lte: endDate };

      const [totalAgg, billableAgg, byCategory] = await Promise.all([
        // Total expenses this month
        tx.expense.aggregate({
          where: { organizationId: orgId, date: dateFilter },
          _sum: { amount: true },
          _count: { id: true },
        }),

        // Billable total this month
        tx.expense.aggregate({
          where: { organizationId: orgId, date: dateFilter, billable: true },
          _sum: { amount: true },
        }),

        // By-category breakdown
        tx.expense.groupBy({
          by: ['categoryId'],
          where: { organizationId: orgId, date: dateFilter },
          _sum: { amount: true },
          _count: { id: true },
          orderBy: { _sum: { amount: 'desc' } },
        }),
      ]);

      // Resolve category names
      const categoryIds = byCategory
        .map((r: any) => r.categoryId)
        .filter(Boolean);
      const categories =
        categoryIds.length > 0
          ? await tx.expenseCategory.findMany({
              where: { id: { in: categoryIds } },
              select: { id: true, name: true, color: true },
            })
          : [];

      const categoryMap = new Map(
        (categories as any[]).map((c: any) => [c.id, c]),
      );

      const breakdown = (byCategory as any[]).map((row: any) => ({
        categoryId: row.categoryId,
        category: row.categoryId ? categoryMap.get(row.categoryId) ?? null : null,
        total: Number(row._sum.amount ?? 0),
        count: row._count.id,
      }));

      return {
        totalExpenses: Number(totalAgg._sum.amount ?? 0),
        totalCount: totalAgg._count.id,
        billableTotal: Number(billableAgg._sum.amount ?? 0),
        breakdown,
        period: { start: startDate, end: endDate },
      };
    });
  }
}
