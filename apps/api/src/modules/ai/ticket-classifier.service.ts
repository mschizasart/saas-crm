import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { PrismaService } from '../../database/prisma.service';

@Injectable()
export class TicketClassifierService {
  private readonly logger = new Logger(TicketClassifierService.name);

  constructor(private prisma: PrismaService) {}

  @OnEvent('ticket.created')
  async classifyTicket(payload: { ticket: any; orgId: string }) {
    const { ticket, orgId } = payload;

    try {
      const text = `${ticket.subject ?? ''} ${ticket.message ?? ''}`.toLowerCase();

      // Priority classification (keyword-based)
      let priority = 'medium';
      const urgentWords = ['urgent', 'emergency', 'critical', 'down', 'broken', 'asap', 'immediately'];
      const highWords = ['important', 'error', 'bug', 'issue', 'problem', 'failing'];
      const lowWords = ['question', 'info', 'how to', 'wondering', 'suggestion'];

      if (urgentWords.some((w) => text.includes(w))) priority = 'urgent';
      else if (highWords.some((w) => text.includes(w))) priority = 'high';
      else if (lowWords.some((w) => text.includes(w))) priority = 'low';

      // Department classification
      const departmentKeywords: Record<string, string[]> = {
        billing: ['invoice', 'payment', 'charge', 'refund', 'subscription', 'price', 'bill'],
        support: ['help', 'support', 'issue', 'problem', 'error', 'bug', 'broken'],
        sales: ['pricing', 'demo', 'trial', 'upgrade', 'plan', 'quote', 'proposal'],
      };

      let matchedDept: string | null = null;
      let maxScore = 0;
      for (const [dept, keywords] of Object.entries(departmentKeywords)) {
        const score = keywords.filter((k) => text.includes(k)).length;
        if (score > maxScore) {
          maxScore = score;
          matchedDept = dept;
        }
      }

      // Find actual department ID by name match
      let departmentId: string | undefined;
      if (matchedDept) {
        const dept = await this.prisma.department.findFirst({
          where: {
            organizationId: orgId,
            name: { contains: matchedDept, mode: 'insensitive' },
          },
        });
        if (dept) departmentId = dept.id;
      }

      // Update ticket with classification
      const updates: any = {};
      if (priority !== ticket.priority) updates.priority = priority;
      if (departmentId && !ticket.departmentId) updates.departmentId = departmentId;

      if (Object.keys(updates).length > 0) {
        await this.prisma.ticket.update({
          where: { id: ticket.id },
          data: updates,
        });
        this.logger.log(
          `Classified ticket ${ticket.id}: priority=${priority}, dept=${matchedDept ?? 'none'}`,
        );
      }
    } catch (error) {
      this.logger.error(`Failed to classify ticket ${ticket.id}`, error);
    }
  }
}
