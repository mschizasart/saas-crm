import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service';

export interface HealthFactor {
  name: string;
  score: number;
  maxScore: number;
  detail: string;
}

export interface HealthScoreResult {
  score: number;
  grade: 'excellent' | 'good' | 'at_risk' | 'critical';
  factors: HealthFactor[];
}

export interface ClientHealthSummary {
  clientId: string;
  company: string;
  score: number;
  grade: string;
}

@Injectable()
export class HealthScoreService {
  private cache = new Map<string, { result: HealthScoreResult; expiry: number }>();
  private readonly CACHE_TTL = 5 * 60 * 1000; // 5 minutes

  constructor(private prisma: PrismaService) {}

  async calculateScore(
    orgId: string,
    clientId: string,
  ): Promise<HealthScoreResult> {
    const cacheKey = `${orgId}:${clientId}`;
    const cached = this.cache.get(cacheKey);
    if (cached && cached.expiry > Date.now()) {
      return cached.result;
    }

    const result = await this.computeScore(orgId, clientId);
    this.cache.set(cacheKey, { result, expiry: Date.now() + this.CACHE_TTL });
    return result;
  }

  private async computeScore(
    orgId: string,
    clientId: string,
  ): Promise<HealthScoreResult> {
    return this.prisma.withOrganization(orgId, async (tx) => {
      const now = new Date();
      const ninetyDaysAgo = new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000);

      // Factor 1: Payment history (0-30 points)
      const invoices = await tx.invoice.findMany({
        where: { clientId, organizationId: orgId },
        select: { status: true, dueDate: true, total: true },
      });
      const totalInvoices = invoices.length;
      const paidOnTime = invoices.filter(
        (i) => i.status === 'paid',
      ).length;
      const overdue = invoices.filter(
        (i) =>
          ['overdue', 'unpaid', 'partial'].includes(i.status) &&
          i.dueDate &&
          new Date(i.dueDate) < now,
      ).length;
      const paymentScore =
        totalInvoices > 0
          ? Math.round((paidOnTime / totalInvoices) * 30)
          : 15;

      // Factor 2: Recent activity (0-25 points)
      const recentInvoices = invoices.filter(
        (i) => i.dueDate && new Date(i.dueDate) > ninetyDaysAgo,
      ).length;
      const activityScore = Math.min(25, recentInvoices * 5);

      // Factor 3: Support tickets (0-20 points) -- fewer open = better
      const openTickets = await tx.ticket.count({
        where: {
          clientId,
          organizationId: orgId,
          status: { in: ['open', 'in_progress'] },
        },
      });
      const ticketScore = Math.max(0, 20 - openTickets * 5);

      // Factor 4: Contract status (0-15 points)
      // Contract model uses `signed` boolean, not `status`
      const activeContracts = await tx.contract.count({
        where: {
          clientId,
          organizationId: orgId,
          signed: true,
          endDate: { gte: now },
        },
      });
      const contractScore = activeContracts > 0 ? 15 : 5;

      // Factor 5: Project engagement (0-10 points)
      const activeProjects = await tx.project.count({
        where: {
          clientId,
          organizationId: orgId,
          status: 'in_progress',
        },
      });
      const projectScore = Math.min(10, activeProjects * 5);

      const totalScore =
        paymentScore +
        activityScore +
        ticketScore +
        contractScore +
        projectScore;

      let grade: HealthScoreResult['grade'];
      if (totalScore >= 80) grade = 'excellent';
      else if (totalScore >= 60) grade = 'good';
      else if (totalScore >= 40) grade = 'at_risk';
      else grade = 'critical';

      return {
        score: totalScore,
        grade,
        factors: [
          {
            name: 'Payment History',
            score: paymentScore,
            maxScore: 30,
            detail: `${paidOnTime}/${totalInvoices} paid on time, ${overdue} overdue`,
          },
          {
            name: 'Recent Activity',
            score: activityScore,
            maxScore: 25,
            detail: `${recentInvoices} invoices in last 90 days`,
          },
          {
            name: 'Support Load',
            score: ticketScore,
            maxScore: 20,
            detail: `${openTickets} open tickets`,
          },
          {
            name: 'Contracts',
            score: contractScore,
            maxScore: 15,
            detail: `${activeContracts} active contracts`,
          },
          {
            name: 'Projects',
            score: projectScore,
            maxScore: 10,
            detail: `${activeProjects} active projects`,
          },
        ],
      };
    });
  }

  async getScoresForAllClients(
    orgId: string,
  ): Promise<ClientHealthSummary[]> {
    const clients = await this.prisma.client.findMany({
      where: { organizationId: orgId, active: true },
      select: { id: true, company: true },
      take: 100,
    });

    const results: ClientHealthSummary[] = [];
    for (const client of clients) {
      try {
        const { score, grade } = await this.calculateScore(orgId, client.id);
        results.push({
          clientId: client.id,
          company: client.company,
          score,
          grade,
        });
      } catch {
        /* skip clients that error */
      }
    }
    return results.sort((a, b) => a.score - b.score);
  }
}
