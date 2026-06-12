import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { ActivityCaptureService } from './activity-capture.service';

/**
 * Bridges `email.inbound.received` → `ActivityCaptureService`
 * (Wave H2).
 *
 * The event is fired by `ImapConnectorService` after each newly-
 * inserted InboxMessage row — see the one-line additive emit in
 * `apps/api/src/modules/inbox/imap-connector.service.ts`. Payload
 * carries enough to drive the matcher without us having to re-read
 * the row.
 *
 * Async + non-blocking: an IMAP poll cycle processes many messages
 * in a batch; we don't want capture latency to slow the next fetch.
 */
interface InboundEmailReceivedEvent {
  orgId: string;
  inboxMessageId: string;
  fromEmail: string;
  subject: string | null;
  bodyText: string | null;
  bodyHtml: string | null;
  receivedAt: Date | string;
}

@Injectable()
export class InboundEmailCaptureListener {
  private readonly logger = new Logger(InboundEmailCaptureListener.name);

  constructor(private capture: ActivityCaptureService) {}

  @OnEvent('email.inbound.received', { async: true })
  async onInboundEmailReceived(payload: InboundEmailReceivedEvent) {
    if (!payload?.orgId || !payload?.inboxMessageId) return;
    try {
      await this.capture.captureInboundEmail(payload.orgId, {
        id: payload.inboxMessageId,
        fromEmail: payload.fromEmail,
        subject: payload.subject ?? null,
        bodyText: payload.bodyText ?? null,
        bodyHtml: payload.bodyHtml ?? null,
        receivedAt: payload.receivedAt,
      });
    } catch (err) {
      this.logger.error(
        `Inbound-email capture failed for ${payload.inboxMessageId}: ${(err as Error).message}`,
      );
    }
  }
}
