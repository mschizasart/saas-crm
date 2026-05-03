import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { OnEvent, EventEmitter2 } from '@nestjs/event-emitter';
import { PrismaService } from '../../database/prisma.service';
import { PushService } from '../push/push.service';

export interface CreateNotificationDto {
  type?: string;
  title: string;
  body?: string;
  link?: string;
}

@Injectable()
export class NotificationsService {
  private readonly log = new Logger(NotificationsService.name);

  constructor(
    private prisma: PrismaService,
    private events: EventEmitter2,
    private push: PushService,
  ) {}

  async create(userId: string, orgId: string, dto: CreateNotificationDto) {
    // Schema uses `description` instead of `body`.
    const notification = await this.prisma.notification.create({
      data: {
        organizationId: orgId,
        userId,
        type: dto.type ?? null,
        title: dto.title,
        description: dto.body ?? null,
        link: dto.link ?? null,
      },
    });
    this.events.emit('notification.created', { notification });

    // Fan out as a web push too. Best-effort — push failures must NOT
    // break the in-app notification path. We swallow errors and log.
    // The url is the notification's deep-link; tag groups by type so
    // repeated events of the same type collapse in the tray.
    this.push
      .sendToUser(userId, {
        title: dto.title,
        body: dto.body,
        url: dto.link ?? '/notifications',
        tag: dto.type ?? 'notification',
      })
      .catch((err) => {
        this.log.warn(`Push fan-out failed for user=${userId}: ${err?.message ?? err}`);
      });

    return notification;
  }

  async findForUser(
    userId: string,
    query: { unreadOnly?: boolean; page?: number; limit?: number },
  ) {
    const page = Number(query.page) || 1;
    const limit = Number(query.limit) || 25;
    const skip = (page - 1) * limit;

    const where: any = { userId };
    if (query.unreadOnly) where.read = false;

    const [data, total] = await Promise.all([
      this.prisma.notification.findMany({
        where,
        skip,
        take: limit,
        orderBy: { createdAt: 'desc' },
      }),
      this.prisma.notification.count({ where }),
    ]);

    return { data, total, page, limit, totalPages: Math.ceil(total / limit) };
  }

  async markRead(userId: string, id: string) {
    const n = await this.prisma.notification.findFirst({ where: { id, userId } });
    if (!n) throw new NotFoundException('Notification not found');
    return this.prisma.notification.update({
      where: { id },
      data: { read: true, readAt: new Date() },
    });
  }

  async markAllRead(userId: string) {
    await this.prisma.notification.updateMany({
      where: { userId, read: false },
      data: { read: true, readAt: new Date() },
    });
    return { success: true };
  }

  async delete(userId: string, id: string) {
    const n = await this.prisma.notification.findFirst({ where: { id, userId } });
    if (!n) throw new NotFoundException('Notification not found');
    await this.prisma.notification.delete({ where: { id } });
  }

  async getUnreadCount(userId: string) {
    const count = await this.prisma.notification.count({
      where: { userId, read: false },
    });
    return { count };
  }

  // ─── Event listeners ───────────────────────────────────────────────

  @OnEvent('ticket.assigned')
  async onTicketAssigned(payload: {
    ticket: any;
    orgId: string;
    assigneeId: string;
  }) {
    if (!payload.assigneeId) return;
    await this.create(payload.assigneeId, payload.orgId, {
      type: 'ticket',
      title: 'Ticket assigned to you',
      body: payload.ticket?.subject ?? undefined,
      link: `/tickets/${payload.ticket?.id}`,
    });
  }

  @OnEvent('invoice.overdue')
  async onInvoiceOverdue(payload: { invoice: any; orgId: string; creatorId?: string }) {
    if (!payload.creatorId) return;
    await this.create(payload.creatorId, payload.orgId, {
      type: 'invoice',
      title: 'Invoice overdue',
      body: `Invoice ${payload.invoice?.number ?? ''} is overdue`,
      link: `/invoices/${payload.invoice?.id}`,
    });
  }

  @OnEvent('lead.assigned')
  async onLeadAssigned(payload: { lead: any; orgId: string; assigneeId: string }) {
    if (!payload.assigneeId) return;
    await this.create(payload.assigneeId, payload.orgId, {
      type: 'lead',
      title: 'Lead assigned to you',
      body: payload.lead?.name ?? undefined,
      link: `/leads/${payload.lead?.id}`,
    });
  }

  @OnEvent('project.member_added')
  async onProjectMemberAdded(payload: {
    project: any;
    orgId: string;
    userId: string;
  }) {
    if (!payload.userId) return;
    await this.create(payload.userId, payload.orgId, {
      type: 'project',
      title: 'Added to project',
      body: payload.project?.name ?? undefined,
      link: `/projects/${payload.project?.id}`,
    });
  }
}
