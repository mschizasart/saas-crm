import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service';

export interface Suggestion {
  id: string;
  type: 'follow_up' | 'overdue' | 'expiring' | 'stale_lead' | 'unassigned';
  title: string;
  description: string;
  actionUrl: string;
  actionLabel: string;
  priority: 'high' | 'medium' | 'low';
  createdAt: string;
}

@Injectable()
export class SuggestionsService {
  constructor(private prisma: PrismaService) {}

  async getSuggestions(orgId: string, userId: string): Promise<Suggestion[]> {
    const suggestions: Suggestion[] = [];
    const now = new Date();
    const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    const thirtyDaysFromNow = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);

    return this.prisma.withOrganization(orgId, async (tx) => {
      // 1. Overdue invoices
      const overdueInvoices = await tx.invoice.findMany({
        where: {
          organizationId: orgId,
          status: { in: ['sent', 'partial'] },
          dueDate: { lt: now },
        },
        select: {
          id: true,
          number: true,
          total: true,
          dueDate: true,
          client: { select: { company: true } },
        },
        take: 5,
      });
      for (const inv of overdueInvoices) {
        const days = Math.floor(
          (now.getTime() - new Date(inv.dueDate!).getTime()) / (1000 * 60 * 60 * 24),
        );
        suggestions.push({
          id: `overdue-${inv.id}`,
          type: 'overdue',
          title: `Invoice ${inv.number} is ${days} days overdue`,
          description: `${(inv.client as any)?.company ?? 'Client'} owes ${inv.total}`,
          actionUrl: `/invoices/${inv.id}`,
          actionLabel: 'Send reminder',
          priority: days > 14 ? 'high' : 'medium',
          createdAt: now.toISOString(),
        });
      }

      // 2. Stale leads (no activity in 7+ days, not converted)
      const staleLeads = await tx.lead.findMany({
        where: {
          organizationId: orgId,
          updatedAt: { lt: sevenDaysAgo },
          convertedToClientId: null,
        },
        select: { id: true, name: true, updatedAt: true },
        take: 5,
      });
      for (const lead of staleLeads) {
        const days = Math.floor(
          (now.getTime() - new Date(lead.updatedAt).getTime()) / (1000 * 60 * 60 * 24),
        );
        suggestions.push({
          id: `stale-${lead.id}`,
          type: 'stale_lead',
          title: `Follow up with ${lead.name}`,
          description: `No activity in ${days} days`,
          actionUrl: `/leads/${lead.id}`,
          actionLabel: 'Open lead',
          priority: days > 30 ? 'high' : 'medium',
          createdAt: now.toISOString(),
        });
      }

      // 3. Expiring contracts (within 30 days)
      const expiringContracts = await tx.contract.findMany({
        where: {
          organizationId: orgId,
          endDate: { lte: thirtyDaysFromNow, gte: now },
        },
        select: {
          id: true,
          subject: true,
          endDate: true,
          client: { select: { company: true } },
        },
        take: 5,
      });
      for (const contract of expiringContracts) {
        const days = Math.floor(
          (new Date(contract.endDate!).getTime() - now.getTime()) / (1000 * 60 * 60 * 24),
        );
        suggestions.push({
          id: `expiring-${contract.id}`,
          type: 'expiring',
          title: `Contract "${contract.subject}" expires in ${days} days`,
          description: `${(contract.client as any)?.company ?? 'Client'}`,
          actionUrl: `/contracts/${contract.id}`,
          actionLabel: 'Renew',
          priority: days < 7 ? 'high' : 'medium',
          createdAt: now.toISOString(),
        });
      }

      // 4. Unassigned tickets
      const unassignedTickets = await tx.ticket.findMany({
        where: {
          organizationId: orgId,
          assignedTo: null,
          status: { in: ['open', 'in_progress'] },
        },
        select: { id: true, subject: true, createdAt: true },
        take: 5,
      });
      for (const ticket of unassignedTickets) {
        suggestions.push({
          id: `unassigned-${ticket.id}`,
          type: 'unassigned',
          title: `Ticket "${ticket.subject}" is unassigned`,
          description: 'No staff member assigned',
          actionUrl: `/tickets/${ticket.id}`,
          actionLabel: 'Assign',
          priority: 'medium',
          createdAt: now.toISOString(),
        });
      }

      // Sort by priority
      const order: Record<string, number> = { high: 0, medium: 1, low: 2 };
      suggestions.sort((a, b) => order[a.priority] - order[b.priority]);
      return suggestions.slice(0, 10);
    });
  }
}
