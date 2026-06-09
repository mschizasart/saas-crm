import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { PrismaService } from '../../database/prisma.service';
import { ALLOWED_EVENTS, AllowedEvent, isAllowedEvent } from './webhook-events';

/**
 * Public webhook dispatcher.
 *
 * Two entry-points:
 *   1. Direct: `dispatcher.emit(orgId, event, payload)` — what new code
 *      should call after a write commits.
 *   2. Event-bus: `@OnEvent('client.created')` style listeners that
 *      bridge the existing internal `EventEmitter2` bus (already used by
 *      clients.service, invoices.service, opportunities.service, etc.)
 *      into the public webhook surface. This is the non-invasive wiring:
 *      we don't have to modify any existing service file to start firing
 *      public webhooks — every internal emit is automatically considered
 *      for outbound public delivery.
 *
 * Delivery flow per webhook:
 *   - Find all ACTIVE webhooks in the org subscribed to the event.
 *   - For each, INSERT a `public_webhook_deliveries` row with
 *     `attemptCount=0` and `nextAttemptAt=now()` BEFORE enqueueing.
 *     The row is the source of truth for retry; BullMQ is only a scheduler.
 *   - Enqueue a `deliver` job carrying the delivery id; the processor
 *     reads the row, loads the webhook + secret, signs, and POSTs.
 */
@Injectable()
export class WebhookDispatcherService {
  private readonly logger = new Logger(WebhookDispatcherService.name);

  constructor(
    private readonly prisma: PrismaService,
    @InjectQueue('webhook-delivery') private readonly queue: Queue,
  ) {}

  /**
   * Public API — call this AFTER a write commits. Failures are swallowed
   * so a downstream queue issue can never roll back a successful business
   * transaction (the row stays in `public_webhook_deliveries` and the
   * retry scheduler will re-enqueue it).
   */
  async emit(
    orgId: string | undefined | null,
    event: AllowedEvent | string,
    payload: unknown,
  ): Promise<void> {
    if (!orgId) return;
    if (!isAllowedEvent(event)) {
      // Internal callers may emit events outside ALLOWED_EVENTS (the legacy
      // `WebhooksService` listens to a wider set). For the public surface we
      // hard-filter here so a typo in a service file can never become a
      // user-facing "you can subscribe to <broken>" bug.
      return;
    }
    try {
      // Subscribed webhooks for this org. `events` is a jsonb array; we
      // pull all-and-filter in memory because (a) it's a tiny set per org
      // and (b) Prisma's jsonb array containment APIs vary across versions.
      const webhooks = await this.prisma.publicWebhook.findMany({
        where: { organizationId: orgId, active: true },
        select: { id: true, events: true },
      });
      const subs = webhooks.filter((w) => {
        const evs = Array.isArray(w.events) ? (w.events as string[]) : [];
        return evs.includes(event);
      });
      if (subs.length === 0) return;

      const safePayload = this.toJsonSafe(payload);

      for (const wh of subs) {
        const row = await this.prisma.publicWebhookDelivery.create({
          data: {
            organizationId: orgId,
            webhookId: wh.id,
            event,
            payload: safePayload as any,
            attemptCount: 0,
            nextAttemptAt: new Date(),
            succeeded: false,
          },
          select: { id: true },
        });
        await this.queue.add(
          'deliver',
          { deliveryId: row.id, organizationId: orgId },
          {
            jobId: `deliver:${row.id}`,
            removeOnComplete: 1000,
            removeOnFail: 1000,
          },
        );
      }
    } catch (err) {
      this.logger.error(
        `Failed to dispatch webhooks for ${event} (org=${orgId}): ${(err as Error).message}`,
      );
    }
  }

  /**
   * Defensive: strip circular refs / non-JSON-serializable values before
   * stashing the payload in jsonb. Anything that fails to stringify becomes
   * a minimal { _unserializable: true } stub so the delivery still goes out.
   */
  private toJsonSafe(payload: unknown): unknown {
    try {
      return JSON.parse(JSON.stringify(payload ?? {}));
    } catch {
      return { _unserializable: true };
    }
  }

  // ─── Event-bus bridges (non-invasive wiring) ─────────────────
  //
  // The existing internal `EventEmitter2` bus already fires when records
  // are created/updated/sent. We hook each of those into the public
  // dispatcher here so no existing service file has to be touched. The
  // legacy `WebhooksService` listens to a similar set and is unaffected —
  // both dispatchers run independently.
  //
  // Payload shape note: internal emits use various shapes (see
  // clients.service.ts emits `{ client, orgId }`, invoices emits
  // `{ invoice, orgId }`). We extract the entity and forward it as the
  // public payload so the public webhook URL receives a consistent
  // `{ id, ...entity }` body.

  @OnEvent('client.created')
  onClientCreated(p: any) {
    return this.emit(p?.orgId, 'client.created', p?.client ?? p);
  }

  @OnEvent('client.updated')
  onClientUpdated(p: any) {
    return this.emit(p?.orgId, 'client.updated', p?.client ?? p);
  }

  @OnEvent('lead.created')
  onLeadCreated(p: any) {
    return this.emit(p?.orgId, 'lead.created', p?.lead ?? p);
  }

  @OnEvent('lead.updated')
  onLeadUpdated(p: any) {
    return this.emit(p?.orgId, 'lead.updated', p?.lead ?? p);
  }

  @OnEvent('lead.converted')
  onLeadConverted(p: any) {
    return this.emit(p?.orgId, 'lead.converted', p?.lead ?? p);
  }

  @OnEvent('opportunity.created')
  onOpportunityCreated(p: any) {
    return this.emit(p?.orgId, 'opportunity.created', p?.opportunity ?? p);
  }

  @OnEvent('opportunity.stage_changed')
  onOpportunityStageChanged(p: any) {
    return this.emit(p?.orgId, 'opportunity.stage_changed', p?.opportunity ?? p);
  }

  @OnEvent('invoice.created')
  onInvoiceCreated(p: any) {
    return this.emit(p?.orgId, 'invoice.created', p?.invoice ?? p);
  }

  @OnEvent('invoice.sent')
  onInvoiceSent(p: any) {
    return this.emit(p?.orgId, 'invoice.sent', p?.invoice ?? p);
  }

  @OnEvent('invoice.paid')
  onInvoicePaid(p: any) {
    return this.emit(p?.orgId, 'invoice.paid', p?.invoice ?? p);
  }

  @OnEvent('ticket.created')
  onTicketCreated(p: any) {
    return this.emit(p?.orgId, 'ticket.created', p?.ticket ?? p);
  }

  @OnEvent('ticket.resolved')
  onTicketResolved(p: any) {
    return this.emit(p?.orgId, 'ticket.resolved', p?.ticket ?? p);
  }

  // Exposed so tests / smoke-checks can confirm the allowed surface.
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  private static readonly _ALLOWED = ALLOWED_EVENTS;
}
