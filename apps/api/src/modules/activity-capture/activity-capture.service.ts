import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service';
import { ActivityCaptureSettingsService } from './activity-capture-settings.service';
import {
  ContactResolverService,
  ResolvedContact,
} from './contact-resolver.service';

/**
 * Shape of the OutboundMessage row the listener hands us. We accept a
 * loose record-shape so a future schema change (e.g. a new column)
 * doesn't break the contract — only the fields actually read here
 * matter to the capture decision.
 */
export interface OutboundEmailRecord {
  id: string;
  recipientEmail?: string | null;
  subject?: string | null;
  body?: string | null; // we don't currently store the body — see captureOutboundEmail
  sentAt?: Date | string | null;
  createdAt?: Date | string | null;
}

export interface InboundEmailRecord {
  id: string;
  fromEmail: string;
  subject?: string | null;
  bodyText?: string | null;
  bodyHtml?: string | null;
  receivedAt: Date | string;
}

export interface OutboundSmsRecord {
  id: string;
  toNumber: string;
  body: string;
  createdAt?: Date | string | null;
}

export interface InboundSmsRecord {
  id: string;
  fromNumber: string;
  body: string;
  createdAt?: Date | string | null;
}

/** Body cap so a giant newsletter / quoted-reply chain doesn't
 *  bloat the timeline row. 4 kB is the Salesforce default. */
const BODY_TRUNCATE = 4000;

/** Backfill safety cap — refuses to scan more than this many rows
 *  per source-type in a single invocation. Above this we'd be
 *  better off with a paged BullMQ job. */
const BACKFILL_CAP = 10_000;

/**
 * Einstein-style Activity Capture (Wave H2).
 *
 * Observes the four messaging-pipeline events (outbound email,
 * inbound email, outbound SMS, inbound SMS) and writes a unified
 * `Activity` row pinned to the matched Client / Lead / Contact.
 *
 * Hard invariants:
 *
 *   - Every capture writes a row to `activity_capture_log` even when
 *     it decides NOT to create an Activity (no match / disabled /
 *     internal). Ops can see the negative path; reruns dedup against
 *     the row.
 *
 *   - The Activity write and the log write happen in ONE
 *     `withOrganization` transaction. If we crashed between them,
 *     the next listener fire would create a SECOND Activity for the
 *     same source. The transaction makes that impossible.
 *
 *   - Dedup is enforced by the UNIQUE (source_type, source_id) index
 *     on `activity_capture_log`. The first writer wins on P2002; the
 *     second is a "already captured, skip" no-op.
 *
 *   - The contact-resolver is org-scoped. A naive lookup would let an
 *     inbound mail from `john@example.com` attach to a Contact in a
 *     DIFFERENT tenant if the email happened to repeat. The resolver
 *     pins `organizationId` on every query as defense-in-depth.
 */
@Injectable()
export class ActivityCaptureService {
  private readonly logger = new Logger(ActivityCaptureService.name);

  constructor(
    private prisma: PrismaService,
    private settings: ActivityCaptureSettingsService,
    private resolver: ContactResolverService,
  ) {}

  // ─── Outbound email ───────────────────────────────────────────

  /**
   * Hooked from `EmailsService` after a successful send. The
   * `OutboundMessage` row is created BEFORE the SMTP handoff (so we
   * have a stable trackingId to embed); by the time we're called the
   * row is already in the DB.
   */
  async captureOutboundEmail(
    orgId: string,
    message: OutboundEmailRecord,
  ): Promise<void> {
    if (!orgId || !message?.id) return;

    const cfg = await this.settings.get(orgId);
    if (!cfg.emailCaptureEnabled) {
      await this.writeNegativeLog(
        orgId,
        'outbound_email',
        message.id,
        'disabled_by_settings',
      );
      return;
    }

    const recipient = (message.recipientEmail ?? '').trim();
    if (!recipient) {
      await this.writeNegativeLog(
        orgId,
        'outbound_email',
        message.id,
        'no_matching_contact',
      );
      return;
    }

    // Internal-email carve-out — skip when both ends are staff.
    if (!cfg.captureInternalEmails) {
      const internal = await this.resolver.isInternalStaffEmail(
        orgId,
        recipient,
      );
      if (internal) {
        await this.writeNegativeLog(
          orgId,
          'outbound_email',
          message.id,
          'internal_email',
        );
        return;
      }
    }

    const match = await this.resolver.resolveByEmail(orgId, recipient);
    if (!match) {
      await this.writeNegativeLog(
        orgId,
        'outbound_email',
        message.id,
        'no_matching_contact',
      );
      return;
    }

    await this.writeActivityAndLog(orgId, 'outbound_email', message.id, match, {
      type: 'email',
      channel: 'email',
      direction: 'outbound',
      subject: message.subject ?? null,
      // OutboundMessage doesn't currently store the body (it's
      // rendered at send-time, then GC'd). We log a placeholder so
      // the timeline still has SOMETHING to show; v2 should
      // persist the body if product wants the full text.
      body: message.body ? this.truncate(message.body) : null,
      occurredAt: this.toDate(message.sentAt ?? message.createdAt),
    });
  }

  // ─── Inbound email ────────────────────────────────────────────

  /**
   * Hooked from the IMAP poller / inbound webhook after the
   * `InboxMessage` row lands.
   */
  async captureInboundEmail(
    orgId: string,
    message: InboundEmailRecord,
  ): Promise<void> {
    if (!orgId || !message?.id) return;

    const cfg = await this.settings.get(orgId);
    if (!cfg.emailCaptureEnabled) {
      await this.writeNegativeLog(
        orgId,
        'inbound_email',
        message.id,
        'disabled_by_settings',
      );
      return;
    }

    const from = (message.fromEmail ?? '').trim();
    if (!from) {
      await this.writeNegativeLog(
        orgId,
        'inbound_email',
        message.id,
        'no_matching_contact',
      );
      return;
    }

    // Internal-email carve-out — for inbound we check the SENDER.
    // A staff member emailing the shared support box would
    // otherwise hit "captured" for an internal back-and-forth.
    if (!cfg.captureInternalEmails) {
      const internal = await this.resolver.isInternalStaffEmail(orgId, from);
      if (internal) {
        await this.writeNegativeLog(
          orgId,
          'inbound_email',
          message.id,
          'internal_email',
        );
        return;
      }
    }

    const match = await this.resolver.resolveByEmail(orgId, from);
    if (!match) {
      await this.writeNegativeLog(
        orgId,
        'inbound_email',
        message.id,
        'no_matching_contact',
      );
      return;
    }

    await this.writeActivityAndLog(orgId, 'inbound_email', message.id, match, {
      type: 'email',
      channel: 'email',
      direction: 'inbound',
      subject: message.subject ?? null,
      // Prefer text — HTML in the timeline would need a sanitiser.
      body: this.truncate(message.bodyText ?? this.stripHtml(message.bodyHtml)),
      occurredAt: this.toDate(message.receivedAt),
    });
  }

  // ─── Outbound SMS ─────────────────────────────────────────────

  async captureOutboundSms(
    orgId: string,
    message: OutboundSmsRecord,
  ): Promise<void> {
    if (!orgId || !message?.id) return;

    const cfg = await this.settings.get(orgId);
    if (!cfg.smsCaptureEnabled) {
      await this.writeNegativeLog(
        orgId,
        'outbound_sms',
        message.id,
        'disabled_by_settings',
      );
      return;
    }

    const match = await this.resolver.resolveByPhone(orgId, message.toNumber);
    if (!match) {
      await this.writeNegativeLog(
        orgId,
        'outbound_sms',
        message.id,
        'no_matching_contact',
      );
      return;
    }

    await this.writeActivityAndLog(orgId, 'outbound_sms', message.id, match, {
      type: 'sms',
      channel: 'sms',
      direction: 'outbound',
      subject: null,
      body: this.truncate(message.body ?? ''),
      occurredAt: this.toDate(message.createdAt),
    });
  }

  // ─── Inbound SMS ──────────────────────────────────────────────

  async captureInboundSms(
    orgId: string,
    message: InboundSmsRecord,
  ): Promise<void> {
    if (!orgId || !message?.id) return;

    const cfg = await this.settings.get(orgId);
    if (!cfg.smsCaptureEnabled) {
      await this.writeNegativeLog(
        orgId,
        'inbound_sms',
        message.id,
        'disabled_by_settings',
      );
      return;
    }

    const match = await this.resolver.resolveByPhone(orgId, message.fromNumber);
    if (!match) {
      await this.writeNegativeLog(
        orgId,
        'inbound_sms',
        message.id,
        'no_matching_contact',
      );
      return;
    }

    await this.writeActivityAndLog(orgId, 'inbound_sms', message.id, match, {
      type: 'sms',
      channel: 'sms',
      direction: 'inbound',
      subject: null,
      body: this.truncate(message.body ?? ''),
      occurredAt: this.toDate(message.createdAt),
    });
  }

  // ─── Backfill ─────────────────────────────────────────────────

  /**
   * Admin-triggered sweep over the last N days of OutboundMessage /
   * InboxMessage / SmsMessage rows. Calls the per-source capture
   * method on each row, so all the same gates (settings, dedup,
   * internal carve-out) apply.
   *
   * Hard cap: BACKFILL_CAP rows per source-type. Above that we'd
   * rather a paged BullMQ job than blocking the request thread.
   * Returns a summary so the UI can show "captured 412 / 1209
   * scanned".
   */
  async backfill(orgId: string, sinceDays = 30) {
    const days = Math.max(1, Math.min(365, Math.floor(sinceDays)));
    const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

    const summary = {
      sinceDays: days,
      since: since.toISOString(),
      outboundEmail: { scanned: 0 },
      inboundEmail: { scanned: 0 },
      outboundSms: { scanned: 0 },
      inboundSms: { scanned: 0 },
    };

    // OutboundMessage
    const outbound = await this.prisma.withOrganization(orgId, (tx) =>
      tx.outboundMessage.findMany({
        where: { organizationId: orgId, sentAt: { gte: since } },
        select: {
          id: true,
          recipientEmail: true,
          subject: true,
          sentAt: true,
          createdAt: true,
        },
        take: BACKFILL_CAP,
        orderBy: { sentAt: 'desc' },
      }),
    );
    summary.outboundEmail.scanned = outbound.length;
    for (const m of outbound) {
      try {
        await this.captureOutboundEmail(orgId, m as OutboundEmailRecord);
      } catch (err) {
        this.logger.warn(
          `Backfill outbound-email row ${m.id} failed: ${(err as Error).message}`,
        );
      }
    }

    // InboxMessage
    const inbound = await this.prisma.withOrganization(orgId, (tx) =>
      tx.inboxMessage.findMany({
        where: { organizationId: orgId, receivedAt: { gte: since } },
        select: {
          id: true,
          fromEmail: true,
          subject: true,
          bodyText: true,
          bodyHtml: true,
          receivedAt: true,
        },
        take: BACKFILL_CAP,
        orderBy: { receivedAt: 'desc' },
      }),
    );
    summary.inboundEmail.scanned = inbound.length;
    for (const m of inbound) {
      try {
        await this.captureInboundEmail(orgId, m as InboundEmailRecord);
      } catch (err) {
        this.logger.warn(
          `Backfill inbound-email row ${m.id} failed: ${(err as Error).message}`,
        );
      }
    }

    // SmsMessage — TWO separate queries so BACKFILL_CAP is a true per-
    // direction cap. A single findMany() with a JS-side split would let
    // 10k outbound rows starve the inbound side (and vice-versa), and
    // the UI promises "per-channel" semantics. Mirrors the email path
    // (OutboundMessage + InboxMessage are already separate queries).
    const outboundSms = await this.prisma.withOrganization(orgId, (tx) =>
      tx.smsMessage.findMany({
        where: {
          organizationId: orgId,
          direction: 'outbound',
          createdAt: { gte: since },
        },
        select: {
          id: true,
          toNumber: true,
          body: true,
          createdAt: true,
        },
        take: BACKFILL_CAP,
        orderBy: { createdAt: 'desc' },
      }),
    );
    summary.outboundSms.scanned = outboundSms.length;
    for (const m of outboundSms) {
      try {
        await this.captureOutboundSms(orgId, {
          id: m.id,
          toNumber: m.toNumber,
          body: m.body,
          createdAt: m.createdAt,
        });
      } catch (err) {
        this.logger.warn(
          `Backfill outbound-sms row ${m.id} failed: ${(err as Error).message}`,
        );
      }
    }

    const inboundSms = await this.prisma.withOrganization(orgId, (tx) =>
      tx.smsMessage.findMany({
        where: {
          organizationId: orgId,
          direction: 'inbound',
          createdAt: { gte: since },
        },
        select: {
          id: true,
          fromNumber: true,
          body: true,
          createdAt: true,
        },
        take: BACKFILL_CAP,
        orderBy: { createdAt: 'desc' },
      }),
    );
    summary.inboundSms.scanned = inboundSms.length;
    for (const m of inboundSms) {
      try {
        await this.captureInboundSms(orgId, {
          id: m.id,
          fromNumber: m.fromNumber,
          body: m.body,
          createdAt: m.createdAt,
        });
      } catch (err) {
        this.logger.warn(
          `Backfill inbound-sms row ${m.id} failed: ${(err as Error).message}`,
        );
      }
    }

    return summary;
  }

  // ─── Internal: write paths ────────────────────────────────────

  /**
   * Atomic "create the Activity AND the log row" path. The whole
   * thing runs inside one `withOrganization` transaction so a crash
   * between the two writes can't leave the system half-captured.
   *
   * Dedup is handled by the UNIQUE constraint on
   * `(sourceType, sourceId)` — P2002 means "another listener fire
   * already captured this; nothing to do".
   */
  private async writeActivityAndLog(
    orgId: string,
    sourceType:
      | 'outbound_email'
      | 'inbound_email'
      | 'outbound_sms'
      | 'inbound_sms',
    sourceId: string,
    match: ResolvedContact,
    activity: {
      type: string;
      channel: string;
      direction: 'inbound' | 'outbound';
      subject: string | null;
      body: string | null;
      occurredAt: Date;
    },
  ): Promise<void> {
    try {
      await this.prisma.withOrganization(orgId, async (tx) => {
        const created = await tx.activity.create({
          data: {
            organizationId: orgId,
            type: activity.type,
            channel: activity.channel,
            direction: activity.direction,
            subject: activity.subject,
            body: activity.body,
            relatedToType: match.relatedToType,
            relatedToId: match.relatedToId,
            contactId: match.contactId ?? null,
            occurredAt: activity.occurredAt,
          },
          select: { id: true },
        });

        await tx.activityCaptureLog.create({
          data: {
            organizationId: orgId,
            sourceType,
            sourceId,
            activityId: created.id,
            matched: true,
            reason: 'captured',
          },
        });
      });
    } catch (err: any) {
      if (err?.code === 'P2002') {
        // Dedup hit — another listener fire (or backfill rerun) already
        // captured this. Nothing to do.
        this.logger.debug(
          `Skipped duplicate capture for ${sourceType}:${sourceId}`,
        );
        return;
      }
      this.logger.error(
        `Capture write failed for ${sourceType}:${sourceId}: ${(err as Error).message}`,
      );
    }
  }

  /**
   * Negative-outcome log row (no Activity created). Still respects
   * the UNIQUE dedup so a buggy listener firing twice doesn't write
   * two log rows.
   */
  private async writeNegativeLog(
    orgId: string,
    sourceType:
      | 'outbound_email'
      | 'inbound_email'
      | 'outbound_sms'
      | 'inbound_sms',
    sourceId: string,
    reason:
      | 'disabled_by_settings'
      | 'no_matching_contact'
      | 'internal_email'
      | 'duplicate',
  ): Promise<void> {
    try {
      await this.prisma.withOrganization(orgId, (tx) =>
        tx.activityCaptureLog.create({
          data: {
            organizationId: orgId,
            sourceType,
            sourceId,
            activityId: null,
            matched: false,
            reason,
          },
        }),
      );
    } catch (err: any) {
      if (err?.code === 'P2002') {
        // Already logged on a previous fire — fine.
        return;
      }
      this.logger.warn(
        `Capture log write failed for ${sourceType}:${sourceId}: ${(err as Error).message}`,
      );
    }
  }

  // ─── Internal: helpers ────────────────────────────────────────

  private truncate(text: string | null | undefined): string | null {
    if (!text) return null;
    if (text.length <= BODY_TRUNCATE) return text;
    return text.slice(0, BODY_TRUNCATE);
  }

  private stripHtml(html: string | null | undefined): string {
    if (!html) return '';
    // Best-effort — the timeline can render plain text safely;
    // anything richer is product-v2.
    return html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
  }

  private toDate(v: Date | string | null | undefined): Date {
    if (!v) return new Date();
    if (v instanceof Date) return v;
    const d = new Date(v);
    return isNaN(d.getTime()) ? new Date() : d;
  }
}
