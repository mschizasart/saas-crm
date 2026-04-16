import { Injectable } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { PrismaService } from '../../database/prisma.service';

export interface LogInput {
  userId?: string;
  action: string;
  entityType?: string;
  entityId?: string;
  description: string;
  metadata?: Record<string, any>;
  ipAddress?: string;
  userAgent?: string;
}

@Injectable()
export class ActivityLogService {
  constructor(private prisma: PrismaService) {}

  async log(orgId: string, data: LogInput) {
    // Schema fields: action, relType, relId, description, additionalData, ipAddress
    // No userAgent column — merged into additionalData.
    const additionalData: Record<string, any> | null = data.metadata
      ? { ...data.metadata, ...(data.userAgent ? { userAgent: data.userAgent } : {}) }
      : data.userAgent
        ? { userAgent: data.userAgent }
        : null;

    return this.prisma.activityLog.create({
      data: {
        organizationId: orgId,
        userId: data.userId ?? null,
        action: data.action,
        relType: data.entityType ?? null,
        relId: data.entityId ?? null,
        description: data.description,
        additionalData: additionalData ?? undefined,
        ipAddress: data.ipAddress ?? null,
      },
    });
  }

  async findAll(
    orgId: string,
    query: {
      userId?: string;
      entityType?: string;
      entityId?: string;
      from?: string;
      to?: string;
      page?: number;
      limit?: number;
    },
  ) {
    const page = Number(query.page) || 1;
    const limit = Number(query.limit) || 25;
    const skip = (page - 1) * limit;

    const where: any = { organizationId: orgId };
    if (query.userId) where.userId = query.userId;
    if (query.entityType) where.relType = query.entityType;
    if (query.entityId) where.relId = query.entityId;
    if (query.from || query.to) {
      where.createdAt = {};
      if (query.from) where.createdAt.gte = new Date(query.from);
      if (query.to) where.createdAt.lte = new Date(query.to);
    }

    const [data, total] = await Promise.all([
      this.prisma.activityLog.findMany({
        where,
        skip,
        take: limit,
        orderBy: { createdAt: 'desc' },
        include: {
          user: { select: { id: true, firstName: true, lastName: true, avatar: true } },
        },
      }),
      this.prisma.activityLog.count({ where }),
    ]);

    return { data, total, page, limit, totalPages: Math.ceil(total / limit) };
  }

  async findByEntity(orgId: string, entityType: string, entityId: string) {
    return this.prisma.activityLog.findMany({
      where: { organizationId: orgId, relType: entityType, relId: entityId },
      orderBy: { createdAt: 'desc' },
      include: {
        user: { select: { id: true, firstName: true, lastName: true, avatar: true } },
      },
    });
  }

  // ─── Field-level change tracking ────────────────────────────────────────

  async logFieldChange(
    orgId: string,
    data: {
      userId: string;
      entityType: string;
      entityId: string;
      field: string;
      oldValue: string | null;
      newValue: string | null;
    },
  ) {
    await this.log(orgId, {
      userId: data.userId,
      action: `${data.entityType}.field_changed`,
      entityType: data.entityType,
      entityId: data.entityId,
      description: `Changed ${data.field} from "${data.oldValue ?? '(empty)'}" to "${data.newValue ?? '(empty)'}"`,
      metadata: {
        field: data.field,
        oldValue: data.oldValue,
        newValue: data.newValue,
      },
    });
  }

  async logEntityUpdate(
    orgId: string,
    userId: string,
    entityType: string,
    entityId: string,
    oldData: any,
    newData: any,
  ) {
    for (const key of Object.keys(newData)) {
      const oldVal = oldData[key];
      const newVal = newData[key];
      if (oldVal !== newVal) {
        await this.logFieldChange(orgId, {
          userId,
          entityType,
          entityId,
          field: key,
          oldValue: oldVal != null ? String(oldVal) : null,
          newValue: newVal != null ? String(newVal) : null,
        });
      }
    }
  }

  // ─── Event listeners ───────────────────────────────────────────────────

  @OnEvent('client.created')
  async onClientCreated(payload: { client: any; orgId: string; createdBy: string }) {
    await this.log(payload.orgId, {
      userId: payload.createdBy,
      action: 'client.created',
      entityType: 'client',
      entityId: payload.client?.id,
      description: `Created client ${payload.client?.company ?? ''}`.trim(),
    });
  }

  @OnEvent('client.deleted')
  async onClientDeleted(payload: { id: string; orgId: string; userId?: string }) {
    await this.log(payload.orgId, {
      userId: payload.userId,
      action: 'client.deleted',
      entityType: 'client',
      entityId: payload.id,
      description: `Deleted client ${payload.id}`,
    });
  }

  @OnEvent('invoice.created')
  async onInvoiceCreated(payload: { invoice: any; orgId: string; createdBy: string }) {
    await this.log(payload.orgId, {
      userId: payload.createdBy,
      action: 'invoice.created',
      entityType: 'invoice',
      entityId: payload.invoice?.id,
      description: `Created invoice ${payload.invoice?.number ?? ''}`.trim(),
    });
  }

  @OnEvent('invoice.sent')
  async onInvoiceSent(payload: { invoice: any; orgId: string; userId?: string }) {
    await this.log(payload.orgId, {
      userId: payload.userId,
      action: 'invoice.sent',
      entityType: 'invoice',
      entityId: payload.invoice?.id,
      description: `Sent invoice ${payload.invoice?.number ?? ''}`.trim(),
    });
  }

  @OnEvent('invoice.status_changed')
  async onInvoiceStatusChanged(payload: {
    invoice: any;
    orgId: string;
    previousStatus: string;
    newStatus: string;
    userId?: string;
  }) {
    await this.log(payload.orgId, {
      userId: payload.userId,
      action: 'invoice.status_changed',
      entityType: 'invoice',
      entityId: payload.invoice?.id,
      description: `Invoice ${payload.invoice?.number ?? ''} status: ${payload.previousStatus} → ${payload.newStatus}`,
      metadata: { previousStatus: payload.previousStatus, newStatus: payload.newStatus },
    });
  }

  @OnEvent('lead.created')
  async onLeadCreated(payload: { lead: any; orgId: string; createdBy?: string }) {
    await this.log(payload.orgId, {
      userId: payload.createdBy,
      action: 'lead.created',
      entityType: 'lead',
      entityId: payload.lead?.id,
      description: `Created lead ${payload.lead?.name ?? ''}`.trim(),
    });
  }

  @OnEvent('lead.status_changed')
  async onLeadStatusChanged(payload: {
    lead: any;
    orgId: string;
    previousStatus?: string;
    newStatus?: string;
    userId?: string;
  }) {
    await this.log(payload.orgId, {
      userId: payload.userId,
      action: 'lead.status_changed',
      entityType: 'lead',
      entityId: payload.lead?.id,
      description: `Lead status changed to ${payload.newStatus ?? '?'}`,
      metadata: { previousStatus: payload.previousStatus, newStatus: payload.newStatus },
    });
  }

  @OnEvent('lead.converted')
  async onLeadConverted(payload: { lead: any; orgId: string; clientId?: string; userId?: string }) {
    await this.log(payload.orgId, {
      userId: payload.userId,
      action: 'lead.converted',
      entityType: 'lead',
      entityId: payload.lead?.id,
      description: `Converted lead ${payload.lead?.name ?? ''} to client`.trim(),
      metadata: { clientId: payload.clientId },
    });
  }

  @OnEvent('ticket.created')
  async onTicketCreated(payload: { ticket: any; orgId: string; createdBy?: string }) {
    await this.log(payload.orgId, {
      userId: payload.createdBy,
      action: 'ticket.created',
      entityType: 'ticket',
      entityId: payload.ticket?.id,
      description: `Created ticket ${payload.ticket?.subject ?? ''}`.trim(),
    });
  }

  @OnEvent('ticket.replied')
  async onTicketReplied(payload: { ticket: any; orgId: string; userId?: string }) {
    await this.log(payload.orgId, {
      userId: payload.userId,
      action: 'ticket.replied',
      entityType: 'ticket',
      entityId: payload.ticket?.id,
      description: `Replied to ticket ${payload.ticket?.subject ?? ''}`.trim(),
    });
  }

  @OnEvent('ticket.status_changed')
  async onTicketStatusChanged(payload: {
    ticket: any;
    orgId: string;
    previousStatus?: string;
    newStatus?: string;
    userId?: string;
  }) {
    await this.log(payload.orgId, {
      userId: payload.userId,
      action: 'ticket.status_changed',
      entityType: 'ticket',
      entityId: payload.ticket?.id,
      description: `Ticket status changed to ${payload.newStatus ?? '?'}`,
      metadata: { previousStatus: payload.previousStatus, newStatus: payload.newStatus },
    });
  }

  @OnEvent('project.created')
  async onProjectCreated(payload: { project: any; orgId: string; createdBy?: string }) {
    await this.log(payload.orgId, {
      userId: payload.createdBy,
      action: 'project.created',
      entityType: 'project',
      entityId: payload.project?.id,
      description: `Created project ${payload.project?.name ?? ''}`.trim(),
    });
  }

  @OnEvent('contract.signed')
  async onContractSigned(payload: { contract: any; orgId: string; userId?: string }) {
    await this.log(payload.orgId, {
      userId: payload.userId,
      action: 'contract.signed',
      entityType: 'contract',
      entityId: payload.contract?.id,
      description: `Contract ${payload.contract?.subject ?? ''} signed`.trim(),
    });
  }
}
