import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { PrismaService } from '../../database/prisma.service';
import * as crypto from 'crypto';

export interface CreateWebhookDto {
  name: string;
  url: string;
  events: string[];
  secret?: string;
  active?: boolean;
}

export interface UpdateWebhookDto {
  name?: string;
  url?: string;
  events?: string[];
  secret?: string;
  active?: boolean;
}

@Injectable()
export class WebhooksService {
  private readonly logger = new Logger(WebhooksService.name);

  constructor(private prisma: PrismaService) {}

  // ─── CRUD ──────────────────────────────────────────────────────────────────

  async findAll(orgId: string) {
    return this.prisma.webhook.findMany({
      where: { organizationId: orgId },
      orderBy: { createdAt: 'desc' },
    });
  }

  async create(orgId: string, dto: CreateWebhookDto) {
    const secret = dto.secret || crypto.randomBytes(32).toString('hex');
    return this.prisma.webhook.create({
      data: {
        organizationId: orgId,
        name: dto.name,
        url: dto.url,
        events: dto.events,
        secret,
        active: dto.active ?? true,
      },
    });
  }

  async update(orgId: string, id: string, dto: UpdateWebhookDto) {
    const existing = await this.prisma.webhook.findFirst({
      where: { id, organizationId: orgId },
    });
    if (!existing) throw new NotFoundException('Webhook not found');

    return this.prisma.webhook.update({
      where: { id },
      data: {
        ...(dto.name !== undefined && { name: dto.name }),
        ...(dto.url !== undefined && { url: dto.url }),
        ...(dto.events !== undefined && { events: dto.events }),
        ...(dto.secret !== undefined && { secret: dto.secret }),
        ...(dto.active !== undefined && { active: dto.active }),
      },
    });
  }

  async delete(orgId: string, id: string) {
    const existing = await this.prisma.webhook.findFirst({
      where: { id, organizationId: orgId },
    });
    if (!existing) throw new NotFoundException('Webhook not found');
    await this.prisma.webhook.delete({ where: { id } });
  }

  async test(orgId: string, id: string) {
    const webhook = await this.prisma.webhook.findFirst({
      where: { id, organizationId: orgId },
    });
    if (!webhook) throw new NotFoundException('Webhook not found');

    const testPayload = {
      event: 'webhook.test',
      timestamp: new Date().toISOString(),
      data: { message: 'This is a test webhook delivery' },
    };

    return this.deliverWebhook(webhook, testPayload);
  }

  // ─── Delivery ─────────────────────────────────────────────────────────────

  async fireWebhooks(orgId: string, eventName: string, payload: any) {
    try {
      const webhooks = await this.prisma.webhook.findMany({
        where: {
          organizationId: orgId,
          active: true,
          events: { has: eventName },
        },
      });

      for (const webhook of webhooks) {
        // Fire-and-forget
        this.deliverWebhook(webhook, {
          event: eventName,
          timestamp: new Date().toISOString(),
          data: this.sanitizePayload(payload),
        }).catch((err) =>
          this.logger.warn(`Webhook delivery failed for ${webhook.id}: ${err}`),
        );
      }
    } catch (err) {
      this.logger.error(`Error firing webhooks for ${eventName}: ${err}`);
    }
  }

  private async deliverWebhook(webhook: any, payload: any) {
    const body = JSON.stringify(payload);
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'X-Webhook-Id': webhook.id,
    };

    // HMAC signature
    if (webhook.secret) {
      const signature = crypto
        .createHmac('sha256', webhook.secret)
        .update(body)
        .digest('hex');
      headers['X-Webhook-Signature'] = `sha256=${signature}`;
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10000);

    try {
      const res = await fetch(webhook.url, {
        method: 'POST',
        headers,
        body,
        signal: controller.signal,
      });

      // Update lastTriggeredAt
      await this.prisma.webhook.update({
        where: { id: webhook.id },
        data: { lastTriggeredAt: new Date() },
      });

      return { success: res.ok, status: res.status };
    } catch (err) {
      this.logger.warn(`Webhook delivery to ${webhook.url} failed: ${err}`);
      return { success: false, error: String(err) };
    } finally {
      clearTimeout(timeout);
    }
  }

  private sanitizePayload(payload: any): any {
    // Remove circular references and sensitive data
    try {
      const { password, secret, ...safe } = payload ?? {};
      return JSON.parse(JSON.stringify(safe));
    } catch {
      return { id: payload?.id };
    }
  }

  // ─── Event Listeners ──────────────────────────────────────────────────────

  @OnEvent('invoice.created')
  onInvoiceCreated(p: any) { if (p?.orgId) this.fireWebhooks(p.orgId, 'invoice.created', p); }

  @OnEvent('invoice.overdue')
  onInvoiceOverdue(p: any) { if (p?.orgId) this.fireWebhooks(p.orgId, 'invoice.overdue', p); }

  @OnEvent('invoice.sent')
  onInvoiceSent(p: any) { if (p?.orgId) this.fireWebhooks(p.orgId, 'invoice.sent', p); }

  @OnEvent('lead.status_changed')
  onLeadStatusChanged(p: any) { if (p?.orgId) this.fireWebhooks(p.orgId, 'lead.status_changed', p); }

  @OnEvent('lead.assigned')
  onLeadAssigned(p: any) { if (p?.orgId) this.fireWebhooks(p.orgId, 'lead.assigned', p); }

  @OnEvent('ticket.created')
  onTicketCreated(p: any) { if (p?.orgId) this.fireWebhooks(p.orgId, 'ticket.created', p); }

  @OnEvent('ticket.status_changed')
  onTicketStatusChanged(p: any) { if (p?.orgId) this.fireWebhooks(p.orgId, 'ticket.status_changed', p); }

  @OnEvent('ticket.replied')
  onTicketReplied(p: any) { if (p?.orgId) this.fireWebhooks(p.orgId, 'ticket.replied', p); }

  @OnEvent('task.created')
  onTaskCreated(p: any) { if (p?.orgId) this.fireWebhooks(p.orgId, 'task.created', p); }

  @OnEvent('task.completed')
  onTaskCompleted(p: any) { if (p?.orgId) this.fireWebhooks(p.orgId, 'task.completed', p); }

  @OnEvent('project.created')
  onProjectCreated(p: any) { if (p?.orgId) this.fireWebhooks(p.orgId, 'project.created', p); }

  @OnEvent('client.created')
  onClientCreated(p: any) { if (p?.orgId) this.fireWebhooks(p.orgId, 'client.created', p); }

  @OnEvent('estimate.sent')
  onEstimateSent(p: any) { if (p?.orgId) this.fireWebhooks(p.orgId, 'estimate.sent', p); }

  @OnEvent('contract.signed')
  onContractSigned(p: any) { if (p?.orgId) this.fireWebhooks(p.orgId, 'contract.signed', p); }

  @OnEvent('payment.received')
  onPaymentReceived(p: any) { if (p?.orgId) this.fireWebhooks(p.orgId, 'payment.received', p); }
}
