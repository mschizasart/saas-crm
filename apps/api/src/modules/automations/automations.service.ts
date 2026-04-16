import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { PrismaService } from '../../database/prisma.service';
import { EmailsService } from '../emails/emails.service';
import { NotificationsService } from '../notifications/notifications.service';

export interface CreateAutomationDto {
  name: string;
  trigger: string;
  conditions?: any;
  actions: any[];
  active?: boolean;
}

export interface UpdateAutomationDto {
  name?: string;
  trigger?: string;
  conditions?: any;
  actions?: any[];
  active?: boolean;
}

@Injectable()
export class AutomationsService {
  private readonly logger = new Logger(AutomationsService.name);

  constructor(
    private prisma: PrismaService,
    private emails: EmailsService,
    private notifications: NotificationsService,
  ) {}

  // ─── CRUD ──────────────────────────────────────────────────────────────────

  async findAll(orgId: string) {
    return this.prisma.automationRule.findMany({
      where: { organizationId: orgId },
      orderBy: { createdAt: 'desc' },
    });
  }

  async create(orgId: string, dto: CreateAutomationDto) {
    return this.prisma.automationRule.create({
      data: {
        organizationId: orgId,
        name: dto.name,
        trigger: dto.trigger,
        conditions: dto.conditions ?? null,
        actions: dto.actions,
        active: dto.active ?? true,
      },
    });
  }

  async update(orgId: string, id: string, dto: UpdateAutomationDto) {
    const existing = await this.prisma.automationRule.findFirst({
      where: { id, organizationId: orgId },
    });
    if (!existing) throw new NotFoundException('Automation rule not found');

    return this.prisma.automationRule.update({
      where: { id },
      data: {
        ...(dto.name !== undefined && { name: dto.name }),
        ...(dto.trigger !== undefined && { trigger: dto.trigger }),
        ...(dto.conditions !== undefined && { conditions: dto.conditions }),
        ...(dto.actions !== undefined && { actions: dto.actions }),
        ...(dto.active !== undefined && { active: dto.active }),
      },
    });
  }

  async delete(orgId: string, id: string) {
    const existing = await this.prisma.automationRule.findFirst({
      where: { id, organizationId: orgId },
    });
    if (!existing) throw new NotFoundException('Automation rule not found');
    await this.prisma.automationRule.delete({ where: { id } });
  }

  // ─── Rule Engine ──────────────────────────────────────────────────────────

  async processEvent(orgId: string, eventName: string, payload: any) {
    try {
      const rules = await this.prisma.automationRule.findMany({
        where: {
          organizationId: orgId,
          trigger: eventName,
          active: true,
        },
      });

      for (const rule of rules) {
        try {
          if (!this.evaluateConditions(rule.conditions, payload)) continue;

          const actions = rule.actions as any[];
          if (!Array.isArray(actions)) continue;

          for (const action of actions) {
            await this.executeAction(orgId, action, payload);
          }
        } catch (err) {
          this.logger.error(`Error executing rule ${rule.id}: ${err}`);
        }
      }
    } catch (err) {
      this.logger.error(`Error processing event ${eventName}: ${err}`);
    }
  }

  private evaluateConditions(conditions: any, payload: any): boolean {
    if (!conditions) return true;

    const { field, operator, value } = conditions;
    if (!field || !operator) return true;

    // Navigate the payload to find the field value
    const entityData = payload.ticket ?? payload.invoice ?? payload.lead ?? payload.task ?? payload;
    const fieldValue = entityData?.[field];

    switch (operator) {
      case 'equals':
        return String(fieldValue) === String(value);
      case 'not_equals':
        return String(fieldValue) !== String(value);
      case 'contains':
        return String(fieldValue ?? '').toLowerCase().includes(String(value).toLowerCase());
      case 'greater_than':
        return Number(fieldValue) > Number(value);
      case 'less_than':
        return Number(fieldValue) < Number(value);
      default:
        return true;
    }
  }

  private async executeAction(orgId: string, action: any, payload: any) {
    const { type, config } = action;
    if (!type || !config) return;

    switch (type) {
      case 'send_email':
        await this.emails.queue({
          to: config.to,
          subject: config.subject ?? 'Automation Notification',
          html: config.body ?? '<p>Automated notification</p>',
        });
        break;

      case 'update_field': {
        const entityType = config.entityType;
        const entityData = payload.ticket ?? payload.invoice ?? payload.lead ?? payload.task ?? payload;
        const entityId = entityData?.id;
        if (!entityId || !config.field || config.value === undefined) break;

        const model = this.getModel(entityType);
        if (model) {
          await (this.prisma as any)[model].update({
            where: { id: entityId },
            data: { [config.field]: config.value },
          });
        }
        break;
      }

      case 'create_task':
        await this.prisma.task.create({
          data: {
            organizationId: orgId,
            name: config.name ?? 'Follow-up task',
            dueDate: config.dueDate ? new Date(config.dueDate) : null,
            status: 'not_started',
            priority: 'medium',
            ...(config.assignedTo && {
              assignments: { create: { userId: config.assignedTo } },
            }),
          },
        });
        break;

      case 'notify':
        if (config.userId && config.message) {
          await this.notifications.create(config.userId, orgId, {
            title: config.message,
            type: 'automation',
          });
        }
        break;

      case 'webhook':
        if (config.url) {
          try {
            const controller = new AbortController();
            const timeout = setTimeout(() => controller.abort(), 10000);
            await fetch(config.url, {
              method: config.method ?? 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify(payload),
              signal: controller.signal,
            });
            clearTimeout(timeout);
          } catch (err) {
            this.logger.warn(`Webhook action failed for ${config.url}: ${err}`);
          }
        }
        break;

      default:
        this.logger.warn(`Unknown action type: ${type}`);
    }
  }

  private getModel(entityType: string): string | null {
    const map: Record<string, string> = {
      ticket: 'ticket',
      invoice: 'invoice',
      lead: 'lead',
      task: 'task',
      project: 'project',
      client: 'client',
      estimate: 'estimate',
      proposal: 'proposal',
      contract: 'contract',
      expense: 'expense',
    };
    return map[entityType] ?? null;
  }

  // ─── Event Listeners ──────────────────────────────────────────────────────

  @OnEvent('invoice.created')
  onInvoiceCreated(p: any) { this.processEvent(p.orgId, 'invoice.created', p); }

  @OnEvent('invoice.overdue')
  onInvoiceOverdue(p: any) { this.processEvent(p.orgId, 'invoice.overdue', p); }

  @OnEvent('invoice.sent')
  onInvoiceSent(p: any) { this.processEvent(p.orgId, 'invoice.sent', p); }

  @OnEvent('lead.status_changed')
  onLeadStatusChanged(p: any) { this.processEvent(p.orgId, 'lead.status_changed', p); }

  @OnEvent('lead.assigned')
  onLeadAssigned(p: any) { this.processEvent(p.orgId, 'lead.assigned', p); }

  @OnEvent('ticket.created')
  onTicketCreated(p: any) { this.processEvent(p.orgId, 'ticket.created', p); }

  @OnEvent('ticket.status_changed')
  onTicketStatusChanged(p: any) { this.processEvent(p.orgId, 'ticket.status_changed', p); }

  @OnEvent('ticket.replied')
  onTicketReplied(p: any) { this.processEvent(p.orgId, 'ticket.replied', p); }

  @OnEvent('task.created')
  onTaskCreated(p: any) { this.processEvent(p.orgId, 'task.created', p); }

  @OnEvent('task.completed')
  onTaskCompleted(p: any) { this.processEvent(p.orgId, 'task.completed', p); }

  @OnEvent('project.created')
  onProjectCreated(p: any) { this.processEvent(p.orgId, 'project.created', p); }

  @OnEvent('client.created')
  onClientCreated(p: any) { this.processEvent(p.orgId, 'client.created', p); }

  @OnEvent('estimate.sent')
  onEstimateSent(p: any) { this.processEvent(p.orgId, 'estimate.sent', p); }

  @OnEvent('contract.signed')
  onContractSigned(p: any) { this.processEvent(p.orgId, 'contract.signed', p); }

  @OnEvent('payment.received')
  onPaymentReceived(p: any) { this.processEvent(p.orgId, 'payment.received', p); }
}
