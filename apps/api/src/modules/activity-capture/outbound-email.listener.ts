import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { ActivityCaptureService } from './activity-capture.service';

/**
 * Bridges `email.outbound.sent` → `ActivityCaptureService` (Wave H2).
 *
 * The event is fired by `EmailsService.send()` AFTER a successful
 * SMTP handoff — see the one-line additive emit in
 * `apps/api/src/modules/emails/emails.service.ts`. Payload shape is
 * the OutboundMessage row plus the orgId.
 *
 * Async + non-blocking on purpose: a slow capture write must NOT
 * delay the SMTP path. A capture failure is logged here and swallowed
 * — the user's email still got sent, the timeline just won't show
 * this one.
 */
interface OutboundEmailSentEvent {
  orgId: string;
  outboundMessageId: string;
  recipientEmail: string | null;
  subject: string | null;
  sentAt: Date | string | null;
}

@Injectable()
export class OutboundEmailCaptureListener {
  private readonly logger = new Logger(OutboundEmailCaptureListener.name);

  constructor(private capture: ActivityCaptureService) {}

  @OnEvent('email.outbound.sent', { async: true })
  async onOutboundEmailSent(payload: OutboundEmailSentEvent) {
    if (!payload?.orgId || !payload?.outboundMessageId) return;
    try {
      await this.capture.captureOutboundEmail(payload.orgId, {
        id: payload.outboundMessageId,
        recipientEmail: payload.recipientEmail ?? null,
        subject: payload.subject ?? null,
        sentAt: payload.sentAt ?? null,
      });
    } catch (err) {
      // Swallow — must not crash the event bus.
      this.logger.error(
        `Outbound-email capture failed for ${payload.outboundMessageId}: ${(err as Error).message}`,
      );
    }
  }
}
