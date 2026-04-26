import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../database/prisma.service';

export interface DateRangeQuery {
  from?: string;
  to?: string;
}

export interface SalesQuery extends DateRangeQuery {
  groupBy?: 'day' | 'week' | 'month';
}

export interface TimeTrackingQuery extends DateRangeQuery {
  projectId?: string;
  userId?: string;
}

/**
 * Parse optional from/to ISO strings with sensible defaults
 * (default range = last 12 months to now).
 */
function parseRange(q: DateRangeQuery): { from: Date; to: Date } {
  const to = q.to ? new Date(q.to) : new Date();
  const from = q.from
    ? new Date(q.from)
    : new Date(to.getFullYear(), to.getMonth() - 11, 1);
  return { from, to };
}

@Injectable()
export class ReportsService {
  constructor(private prisma: PrismaService) {}

  // ──────────────────────────────────────────────────────────────
  // 1. Sales report
  // ──────────────────────────────────────────────────────────────

  async getSalesReport(orgId: string, query: SalesQuery) {
    const { from, to } = parseRange(query);

    return this.prisma.withOrganization(orgId, async (tx) => {
      const baseWhere = {
        organizationId: orgId,
        date: { gte: from, lte: to },
      } as const;

      const [paidAgg, outstandingAgg, overdueAgg, revenueAgg] =
        await Promise.all([
          tx.invoice.aggregate({
            where: { ...baseWhere, status: 'paid' },
            _sum: { total: true },
            _count: { _all: true },
          }),
          tx.invoice.aggregate({
            where: {
              ...baseWhere,
              status: { notIn: ['paid', 'cancelled'] },
            },
            _sum: { total: true },
          }),
          tx.invoice.aggregate({
            where: { ...baseWhere, status: 'overdue' },
            _sum: { total: true },
          }),
          tx.invoice.aggregate({
            where: { ...baseWhere, status: { not: 'cancelled' } },
            _sum: { total: true },
          }),
        ]);

      // Monthly grouping via raw SQL (DATE_TRUNC)
      const byMonthRaw = await tx.$queryRaw<
        Array<{ period: Date; revenue: any; count: bigint }>
      >`
        SELECT
          DATE_TRUNC('month', "date") AS period,
          COALESCE(SUM("total"), 0) AS revenue,
          COUNT(*)::bigint AS count
        FROM "invoices"
        WHERE "organizationId" = ${orgId}
          AND "status" = 'paid'
          AND "date" >= ${from}
          AND "date" <= ${to}
        GROUP BY period
        ORDER BY period ASC
      `;

      const byMonth = byMonthRaw.map((r) => ({
        period: r.period.toISOString().slice(0, 7),
        revenue: Number(r.revenue ?? 0),
        count: Number(r.count ?? 0),
      }));

      // Top clients
      const topGrouped = await tx.invoice.groupBy({
        by: ['clientId'],
        where: {
          organizationId: orgId,
          status: 'paid',
          clientId: { not: null },
          date: { gte: from, lte: to },
        },
        _sum: { total: true },
        _count: { _all: true },
        orderBy: { _sum: { total: 'desc' } },
        take: 10,
      });

      const clientIds = topGrouped
        .map((g: any) => g.clientId)
        .filter(Boolean) as string[];
      const clients = clientIds.length
        ? await tx.client.findMany({
            where: { id: { in: clientIds } },
            select: { id: true, company: true },
          })
        : [];
      const clientMap = new Map(clients.map((c: any) => [c.id, c.company]));

      const topClients = topGrouped.map((g: any) => ({
        clientId: g.clientId,
        company: clientMap.get(g.clientId) ?? 'Unknown',
        totalRevenue: Number(g._sum.total ?? 0),
        invoiceCount: g._count._all,
      }));

      return {
        totalRevenue: Number(revenueAgg._sum.total ?? 0),
        totalPaid: Number(paidAgg._sum.total ?? 0),
        totalOutstanding: Number(outstandingAgg._sum.total ?? 0),
        totalOverdue: Number(overdueAgg._sum.total ?? 0),
        byMonth,
        topClients,
      };
    });
  }

  // ──────────────────────────────────────────────────────────────
  // 2. Leads report
  // ──────────────────────────────────────────────────────────────

  async getLeadsReport(orgId: string, query: DateRangeQuery) {
    const { from, to } = parseRange(query);

    return this.prisma.withOrganization(orgId, async (tx) => {
      const baseWhere = {
        organizationId: orgId,
        createdAt: { gte: from, lte: to },
      } as const;

      const [totalLeads, statuses, leadStatusRecords, sourceGrouped, sources] =
        await Promise.all([
          tx.lead.count({ where: baseWhere }),
          tx.lead.groupBy({
            by: ['statusId'],
            where: baseWhere,
            _count: { _all: true },
          }),
          tx.leadStatus.findMany({
            where: { organizationId: orgId },
            select: { id: true, name: true },
          }),
          tx.lead.groupBy({
            by: ['sourceId'],
            where: baseWhere,
            _count: { _all: true },
          }),
          tx.leadSource.findMany({
            where: { organizationId: orgId },
            select: { id: true, name: true },
          }),
        ]);

      const statusNameMap = new Map(
        leadStatusRecords.map((s: any) => [s.id, (s.name || '').toLowerCase()]),
      );
      const sourceNameMap = new Map(
        sources.map((s: any) => [s.id, s.name]),
      );

      const byStatus: Record<string, number> = {
        new: 0,
        contacted: 0,
        qualified: 0,
        proposal: 0,
        negotiation: 0,
        won: 0,
        lost: 0,
      };
      for (const row of statuses as any[]) {
        const name = statusNameMap.get(row.statusId) ?? '';
        if (name in byStatus) {
          byStatus[name] += row._count._all;
        }
      }

      const conversionRate =
        byStatus.won + byStatus.lost > 0
          ? (byStatus.won / (byStatus.won + byStatus.lost)) * 100
          : 0;

      const bySource = (sourceGrouped as any[])
        .filter((g) => g.sourceId)
        .map((g) => ({
          source: sourceNameMap.get(g.sourceId) ?? 'Unknown',
          count: g._count._all,
        }));

      // Monthly raw SQL
      const byMonthRaw = await tx.$queryRaw<
        Array<{
          period: Date;
          total: bigint;
          won: bigint;
          lost: bigint;
        }>
      >`
        SELECT
          DATE_TRUNC('month', l."createdAt") AS period,
          COUNT(*)::bigint AS total,
          COUNT(*) FILTER (WHERE LOWER(ls."name") = 'won')::bigint AS won,
          COUNT(*) FILTER (WHERE LOWER(ls."name") = 'lost')::bigint AS lost
        FROM "leads" l
        LEFT JOIN "lead_statuses" ls ON ls."id" = l."statusId"
        WHERE l."organizationId" = ${orgId}
          AND l."createdAt" >= ${from}
          AND l."createdAt" <= ${to}
        GROUP BY period
        ORDER BY period ASC
      `;

      const byMonth = byMonthRaw.map((r) => ({
        period: r.period.toISOString().slice(0, 7),
        total: Number(r.total ?? 0),
        won: Number(r.won ?? 0),
        lost: Number(r.lost ?? 0),
      }));

      // Top assignees
      const assigneeGrouped = await tx.lead.groupBy({
        by: ['assignedTo'],
        where: { ...baseWhere, assignedTo: { not: null } },
        _count: { _all: true },
        orderBy: { _count: { assignedTo: 'desc' } },
        take: 10,
      });

      const assigneeIds = (assigneeGrouped as any[])
        .map((g) => g.assignedTo)
        .filter(Boolean);
      const users = assigneeIds.length
        ? await tx.user.findMany({
            where: { id: { in: assigneeIds } },
            select: { id: true, firstName: true, lastName: true },
          })
        : [];
      const userMap = new Map(
        users.map((u: any) => [u.id, `${u.firstName} ${u.lastName}`.trim()]),
      );

      // Won counts per assignee
      const wonCounts = await tx.$queryRaw<
        Array<{ assignedTo: string; won: bigint }>
      >`
        SELECT l."assignedTo", COUNT(*)::bigint AS won
        FROM "leads" l
        JOIN "lead_statuses" ls ON ls."id" = l."statusId"
        WHERE l."organizationId" = ${orgId}
          AND LOWER(ls."name") = 'won'
          AND l."assignedTo" IS NOT NULL
          AND l."createdAt" >= ${from}
          AND l."createdAt" <= ${to}
        GROUP BY l."assignedTo"
      `;
      const wonMap = new Map(
        wonCounts.map((w) => [w.assignedTo, Number(w.won)]),
      );

      const topAssignees = (assigneeGrouped as any[]).map((g) => ({
        userId: g.assignedTo,
        name: userMap.get(g.assignedTo) ?? 'Unknown',
        leadCount: g._count._all,
        wonCount: wonMap.get(g.assignedTo) ?? 0,
      }));

      return {
        totalLeads,
        byStatus,
        conversionRate,
        bySource,
        byMonth,
        topAssignees,
      };
    });
  }

  // ──────────────────────────────────────────────────────────────
  // 3. Income / Expense report
  // ──────────────────────────────────────────────────────────────

  async getIncomeExpenseReport(orgId: string, query: DateRangeQuery) {
    const { from, to } = parseRange(query);

    return this.prisma.withOrganization(orgId, async (tx) => {
      const [incomeAgg, expenseAgg] = await Promise.all([
        tx.invoice.aggregate({
          where: {
            organizationId: orgId,
            status: 'paid',
            date: { gte: from, lte: to },
          },
          _sum: { total: true },
        }),
        tx.expense.aggregate({
          where: {
            organizationId: orgId,
            date: { gte: from, lte: to },
          },
          _sum: { amount: true },
        }),
      ]);

      const totalIncome = Number(incomeAgg._sum.total ?? 0);
      const totalExpenses = Number(expenseAgg._sum.amount ?? 0);

      const incomeMonthly = await tx.$queryRaw<
        Array<{ period: Date; amount: any }>
      >`
        SELECT DATE_TRUNC('month', "date") AS period,
               COALESCE(SUM("total"), 0) AS amount
        FROM "invoices"
        WHERE "organizationId" = ${orgId}
          AND "status" = 'paid'
          AND "date" >= ${from} AND "date" <= ${to}
        GROUP BY period
        ORDER BY period ASC
      `;

      const expenseMonthly = await tx.$queryRaw<
        Array<{ period: Date; amount: any }>
      >`
        SELECT DATE_TRUNC('month', "date") AS period,
               COALESCE(SUM("amount"), 0) AS amount
        FROM "expenses"
        WHERE "organizationId" = ${orgId}
          AND "date" >= ${from} AND "date" <= ${to}
        GROUP BY period
        ORDER BY period ASC
      `;

      // merge
      const monthMap = new Map<
        string,
        { period: string; income: number; expenses: number; profit: number }
      >();
      for (const r of incomeMonthly) {
        const key = r.period.toISOString().slice(0, 7);
        monthMap.set(key, {
          period: key,
          income: Number(r.amount ?? 0),
          expenses: 0,
          profit: Number(r.amount ?? 0),
        });
      }
      for (const r of expenseMonthly) {
        const key = r.period.toISOString().slice(0, 7);
        const existing =
          monthMap.get(key) ?? { period: key, income: 0, expenses: 0, profit: 0 };
        existing.expenses = Number(r.amount ?? 0);
        existing.profit = existing.income - existing.expenses;
        monthMap.set(key, existing);
      }
      const byMonth = Array.from(monthMap.values()).sort((a, b) =>
        a.period.localeCompare(b.period),
      );

      // Expenses by category
      const catGrouped = await tx.expense.groupBy({
        by: ['categoryId'],
        where: {
          organizationId: orgId,
          date: { gte: from, lte: to },
        },
        _sum: { amount: true },
      });
      const catIds = (catGrouped as any[])
        .map((g) => g.categoryId)
        .filter(Boolean);
      const categories = catIds.length
        ? await tx.expenseCategory.findMany({
            where: { id: { in: catIds } },
            select: { id: true, name: true },
          })
        : [];
      const catMap = new Map(categories.map((c: any) => [c.id, c.name]));
      const byCategory = (catGrouped as any[]).map((g) => ({
        category: g.categoryId ? (catMap.get(g.categoryId) ?? 'Uncategorized') : 'Uncategorized',
        amount: Number(g._sum.amount ?? 0),
      }));

      return {
        totalIncome,
        totalExpenses,
        netProfit: totalIncome - totalExpenses,
        byMonth,
        byCategory,
      };
    });
  }

  // ──────────────────────────────────────────────────────────────
  // 4. Clients report
  // ──────────────────────────────────────────────────────────────

  async getClientsReport(orgId: string) {
    return this.prisma.withOrganization(orgId, async (tx) => {
      const now = new Date();
      const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
      const ninetyDaysAgo = new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000);

      const [totalClients, activeClients, newThisMonth, countryGrouped] =
        await Promise.all([
          tx.client.count({ where: { organizationId: orgId } }),
          tx.client.count({
            where: { organizationId: orgId, active: true },
          }),
          tx.client.count({
            where: {
              organizationId: orgId,
              createdAt: { gte: startOfMonth },
            },
          }),
          tx.client.groupBy({
            by: ['country'],
            where: { organizationId: orgId },
            _count: { _all: true },
          }),
        ]);

      const byCountry = (countryGrouped as any[])
        .filter((g) => g.country)
        .map((g) => ({ country: g.country as string, count: g._count._all }))
        .sort((a, b) => b.count - a.count);

      // Top by revenue (paid invoices)
      const topGrouped = await tx.invoice.groupBy({
        by: ['clientId'],
        where: {
          organizationId: orgId,
          status: 'paid',
          clientId: { not: null },
        },
        _sum: { total: true },
        orderBy: { _sum: { total: 'desc' } },
        take: 10,
      });
      const topIds = (topGrouped as any[])
        .map((g) => g.clientId)
        .filter(Boolean) as string[];
      const topClientRecords = topIds.length
        ? await tx.client.findMany({
            where: { id: { in: topIds } },
            select: { id: true, company: true },
          })
        : [];
      const topNameMap = new Map(
        topClientRecords.map((c: any) => [c.id, c.company]),
      );
      const topByRevenue = (topGrouped as any[]).map((g) => ({
        clientId: g.clientId,
        company: topNameMap.get(g.clientId) ?? 'Unknown',
        totalRevenue: Number(g._sum.total ?? 0),
      }));

      // Churned clients = no invoices in last 90 days
      const churnedClients = await tx.client.count({
        where: {
          organizationId: orgId,
          invoices: {
            none: { date: { gte: ninetyDaysAgo } },
          },
        },
      });

      return {
        totalClients,
        activeClients,
        newThisMonth,
        byCountry,
        topByRevenue,
        churnedClients,
      };
    });
  }

  // ──────────────────────────────────────────────────────────────
  // 5. Time tracking report
  // ──────────────────────────────────────────────────────────────

  async getTimeTrackingReport(orgId: string, query: TimeTrackingQuery) {
    const { from, to } = parseRange(query);

    return this.prisma.withOrganization(orgId, async (tx) => {
      const where: any = {
        organizationId: orgId,
        startTime: { gte: from, lte: to },
      };
      if (query.projectId) where.projectId = query.projectId;
      if (query.userId) where.userId = query.userId;

      const entries = await tx.timeEntry.findMany({
        where,
        select: {
          userId: true,
          projectId: true,
          seconds: true,
          billable: true,
        },
      });

      let totalSeconds = 0;
      let billableSeconds = 0;
      const byUserMap = new Map<
        string,
        { seconds: number; billable: number }
      >();
      const byProjectMap = new Map<string, number>();

      for (const e of entries as any[]) {
        const s = Number(e.seconds ?? 0);
        totalSeconds += s;
        if (e.billable) billableSeconds += s;

        const u = byUserMap.get(e.userId) ?? { seconds: 0, billable: 0 };
        u.seconds += s;
        if (e.billable) u.billable += s;
        byUserMap.set(e.userId, u);

        if (e.projectId) {
          byProjectMap.set(
            e.projectId,
            (byProjectMap.get(e.projectId) ?? 0) + s,
          );
        }
      }

      const userIds = Array.from(byUserMap.keys());
      const projectIds = Array.from(byProjectMap.keys());

      const [users, projects] = await Promise.all([
        userIds.length
          ? tx.user.findMany({
              where: { id: { in: userIds } },
              select: { id: true, firstName: true, lastName: true },
            })
          : Promise.resolve([]),
        projectIds.length
          ? tx.project.findMany({
              where: { id: { in: projectIds } },
              select: { id: true, name: true },
            })
          : Promise.resolve([]),
      ]);

      const userNameMap = new Map(
        (users as any[]).map((u) => [
          u.id,
          `${u.firstName} ${u.lastName}`.trim(),
        ]),
      );
      const projectNameMap = new Map(
        (projects as any[]).map((p) => [p.id, p.name]),
      );

      const byUser = Array.from(byUserMap.entries()).map(([userId, v]) => ({
        userId,
        name: userNameMap.get(userId) ?? 'Unknown',
        hours: +(v.seconds / 3600).toFixed(2),
        billableHours: +(v.billable / 3600).toFixed(2),
      }));

      const byProject = Array.from(byProjectMap.entries()).map(
        ([projectId, seconds]) => ({
          projectId,
          name: projectNameMap.get(projectId) ?? 'Unknown',
          hours: +(seconds / 3600).toFixed(2),
        }),
      );

      return {
        totalHours: +(totalSeconds / 3600).toFixed(2),
        billableHours: +(billableSeconds / 3600).toFixed(2),
        byUser: byUser.sort((a, b) => b.hours - a.hours),
        byProject: byProject.sort((a, b) => b.hours - a.hours),
      };
    });
  }

  // ──────────────────────────────────────────────────────────────
  // 6. Tickets report
  // ──────────────────────────────────────────────────────────────

  async getTicketsReport(orgId: string, query: DateRangeQuery) {
    const { from, to } = parseRange(query);

    return this.prisma.withOrganization(orgId, async (tx) => {
      const baseWhere = {
        organizationId: orgId,
        createdAt: { gte: from, lte: to },
      } as const;

      const [totalTickets, statusGrouped, priorityGrouped] = await Promise.all(
        [
          tx.ticket.count({ where: baseWhere }),
          tx.ticket.groupBy({
            by: ['status'],
            where: baseWhere,
            _count: { _all: true },
          }),
          tx.ticket.groupBy({
            by: ['priority'],
            where: baseWhere,
            _count: { _all: true },
          }),
        ],
      );

      const byStatus: Record<string, number> = {
        open: 0,
        in_progress: 0,
        answered: 0,
        on_hold: 0,
        closed: 0,
      };
      for (const r of statusGrouped as any[]) {
        if (r.status in byStatus) byStatus[r.status] = r._count._all;
      }

      const byPriority: Record<string, number> = {
        low: 0,
        medium: 0,
        high: 0,
        urgent: 0,
      };
      for (const r of priorityGrouped as any[]) {
        if (r.priority in byPriority) byPriority[r.priority] = r._count._all;
      }

      // Avg resolution time (hours) - closed tickets
      const avgRow = await tx.$queryRaw<Array<{ avg_hours: any }>>`
        SELECT AVG(EXTRACT(EPOCH FROM ("closedAt" - "createdAt")) / 3600.0) AS avg_hours
        FROM "tickets"
        WHERE "organizationId" = ${orgId}
          AND "closedAt" IS NOT NULL
          AND "createdAt" >= ${from}
          AND "createdAt" <= ${to}
      `;
      const avgResolutionTime = Number(avgRow[0]?.avg_hours ?? 0);

      // By assignee
      const assigneeRows = await tx.$queryRaw<
        Array<{
          assignedTo: string;
          count: bigint;
          avg_resolution: any;
        }>
      >`
        SELECT
          "assignedTo",
          COUNT(*)::bigint AS count,
          AVG(EXTRACT(EPOCH FROM ("closedAt" - "createdAt")) / 3600.0) AS avg_resolution
        FROM "tickets"
        WHERE "organizationId" = ${orgId}
          AND "assignedTo" IS NOT NULL
          AND "createdAt" >= ${from}
          AND "createdAt" <= ${to}
        GROUP BY "assignedTo"
        ORDER BY count DESC
        LIMIT 20
      `;

      const assigneeIds = assigneeRows.map((r) => r.assignedTo);
      const assigneeUsers = assigneeIds.length
        ? await tx.user.findMany({
            where: { id: { in: assigneeIds } },
            select: { id: true, firstName: true, lastName: true },
          })
        : [];
      const nameMap = new Map(
        (assigneeUsers as any[]).map((u) => [
          u.id,
          `${u.firstName} ${u.lastName}`.trim(),
        ]),
      );

      const byAssignee = assigneeRows.map((r) => ({
        userId: r.assignedTo,
        name: nameMap.get(r.assignedTo) ?? 'Unknown',
        count: Number(r.count),
        avgResolution: Number(r.avg_resolution ?? 0),
      }));

      return {
        totalTickets,
        byStatus,
        byPriority,
        avgResolutionTime,
        byAssignee,
      };
    });
  }

  // ──────────────────────────────────────────────────────────────
  // 7. Items report (invoiced line items aggregated by description,
  //     cross-matched to Products for stock visibility)
  // ──────────────────────────────────────────────────────────────

  async getItemsReport(
    orgId: string,
    query: DateRangeQuery & { status?: string | string[] },
  ) {
    const { from, to } = parseRange(query);

    // Default statuses that count as "sold"
    const defaultStatuses = ['paid', 'partial', 'sent', 'overdue'];
    let statuses: string[] | undefined;
    if (Array.isArray(query.status)) {
      statuses = query.status.filter(Boolean);
    } else if (typeof query.status === 'string' && query.status.length > 0) {
      statuses =
        query.status === 'all'
          ? undefined
          : query.status.split(',').map((s) => s.trim()).filter(Boolean);
    } else {
      statuses = defaultStatuses;
    }

    return this.prisma.withOrganization(orgId, async (tx) => {
      // Aggregate invoice items grouped by description
      const statusFilter =
        statuses && statuses.length
          ? Prisma.sql`AND i."status" IN (${Prisma.join(statuses)})`
          : Prisma.empty;

      const rows = await tx.$queryRaw<
        Array<{
          description: string;
          totalQty: any;
          totalRevenue: any;
          invoiceCount: bigint;
        }>
      >`
        SELECT
          ii."description"               AS description,
          COALESCE(SUM(ii."qty"), 0)     AS "totalQty",
          COALESCE(SUM(ii."qty" * ii."rate"), 0) AS "totalRevenue",
          COUNT(DISTINCT i."id")::bigint AS "invoiceCount"
        FROM "invoice_items" ii
        JOIN "invoices" i ON i."id" = ii."invoiceId"
        WHERE i."organizationId" = ${orgId}
          AND i."date" >= ${from}
          AND i."date" <= ${to}
          ${statusFilter}
        GROUP BY ii."description"
        ORDER BY "totalRevenue" DESC
      `;

      // Cross-match to products (case-insensitive exact name) for stock & sku
      const names = rows.map((r) => r.description).filter(Boolean);
      const products = names.length
        ? await tx.product.findMany({
            where: {
              organizationId: orgId,
              name: { in: names, mode: 'insensitive' as const },
            },
            select: {
              id: true,
              name: true,
              sku: true,
              stockQuantity: true,
              trackInventory: true,
            },
          })
        : [];
      const productMap = new Map(
        products.map((p) => [p.name.toLowerCase(), p]),
      );

      return rows.map((r) => {
        const match = productMap.get((r.description ?? '').toLowerCase());
        return {
          description: r.description,
          totalQty: Number(r.totalQty ?? 0),
          totalRevenue: Number(r.totalRevenue ?? 0),
          invoiceCount: Number(r.invoiceCount ?? 0),
          productId: match?.id ?? null,
          sku: match?.sku ?? null,
          stockQuantity: match?.trackInventory ? match.stockQuantity : null,
          trackInventory: match?.trackInventory ?? false,
        };
      });
    });
  }

  // ──────────────────────────────────────────────────────────────
  // 8. Payment modes report
  // ──────────────────────────────────────────────────────────────

  async getPaymentModesReport(orgId: string, query: DateRangeQuery) {
    const { from, to } = parseRange(query);

    return this.prisma.withOrganization(orgId, async (tx) => {
      const grouped = await tx.payment.groupBy({
        by: ['paymentModeId'],
        where: {
          organizationId: orgId,
          paymentDate: { gte: from, lte: to },
        },
        _sum: { amount: true },
        _count: { _all: true },
      });

      const modeIds = (grouped as any[])
        .map((g) => g.paymentModeId)
        .filter(Boolean);
      const modes = modeIds.length
        ? await tx.paymentMode.findMany({
            where: { id: { in: modeIds } },
            select: { id: true, name: true },
          })
        : [];
      const modeMap = new Map(modes.map((m: any) => [m.id, m.name]));

      const totalAmount = (grouped as any[]).reduce(
        (sum, g) => sum + Number(g._sum.amount ?? 0),
        0,
      );

      const byMode = (grouped as any[])
        .map((g) => ({
          paymentModeId: g.paymentModeId,
          name: g.paymentModeId
            ? (modeMap.get(g.paymentModeId) ?? 'Unknown')
            : 'Unspecified',
          amount: Number(g._sum.amount ?? 0),
          count: g._count._all,
        }))
        .sort((a, b) => b.amount - a.amount);

      return {
        totalAmount,
        totalTransactions: byMode.reduce((n, m) => n + m.count, 0),
        byMode,
      };
    });
  }

  // ──────────────────────────────────────────────────────────────
  // 9. Expenses by category report
  // ──────────────────────────────────────────────────────────────

  async getExpensesByCategory(
    orgId: string,
    query: DateRangeQuery & { billable?: boolean; clientId?: string },
  ) {
    const { from, to } = parseRange(query);

    return this.prisma.withOrganization(orgId, async (tx) => {
      const where: any = {
        organizationId: orgId,
        date: { gte: from, lte: to },
      };
      if (typeof query.billable === 'boolean') where.billable = query.billable;
      if (query.clientId) where.clientId = query.clientId;

      // Group by (categoryId, currencyId) so we can preserve per-currency detail
      const grouped = await tx.expense.groupBy({
        by: ['categoryId', 'currencyId'],
        where,
        _sum: { amount: true },
        _count: { _all: true },
      });

      // Fetch categories & currencies in one pass
      const catIds = Array.from(
        new Set(
          (grouped as any[])
            .map((g) => g.categoryId)
            .filter((x): x is string => Boolean(x)),
        ),
      );
      const currencyIds = Array.from(
        new Set(
          (grouped as any[])
            .map((g) => g.currencyId)
            .filter((x): x is string => Boolean(x)),
        ),
      );

      const [categories, currencies, defaultCurrency] = await Promise.all([
        catIds.length
          ? tx.expenseCategory.findMany({
              where: { id: { in: catIds } },
              select: { id: true, name: true, color: true },
            })
          : Promise.resolve([] as { id: string; name: string; color: string | null }[]),
        currencyIds.length
          ? tx.currency.findMany({
              where: { id: { in: currencyIds } },
              select: { id: true, code: true, symbol: true, name: true },
            })
          : Promise.resolve(
              [] as { id: string; code: string | null; symbol: string; name: string }[],
            ),
        tx.currency.findFirst({
          where: { organizationId: orgId, isDefault: true },
          select: { id: true, code: true, symbol: true, name: true },
        }),
      ]);

      const catMap = new Map(categories.map((c: any) => [c.id, c]));
      const currencyMap = new Map(currencies.map((c: any) => [c.id, c]));

      const defaultCurrencyId = defaultCurrency?.id ?? null;
      const defaultCurrencyCode = defaultCurrency?.code ?? null;

      // Fold into category-keyed buckets
      type CurrencySlice = {
        currencyId: string | null;
        currency: string;
        count: number;
        total: number;
      };
      type CategoryBucket = {
        categoryId: string | null;
        categoryName: string;
        categoryColor: string;
        count: number;
        total: number;
        hasMixedCurrency: boolean;
        byCurrency: CurrencySlice[];
      };

      const UNCATEGORIZED_COLOR = '#94A3B8'; // slate-400 neutral
      const buckets = new Map<string, CategoryBucket>();

      for (const g of grouped as any[]) {
        const key = g.categoryId ?? '__uncategorized__';
        const cat = g.categoryId ? catMap.get(g.categoryId) : null;
        const currency = g.currencyId ? currencyMap.get(g.currencyId) : null;
        const currencyCode =
          currency?.code ||
          currency?.name ||
          (g.currencyId ? 'UNKNOWN' : (defaultCurrencyCode ?? 'DEFAULT'));

        const bucket =
          buckets.get(key) ??
          ({
            categoryId: g.categoryId ?? null,
            categoryName: cat?.name ?? 'Uncategorized',
            categoryColor: cat?.color || (g.categoryId ? '#64748B' : UNCATEGORIZED_COLOR),
            count: 0,
            total: 0,
            hasMixedCurrency: false,
            byCurrency: [],
          } as CategoryBucket);

        const amount = Number(g._sum.amount ?? 0);
        const count = Number(g._count?._all ?? 0);

        bucket.count += count;
        bucket.total += amount; // naive sum — no FX conversion
        bucket.byCurrency.push({
          currencyId: g.currencyId ?? null,
          currency: currencyCode,
          count,
          total: amount,
        });

        buckets.set(key, bucket);
      }

      // Compute mixed-currency flag and sort per-currency slices
      for (const b of buckets.values()) {
        const codes = new Set(
          b.byCurrency
            .map((s) => (s.currencyId ?? defaultCurrencyId ?? 'default') + ':' + s.currency)
            .filter(Boolean),
        );
        // Mixed if more than one distinct currency slice, OR any slice whose
        // currency differs from the org default.
        const distinctCurrencies = new Set(b.byCurrency.map((s) => s.currency));
        b.hasMixedCurrency =
          distinctCurrencies.size > 1 ||
          (defaultCurrencyCode != null &&
            b.byCurrency.some(
              (s) => s.currency && s.currency !== defaultCurrencyCode,
            ));
        // If we only have a single unknown slice and a default currency exists,
        // don't flag as mixed.
        if (
          distinctCurrencies.size === 1 &&
          defaultCurrencyCode == null
        ) {
          b.hasMixedCurrency = false;
        }
        b.byCurrency.sort((a, c) => c.total - a.total);
        void codes;
      }

      const rows = Array.from(buckets.values()).sort((a, b) => b.total - a.total);

      const grandTotal = rows.reduce((s, r) => s + r.total, 0);
      const uncategorized = rows.find((r) => r.categoryId === null);
      const uncategorizedTotal = uncategorized?.total ?? 0;
      const uncategorizedCount = uncategorized?.count ?? 0;

      // Attach percentage
      const byCategory = rows.map((r) => ({
        ...r,
        percentage:
          grandTotal > 0 ? +((r.total / grandTotal) * 100).toFixed(2) : 0,
      }));

      const hasMixedCurrency = byCategory.some((r) => r.hasMixedCurrency);

      return {
        grandTotal,
        uncategorizedTotal,
        uncategorizedCount,
        categoryCount: byCategory.filter((r) => r.categoryId !== null).length,
        hasMixedCurrency,
        defaultCurrency: defaultCurrency
          ? {
              code: defaultCurrency.code,
              symbol: defaultCurrency.symbol,
              name: defaultCurrency.name,
            }
          : null,
        byCategory,
      };
    });
  }

  // ──────────────────────────────────────────────────────────────
  // 10. Profit & Loss report
  // ──────────────────────────────────────────────────────────────

  async getProfitLossReport(
    orgId: string,
    query: DateRangeQuery & { taxPercent?: number },
  ) {
    const { from, to } = parseRange(query);
    const taxPercent = query.taxPercent ?? 20;

    return this.prisma.withOrganization(orgId, async (tx) => {
      // Revenue: sum of paid invoice totals in date range
      const revenueAgg = await tx.invoice.aggregate({
        where: {
          organizationId: orgId,
          status: 'paid',
          date: { gte: from, lte: to },
        },
        _sum: { total: true },
      });
      const revenue = Number(revenueAgg._sum.total ?? 0);

      // Expenses: sum of expense amounts in date range
      const expenseAgg = await tx.expense.aggregate({
        where: {
          organizationId: orgId,
          date: { gte: from, lte: to },
        },
        _sum: { amount: true },
      });
      const expenses = Number(expenseAgg._sum.amount ?? 0);

      const netProfit = revenue - expenses;
      const taxEstimate = Math.max(0, netProfit * (taxPercent / 100));

      // Revenue by month
      const revenueMonthly = await tx.$queryRaw<
        Array<{ period: Date; amount: any }>
      >`
        SELECT DATE_TRUNC('month', "date") AS period,
               COALESCE(SUM("total"), 0) AS amount
        FROM "invoices"
        WHERE "organizationId" = ${orgId}
          AND "status" = 'paid'
          AND "date" >= ${from} AND "date" <= ${to}
        GROUP BY period
        ORDER BY period ASC
      `;

      // Expenses by month
      const expenseMonthly = await tx.$queryRaw<
        Array<{ period: Date; amount: any }>
      >`
        SELECT DATE_TRUNC('month', "date") AS period,
               COALESCE(SUM("amount"), 0) AS amount
        FROM "expenses"
        WHERE "organizationId" = ${orgId}
          AND "date" >= ${from} AND "date" <= ${to}
        GROUP BY period
        ORDER BY period ASC
      `;

      // Merge by month
      const monthMap = new Map<
        string,
        { period: string; revenue: number; expenses: number; profit: number }
      >();
      for (const r of revenueMonthly) {
        const key = r.period.toISOString().slice(0, 7);
        monthMap.set(key, {
          period: key,
          revenue: Number(r.amount ?? 0),
          expenses: 0,
          profit: Number(r.amount ?? 0),
        });
      }
      for (const r of expenseMonthly) {
        const key = r.period.toISOString().slice(0, 7);
        const existing =
          monthMap.get(key) ?? { period: key, revenue: 0, expenses: 0, profit: 0 };
        existing.expenses = Number(r.amount ?? 0);
        existing.profit = existing.revenue - existing.expenses;
        monthMap.set(key, existing);
      }
      const byMonth = Array.from(monthMap.values()).sort((a, b) =>
        a.period.localeCompare(b.period),
      );

      // Expenses by category
      const catGrouped = await tx.expense.groupBy({
        by: ['categoryId'],
        where: {
          organizationId: orgId,
          date: { gte: from, lte: to },
        },
        _sum: { amount: true },
      });
      const catIds = (catGrouped as any[])
        .map((g) => g.categoryId)
        .filter(Boolean);
      const categories = catIds.length
        ? await tx.expenseCategory.findMany({
            where: { id: { in: catIds } },
            select: { id: true, name: true },
          })
        : [];
      const catMap = new Map(categories.map((c: any) => [c.id, c.name]));
      const expensesByCategory = (catGrouped as any[]).map((g) => ({
        category: g.categoryId
          ? (catMap.get(g.categoryId) ?? 'Uncategorized')
          : 'Uncategorized',
        amount: Number(g._sum.amount ?? 0),
      }));

      return {
        revenue,
        expenses,
        netProfit,
        taxEstimate,
        taxPercent,
        byMonth,
        expensesByCategory,
      };
    });
  }
}
