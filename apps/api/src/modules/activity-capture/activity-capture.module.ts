import { Module } from '@nestjs/common';
import { ActivityCaptureService } from './activity-capture.service';
import { ActivityCaptureSettingsService } from './activity-capture-settings.service';
import { ActivityCaptureSettingsController } from './activity-capture-settings.controller';
import { ActivityCaptureBackfillController } from './backfill.controller';
import { ContactResolverService } from './contact-resolver.service';
import { OutboundEmailCaptureListener } from './outbound-email.listener';
import { InboundEmailCaptureListener } from './inbound-email.listener';
import { OutboundSmsCaptureListener } from './outbound-sms.listener';
import { InboundSmsCaptureListener } from './inbound-sms.listener';

/**
 * Einstein-style Activity Capture (Wave H2).
 *
 * - ActivityCaptureService: the core. Observes the four messaging
 *   pipeline events (outbound/inbound email + outbound/inbound SMS)
 *   and writes a unified `Activity` row pinned to the matched CRM
 *   record. Dedup via the UNIQUE (sourceType, sourceId) constraint
 *   on `activity_capture_log`.
 *
 * - ActivityCaptureSettingsService + Controller: per-org toggles
 *   (emailCaptureEnabled, smsCaptureEnabled, captureInternalEmails).
 *   Gated by `settings.view` / `settings.edit` — no new RBAC
 *   permissions needed.
 *
 * - ContactResolverService: maps an email / phone to a CRM record
 *   (Client via Contact, or Lead), strictly org-scoped to prevent
 *   cross-tenant capture.
 *
 * - Four listeners bridge the messaging events into the capture
 *   service. They're async / non-blocking so a slow capture write
 *   never delays the underlying SMTP / IMAP / Twilio path.
 *
 * - ActivityCaptureBackfillController exposes a one-shot
 *   admin-triggered sweep over the last N days for organisations
 *   turning capture on after the fact.
 *
 * PrismaService is supplied by the global DatabaseModule.
 * EventEmitter is wired globally in AppModule via
 * `EventEmitterModule.forRoot()`.
 */
@Module({
  controllers: [
    ActivityCaptureSettingsController,
    ActivityCaptureBackfillController,
  ],
  providers: [
    ActivityCaptureService,
    ActivityCaptureSettingsService,
    ContactResolverService,
    OutboundEmailCaptureListener,
    InboundEmailCaptureListener,
    OutboundSmsCaptureListener,
    InboundSmsCaptureListener,
  ],
  exports: [ActivityCaptureService, ActivityCaptureSettingsService],
})
export class ActivityCaptureModule {}
