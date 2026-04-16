import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service';
import { EventEmitter2 } from '@nestjs/event-emitter';

export interface CreateTicketDto {
  subject: string;
  message?: string;
  clientId?: string;
  contactId?: string;
  departmentId?: string;
  priority?: string;
  service?: string;
  source?: string;
}

export interface CreateReplyDto {
  message: string;
  isStaff?: boolean;
  isInternal?: boolean;
}

@Injectable()
export class TicketsService {
  constructor(
    private prisma: PrismaService,
    private events: EventEmitter2,
  ) {}

  // ─── findAll ───────────────────────────────────────────────────────────────

  async findAll(
    orgId: string,
    query: {
      search?: string;
      status?: string;
      priority?: string;
      assignedTo?: string;
      departmentId?: string;
      clientId?: string;
      page?: number;
      limit?: number;
    },
  ) {
    const {
      search,
      status,
      priority,
      assignedTo,
      departmentId,
      clientId,
      page = 1,
      limit = 20,
    } = query;
    const skip = (page - 1) * limit;

    return this.prisma.withOrganization(orgId, async (tx) => {
      const where: any = { organizationId: orgId };
      if (status) where.status = status;
      if (priority) where.priority = priority;
      if (assignedTo) where.assignedTo = assignedTo;
      if (departmentId) where.departmentId = departmentId;
      if (clientId) where.clientId = clientId;
      if (search) {
        where.OR = [
          { subject: { contains: search, mode: 'insensitive' } },
          { message: { contains: search, mode: 'insensitive' } },
          { client: { company: { contains: search, mode: 'insensitive' } } },
        ];
      }

      const [data, total] = await Promise.all([
        (tx as any).ticket.findMany({
          where,
          skip,
          take: limit,
          orderBy: { lastReplyAt: 'desc' },
          include: {
            client: { select: { id: true, company: true } },
            department: { select: { id: true, name: true, slaResponseHours: true, slaResolutionHours: true } },
            replies: { select: { createdAt: true }, orderBy: { createdAt: 'asc' as const }, take: 1 },
          },
        }),
        tx.ticket.count({ where }),
      ]);

      // Compute SLA status for each ticket
      const now = new Date();
      const enriched = data.map((ticket: any) => {
        const dept = ticket.department;
        const createdAt = new Date(ticket.createdAt);
        const firstReplyAt = ticket.replies?.[0]?.createdAt ? new Date(ticket.replies[0].createdAt) : null;
        const closedAt = ticket.closedAt ? new Date(ticket.closedAt) : null;

        let slaResponseStatus: 'ok' | 'warning' | 'breached' | null = null;
        let slaResolutionStatus: 'ok' | 'warning' | 'breached' | null = null;
        let slaResponseRemaining: number | null = null;
        let slaResolutionRemaining: number | null = null;

        if (dept?.slaResponseHours) {
          const slaMs = dept.slaResponseHours * 3600000;
          if (firstReplyAt) {
            const elapsed = firstReplyAt.getTime() - createdAt.getTime();
            slaResponseStatus = elapsed > slaMs ? 'breached' : elapsed > slaMs * 0.8 ? 'warning' : 'ok';
            slaResponseRemaining = Math.round((slaMs - elapsed) / 60000);
          } else if (ticket.status !== 'closed') {
            const elapsed = now.getTime() - createdAt.getTime();
            slaResponseStatus = elapsed > slaMs ? 'breached' : elapsed > slaMs * 0.8 ? 'warning' : 'ok';
            slaResponseRemaining = Math.round((slaMs - elapsed) / 60000);
          }
        }

        if (dept?.slaResolutionHours) {
          const slaMs = dept.slaResolutionHours * 3600000;
          if (closedAt) {
            const elapsed = closedAt.getTime() - createdAt.getTime();
            slaResolutionStatus = elapsed > slaMs ? 'breached' : elapsed > slaMs * 0.8 ? 'warning' : 'ok';
            slaResolutionRemaining = Math.round((slaMs - elapsed) / 60000);
          } else if (ticket.status !== 'closed') {
            const elapsed = now.getTime() - createdAt.getTime();
            slaResolutionStatus = elapsed > slaMs ? 'breached' : elapsed > slaMs * 0.8 ? 'warning' : 'ok';
            slaResolutionRemaining = Math.round((slaMs - elapsed) / 60000);
          }
        }

        const { replies: _replies, ...ticketData } = ticket;
        return {
          ...ticketData,
          slaResponseStatus,
          slaResolutionStatus,
          slaResponseRemaining,
          slaResolutionRemaining,
        };
      });

      return { data: enriched, total, page, limit, totalPages: Math.ceil(total / limit) };
    });
  }

  // ─── findOne ───────────────────────────────────────────────────────────────

  async findOne(orgId: string, id: string) {
    return this.prisma.withOrganization(orgId, async (tx) => {
      const ticket = await (tx as any).ticket.findFirst({
        where: { id, organizationId: orgId },
        include: {
          client: true,
          department: true,
          replies: {
            orderBy: { createdAt: 'asc' },
          },
        },
      });
      if (!ticket) throw new NotFoundException('Ticket not found');
      return ticket;
    });
  }

  // ─── create ────────────────────────────────────────────────────────────────

  async create(orgId: string, dto: CreateTicketDto, createdBy: string) {
    const ticket = await this.prisma.withOrganization(orgId, async (tx) => {
      return tx.ticket.create({
        data: {
          organizationId: orgId,
          subject: dto.subject,
          message: dto.message ?? null,
          clientId: dto.clientId ?? null,
          contactId: dto.contactId ?? null,
          departmentId: dto.departmentId ?? null,
          priority: dto.priority ?? 'medium',
          service: dto.service ?? null,
          source: dto.source ?? null,
          status: 'open',
          assignedTo: createdBy,
          lastReplyAt: new Date(),
        },
        include: {
          client: { select: { id: true, company: true } },
          department: { select: { name: true } },
        },
      });
    });

    this.events.emit('ticket.created', { ticket, orgId, createdBy });
    return ticket;
  }

  // ─── reply ─────────────────────────────────────────────────────────────────

  async reply(
    orgId: string,
    ticketId: string,
    dto: CreateReplyDto,
    userId: string,
  ) {
    await this.findOne(orgId, ticketId);

    const isStaff = dto.isStaff ?? true;
    const isInternal = dto.isInternal ?? false;
    // Internal notes should not change ticket status
    const newStatus = isInternal ? undefined : (isStaff ? 'answered' : 'open');

    const reply = await this.prisma.withOrganization(orgId, async (tx) => {
      const [created] = await Promise.all([
        (tx as any).ticketReply.create({
          data: {
            ticketId,
            userId,
            message: dto.message,
            isInternal: dto.isInternal ?? false,
          },
        }),
        tx.ticket.update({
          where: { id: ticketId },
          data: {
            lastReplyAt: new Date(),
            ...(newStatus && { status: newStatus }),
          },
        }),
      ]);
      return created;
    });

    this.events.emit('ticket.replied', { reply, ticketId, orgId, userId });
    return reply;
  }

  // ─── updateStatus ──────────────────────────────────────────────────────────

  async updateStatus(orgId: string, id: string, status: string) {
    await this.findOne(orgId, id);

    const updated = await this.prisma.withOrganization(orgId, async (tx) => {
      return (tx as any).ticket.update({
        where: { id },
        data: {
          status,
          ...(status === 'closed' && { closedAt: new Date() }),
        },
        include: {
          client: {
            select: {
              id: true,
              company: true,
              contacts: { select: { email: true }, where: { isPrimary: true }, take: 1 },
            },
          },
        },
      });
    });

    this.events.emit('ticket.status_changed', { ticket: updated, orgId, status });

    // Feature 5: Trigger satisfaction survey when ticket is closed
    if (status === 'closed') {
      try {
        const org = await this.prisma.organization.findUnique({ where: { id: orgId } });
        const settings = (org?.settings as any) ?? {};
        if (settings.ticketSatisfactionSurvey) {
          const contactEmail = updated.client?.contacts?.[0]?.email;
          if (contactEmail) {
            this.events.emit('ticket.satisfaction_survey', {
              ticket: updated,
              orgId,
              contactEmail,
              orgName: org?.name ?? 'Our Team',
            });
          }
        }
      } catch {
        // Non-critical — don't fail ticket status update
      }
    }

    return updated;
  }

  // ─── assign ────────────────────────────────────────────────────────────────

  async assign(orgId: string, id: string, assignedTo: string) {
    await this.findOne(orgId, id);

    const updated = await this.prisma.withOrganization(orgId, async (tx) => {
      return (tx as any).ticket.update({
        where: { id },
        data: { assignedTo },
      });
    });

    this.events.emit('ticket.assigned', { ticket: updated, orgId, assignedTo });
    return updated;
  }

  // ─── delete ────────────────────────────────────────────────────────────────

  async delete(orgId: string, id: string) {
    await this.findOne(orgId, id);
    await this.prisma.withOrganization(orgId, async (tx) => {
      await tx.ticketReply.deleteMany({ where: { ticketId: id } });
      await tx.ticket.delete({ where: { id } });
    });
    this.events.emit('ticket.deleted', { id, orgId });
  }

  // ─── getDepartments ────────────────────────────────────────────────────────

  async getDepartments(orgId: string) {
    return this.prisma.withOrganization(orgId, async (tx) => {
      return tx.department.findMany({
        where: { organizationId: orgId },
        include: { _count: { select: { tickets: true } } },
        orderBy: { name: 'asc' },
      });
    });
  }

  // ─── createDepartment ─────────────────────────────────────────────────────

  async createDepartment(orgId: string, name: string, email?: string, slaResponseHours?: number | null, slaResolutionHours?: number | null) {
    return this.prisma.withOrganization(orgId, async (tx) => {
      return tx.department.create({
        data: {
          organizationId: orgId,
          name,
          email: email ?? null,
          slaResponseHours: slaResponseHours ?? null,
          slaResolutionHours: slaResolutionHours ?? null,
        },
      });
    });
  }

  async updateDepartment(orgId: string, id: string, data: { name?: string; email?: string; slaResponseHours?: number | null; slaResolutionHours?: number | null }) {
    return this.prisma.withOrganization(orgId, async (tx) => {
      const existing = await tx.department.findFirst({ where: { id, organizationId: orgId } });
      if (!existing) throw new NotFoundException('Department not found');
      return tx.department.update({
        where: { id },
        data: {
          ...(data.name !== undefined && { name: data.name }),
          ...(data.email !== undefined && { email: data.email || null }),
          ...(data.slaResponseHours !== undefined && { slaResponseHours: data.slaResponseHours }),
          ...(data.slaResolutionHours !== undefined && { slaResolutionHours: data.slaResolutionHours }),
        },
        include: { _count: { select: { tickets: true } } },
      });
    });
  }

  async deleteDepartment(orgId: string, id: string) {
    return this.prisma.withOrganization(orgId, async (tx) => {
      const existing = await tx.department.findFirst({ where: { id, organizationId: orgId } });
      if (!existing) throw new NotFoundException('Department not found');
      // Unlink tickets from this department
      await tx.ticket.updateMany({ where: { departmentId: id, organizationId: orgId }, data: { departmentId: null } });
      await tx.department.delete({ where: { id } });
    });
  }

  // ─── getSlaReport ──────────────────────────────────────────────────────────

  async getSlaReport(orgId: string) {
    return this.prisma.withOrganization(orgId, async (tx) => {
      // Get all tickets with department SLA info
      const tickets = await (tx as any).ticket.findMany({
        where: { organizationId: orgId },
        include: {
          department: { select: { slaResponseHours: true, slaResolutionHours: true } },
          replies: { select: { createdAt: true }, orderBy: { createdAt: 'asc' as const }, take: 1 },
        },
      });

      let totalWithResponseSla = 0;
      let respondedWithinSla = 0;
      let totalWithResolutionSla = 0;
      let resolvedWithinSla = 0;
      let totalResponseTimeMs = 0;
      let responseCount = 0;
      let totalResolutionTimeMs = 0;
      let resolutionCount = 0;

      for (const ticket of tickets) {
        const dept = ticket.department;
        const createdAt = new Date(ticket.createdAt);
        const firstReplyAt = ticket.replies?.[0]?.createdAt ? new Date(ticket.replies[0].createdAt) : null;
        const closedAt = ticket.closedAt ? new Date(ticket.closedAt) : null;

        if (firstReplyAt) {
          const responseMs = firstReplyAt.getTime() - createdAt.getTime();
          totalResponseTimeMs += responseMs;
          responseCount++;

          if (dept?.slaResponseHours) {
            totalWithResponseSla++;
            if (responseMs <= dept.slaResponseHours * 3600000) {
              respondedWithinSla++;
            }
          }
        }

        if (closedAt) {
          const resolutionMs = closedAt.getTime() - createdAt.getTime();
          totalResolutionTimeMs += resolutionMs;
          resolutionCount++;

          if (dept?.slaResolutionHours) {
            totalWithResolutionSla++;
            if (resolutionMs <= dept.slaResolutionHours * 3600000) {
              resolvedWithinSla++;
            }
          }
        }
      }

      return {
        responseCompliance: totalWithResponseSla > 0
          ? Math.round((respondedWithinSla / totalWithResponseSla) * 100)
          : null,
        resolutionCompliance: totalWithResolutionSla > 0
          ? Math.round((resolvedWithinSla / totalWithResolutionSla) * 100)
          : null,
        avgResponseTimeHours: responseCount > 0
          ? +(totalResponseTimeMs / responseCount / 3600000).toFixed(2)
          : null,
        avgResolutionTimeHours: resolutionCount > 0
          ? +(totalResolutionTimeMs / resolutionCount / 3600000).toFixed(2)
          : null,
        totalTickets: tickets.length,
        ticketsWithResponseSla: totalWithResponseSla,
        ticketsWithResolutionSla: totalWithResolutionSla,
      };
    });
  }

  // ─── merge ──────────────────────────────────────────────────────────────────

  async merge(orgId: string, targetTicketId: string, sourceTicketId: string) {
    return this.prisma.withOrganization(orgId, async (tx) => {
      const target = await tx.ticket.findFirst({ where: { id: targetTicketId, organizationId: orgId } });
      const source = await tx.ticket.findFirst({ where: { id: sourceTicketId, organizationId: orgId } });
      if (!target || !source) throw new NotFoundException('Ticket not found');
      if (targetTicketId === sourceTicketId) throw new BadRequestException('Cannot merge a ticket with itself');

      // Move all replies from source to target
      await tx.ticketReply.updateMany({
        where: { ticketId: sourceTicketId },
        data: { ticketId: targetTicketId },
      });

      // Add a system note to target
      await tx.ticketReply.create({
        data: {
          ticketId: targetTicketId,
          userId: target.assignedTo ?? target.contactId ?? '',
          message: `[System] Merged from ticket #${source.subject ?? sourceTicketId}`,
        },
      });

      // Close source ticket
      await tx.ticket.update({
        where: { id: sourceTicketId },
        data: { status: 'closed', closedAt: new Date() },
      });

      // Update target lastReplyAt
      await tx.ticket.update({
        where: { id: targetTicketId },
        data: { lastReplyAt: new Date() },
      });

      return target;
    });
  }

  // ─── getStats ─────────────────────────────────────────────────────────────

  async getStats(orgId: string) {
    return this.prisma.withOrganization(orgId, async (tx) => {
      const [open, in_progress, answered, on_hold, closed, urgent] =
        await Promise.all([
          tx.ticket.count({ where: { organizationId: orgId, status: 'open' } }),
          tx.ticket.count({ where: { organizationId: orgId, status: 'in_progress' } }),
          tx.ticket.count({ where: { organizationId: orgId, status: 'answered' } }),
          tx.ticket.count({ where: { organizationId: orgId, status: 'on_hold' } }),
          tx.ticket.count({ where: { organizationId: orgId, status: 'closed' } }),
          tx.ticket.count({ where: { organizationId: orgId, priority: 'urgent' } }),
        ]);

      return { open, in_progress, answered, on_hold, closed, urgent };
    });
  }
}
