import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { ActivityCaptureService } from './activity-capture.service';

/**
 * Bridges `sms.inbound.received` → `ActivityCaptureService` (Wave H2).
 *
 * Fired by `SmsConfigService.logInbound()` after the Twilio webhook
 * persists the SmsMessage row. See the one-line additive emit in
 * `apps/api/src/modules/sms/sms-config.service.ts`.
 */
interface InboundSmsReceivedEvent {
  orgId: string;
  smsMessageId: string;
  fromNumber: string;
  body: string;
  createdAt: Date | string;
}

@Injectable()
export class InboundSmsCaptureListener {
  private readonly logger = new Logger(InboundSmsCaptureListener.name);

  constructor(private capture: ActivityCaptureService) {}

  @OnEvent('sms.inbound.received', { async: true })
  async onInboundSmsReceived(payload: InboundSmsReceivedEvent) {
    if (!payload?.orgId || !payload?.smsMessageId) return;
    try {
      await this.capture.captureInboundSms(payload.orgId, {
        id: payload.smsMessageId,
        fromNumber: payload.fromNumber,
        body: payload.body,
        createdAt: payload.createdAt,
      });
    } catch (err) {
      this.logger.error(
        `Inbound-sms capture failed for ${payload.smsMessageId}: ${(err as Error).message}`,
      );
    }
  }
}
