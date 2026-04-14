import { Injectable, NotFoundException } from '@nestjs/common';
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
        tx.ticket.findMany({
          where,
          skip,
          take: limit,
          orderBy: { lastReplyAt: 'desc' },
          include: {
            client: { select: { id: true, company: true } },
            assignee: { select: { firstName: true, lastName: true } },
            department: { select: { name: true } },
          },
        }),
        tx.ticket.count({ where }),
      ]);

      return { data, total, page, limit, totalPages: Math.ceil(total / limit) };
    });
  }

  // ─── findOne ───────────────────────────────────────────────────────────────

  async findOne(orgId: string, id: string) {
    return this.prisma.withOrganization(orgId, async (tx) => {
      const ticket = await tx.ticket.findFirst({
        where: { id, organizationId: orgId },
        include: {
          client: true,
          contact: true,
          department: true,
          assignee: { select: { id: true, firstName: true, lastName: true } },
          replies: {
            orderBy: { createdAt: 'asc' },
            include: {
              user: { select: { id: true, firstName: true, lastName: true } },
            },
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
    const newStatus = isStaff ? 'answered' : 'open';

    const reply = await this.prisma.withOrganization(orgId, async (tx) => {
      const [created] = await Promise.all([
        tx.ticketReply.create({
          data: {
            ticketId,
            userId,
            message: dto.message,
            isStaff,
          },
          include: {
            user: { select: { id: true, firstName: true, lastName: true } },
          },
        }),
        tx.ticket.update({
          where: { id: ticketId },
          data: {
            lastReplyAt: new Date(),
            status: newStatus,
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
      return tx.ticket.update({
        where: { id },
        data: {
          status,
          ...(status === 'closed' && { closedAt: new Date() }),
        },
      });
    });

    this.events.emit('ticket.status_changed', { ticket: updated, orgId, status });
    return updated;
  }

  // ─── assign ────────────────────────────────────────────────────────────────

  async assign(orgId: string, id: string, assignedTo: string) {
    await this.findOne(orgId, id);

    const updated = await this.prisma.withOrganization(orgId, async (tx) => {
      return tx.ticket.update({
        where: { id },
        data: { assignedTo },
        include: {
          assignee: { select: { id: true, firstName: true, lastName: true } },
        },
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

  async createDepartment(orgId: string, name: string, email?: string) {
    return this.prisma.withOrganization(orgId, async (tx) => {
      return tx.department.create({
        data: {
          organizationId: orgId,
          name,
          email: email ?? null,
        },
      });
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
