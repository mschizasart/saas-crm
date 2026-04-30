import { Global, Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { InboxController } from './inbox.controller';
import { InboxService } from './inbox.service';
import { InboxRouterService } from './router.service';
import { ImapConnectorService } from './imap-connector.service';
import { InboxImapProcessor } from './inbox-imap.processor';
import { InboxScheduler } from './inbox-scheduler.service';
import { OutboundTrackerService } from './outbound-tracker.service';

/**
 * Generic, per-tenant IMAP inbox sync.
 *
 * ── Deconfliction with `tickets/imap-poll.processor.ts` ─────────────
 * The legacy ticket IMAP code reads from `Organization.settings.imap`,
 * uses a separate BullMQ queue (`imap-poll`), and was designed to drain
 * a dedicated mailbox into Tickets — flagging messages as `\Seen` to
 * avoid re-processing them.
 *
 * The generic inbox here uses the new `EmailSettings.imap*` columns
 * (NOT `Organization.settings.imap`), runs on a separate queue
 * (`inbox-imap`), and tracks progress via UID — it never sets `\Seen`.
 *
 * If a tenant points BOTH systems at the same INBOX:
 *   - The ticket processor only sees `unseen` messages, then marks
 *     them seen. The inbox connector ignores `\Seen` flags entirely
 *     (UID-based), so it will still capture them.
 *   - Result: tickets get one row in `tickets`, the same mail gets
 *     one row in `inbox_messages` with `routedTo='ticket'` (matched
 *     via `[#<id>]` subject tag, after the ticket processor runs)
 *     OR `routedTo='unmatched'` (if the inbox poller wins the race).
 *     A periodic re-route job could clean those up; out of scope for v1.
 *   - Recommended: a tenant migrating to the generic inbox should
 *     leave `Organization.settings.imap` empty and use only the new
 *     `EmailSettings.imap*` columns. The legacy processor stays for
 *     backwards compatibility and can be deprecated later.
 *
 * Both systems share the same `imapflow` connection library so we
 * don't double-bundle.
 */
@Global()
@Module({
  imports: [BullModule.registerQueue({ name: 'inbox-imap' })],
  controllers: [InboxController],
  providers: [
    InboxService,
    InboxRouterService,
    ImapConnectorService,
    InboxImapProcessor,
    InboxScheduler,
    OutboundTrackerService,
  ],
  // OutboundTrackerService is consumed by EmailsService (and any feature
  // module that wants to record outbound thread-binding) — exporting it
  // means callers don't have to re-import this module.
  exports: [OutboundTrackerService, ImapConnectorService],
})
export class InboxModule {}
