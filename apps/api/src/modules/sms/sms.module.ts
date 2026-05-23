import { Global, Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { SmsService } from './sms.service';
import { SmsConfigService } from './sms-config.service';
import { SmsController } from './sms.controller';
import { SmsWebhookController } from './sms-webhook.controller';

/**
 * Per-tenant Twilio SMS.
 *
 * - SmsConfigService: the per-org config + send/log brain (encrypt-on-write,
 *   redact-on-read, resolveConfig, sendTest) — mirrors EmailSettingsService /
 *   AiConfigService.
 * - SmsService (legacy): the event-driven platform-notification sender wired
 *   to invoice.overdue / ticket.assigned. Kept as-is so those notifications
 *   keep working; it uses the optional platform-env TWILIO_* fallback.
 *
 * @Global so other feature modules can inject SmsConfigService without
 * importing this module explicitly — same trick EmailSettingsModule uses.
 */
@Global()
@Module({
  imports: [ConfigModule],
  controllers: [SmsController, SmsWebhookController],
  providers: [SmsService, SmsConfigService],
  exports: [SmsService, SmsConfigService],
})
export class SmsModule {}
