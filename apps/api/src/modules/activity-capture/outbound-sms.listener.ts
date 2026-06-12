import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { ActivityCaptureService } from './activity-capture.service';

/**
 * Bridges `sms.outbound.sent` → `ActivityCaptureService` (Wave H2).
 *
 * Fired by `SmsConfigService.sendForOrg()` AFTER the SmsMessage row
 * has been written (success OR failure — both should appear on the
 * timeline so a rep can see "your SMS to John failed"). See the
 * one-line additive emit in
 * `apps/api/src/modules/sms/sms-config.service.ts`.
 */
interface OutboundSmsSentEvent {
  orgId: string;
  smsMessageId: string;
  toNumber: string;
  body: string;
  createdAt: Date | string;
}

@Injectable()
export class OutboundSmsCaptureListener {
  private readonly logger = new Logger(OutboundSmsCaptureListener.name);

  constructor(private capture: ActivityCaptureService) {}

  @OnEvent('sms.outbound.sent', { async: true })
  async onOutboundSmsSent(payload: OutboundSmsSentEvent) {
    if (!payload?.orgId || !payload?.smsMessageId) return;
    try {
      await this.capture.captureOutboundSms(payload.orgId, {
        id: payload.smsMessageId,
        toNumber: payload.toNumber,
        body: payload.body,
        createdAt: payload.createdAt,
      });
    } catch (err) {
      this.logger.error(
        `Outbound-sms capture failed for ${payload.smsMessageId}: ${(err as Error).message}`,
      );
    }
  }
}
