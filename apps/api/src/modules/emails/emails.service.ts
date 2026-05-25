import { Injectable, Logger, Optional } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { OnEvent } from '@nestjs/event-emitter';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import * as nodemailer from 'nodemailer';
import { EmailSettingsService } from '../email-settings/email-settings.service';
import { EmailOAuthService } from '../email-settings/oauth/email-oauth.service';
import { PrismaService } from '../../database/prisma.service';
import {
  generateTrackingId,
  injectTracking,
} from './email-tracking.util';

/**
 * Identifier of the CRM record this mail is "about". When set, EmailsService
 * creates an OutboundMessage row BEFORE send, embeds a tracking pixel and
 * rewrites links so opens / clicks can be attributed back. Pass `tracking`
 * for invoice/estimate/proposal/statement/etc. mails. Omit it for system
 * mail (password reset, welcome, …) — see the `@OnEvent` listeners below
 * for the canonical carve-outs.
 */
export interface OutboundTracking {
  routedTo:
    | 'lead'
    | 'client'
    | 'invoice'
    | 'estimate'
    | 'ticket'
    | 'proposal'
    | 'statement'
    // Bulk email campaigns (migration 024). routedToId is the Campaign.id —
    // many OutboundMessage rows share one campaignId (one per recipient).
    | 'campaign';
  routedToId: string;
}

export interface SendMailOpts {
  to: string;
  subject: string;
  html: string;
  attachments?: any[];
  /**
   * If set, the mail service will look up EmailSettings for this org
   * and use its SMTP / from / replyTo. Falls back to env if the org
   * uses PLATFORM_DEFAULT or has no row.
   */
  orgId?: string;
  /**
   * When present (AND orgId is set), open + click tracking is injected.
   * No-op for system mail (no orgId) or when omitted.
   */
  tracking?: OutboundTracking;
}

/** Internal job payload — adds the pre-allocated trackingId so the */
/** queue worker can recover the row after BullMQ delivery.            */
interface EmailJobData extends SendMailOpts {
  trackingId?: string;
}

/**
 * Result of {@link EmailsService.queue}. When tracking was requested AND the
 * OutboundMessage row was pre-created, `outboundMessageId` is the id of that
 * row so callers can link records to it directly (no time-of-check race
 * re-querying for "the latest" row). Undefined when no tracking row was made
 * (no tracking, no orgId, prisma unavailable, or row creation failed).
 */
export interface QueueResult {
  outboundMessageId?: string;
}

@Injectable()
export class EmailsService {
  private readonly logger = new Logger(EmailsService.name);
  /** Cached fallback transporter built from env — used when no orgId is given
   * or when EmailSettingsService is unavailable (rare, bootstrap edge case). */
  private envTransporter: nodemailer.Transporter;

  constructor(
    private config: ConfigService,
    @InjectQueue('emails') private emailsQueue: Queue,
    @Optional() private emailSettings?: EmailSettingsService,
    @Optional() private emailOAuth?: EmailOAuthService,
    @Optional() private prisma?: PrismaService,
  ) {
    this.envTransporter = nodemailer.createTransport({
      host: this.config.get('SMTP_HOST', 'localhost'),
      port: parseInt(this.config.get('SMTP_PORT', '587') as string),
      secure: this.config.get('SMTP_PORT') === '465',
      auth: {
        user: this.config.get('SMTP_USER'),
        pass: this.config.get('SMTP_PASS'),
      },
    });
  }

  /**
   * Enqueue an email for background delivery via BullMQ.
   * Prefer this over `send()` for anything triggered by events/user actions
   * so transient SMTP failures get retried automatically.
   *
   * Tracking-aware: if `tracking` is provided, we pre-create the
   * OutboundMessage row HERE so the trackingId exists before delivery and
   * is stable across retries. The processor pulls the same trackingId
   * from job data and applies it to the HTML at send time.
   */
  async queue(opts: SendMailOpts): Promise<QueueResult> {
    const job: EmailJobData = { ...opts };
    let outboundMessageId: string | undefined;

    if (opts.tracking && opts.orgId && this.prisma) {
      const row = await this.preCreateTrackingRow(
        opts.orgId,
        opts.tracking,
        opts.to,
        opts.subject,
      );
      job.trackingId = row?.trackingId;
      outboundMessageId = row?.id;
    }

    await this.emailsQueue.add('send-email', job, {
      attempts: 3,
      backoff: { type: 'exponential', delay: 5000 },
      removeOnComplete: 1000,
      removeOnFail: 5000,
    });

    return { outboundMessageId };
  }

  async send(opts: SendMailOpts | EmailJobData) {
    try {
      // Decide tracking up front. Two paths:
      //   1. queue() pre-allocated a trackingId and stored it on the job.
      //   2. send() called directly with `tracking` — we allocate now.
      let trackingId = (opts as EmailJobData).trackingId;
      if (!trackingId && opts.tracking && opts.orgId && this.prisma) {
        const row = await this.preCreateTrackingRow(
          opts.orgId,
          opts.tracking,
          opts.to,
          opts.subject,
        );
        trackingId = row?.trackingId;
      }

      // Inject pixel + rewrite anchors. Cheap string ops; only happens
      // when tracking actually got allocated.
      let html = opts.html;
      if (trackingId) {
        const appUrl = process.env.APP_URL ?? this.config.get('APP_URL') ?? '';
        if (appUrl) {
          html = injectTracking(html, { trackingId, appUrl });
        } else {
          this.logger.warn(
            'APP_URL not set — skipping tracking injection (would produce relative URLs in mail).',
          );
        }
      }

      // Append the per-org white-label email footer (if configured). The
      // footer was already <script>-stripped on save (organizations.service),
      // but we strip again here as defence-in-depth before it lands in mail.
      // Best-effort: a footer lookup failure must never block sending.
      if (opts.orgId && this.prisma) {
        try {
          const footer = await this.resolveBrandEmailFooter(opts.orgId);
          if (footer) html = `${html}${footer}`;
        } catch (e) {
          this.logger.warn(
            `Could not load brand email footer for org ${opts.orgId}: ${(e as Error)?.message}`,
          );
        }
      }

      // Per-org path — only when the service is wired AND an orgId is provided.
      if (opts.orgId && this.emailSettings) {
        const cfg = await this.emailSettings.resolveConfig(opts.orgId);

        let transporter: nodemailer.Transporter;
        if (cfg.source === 'org-oauth' && cfg.oauth && this.emailOAuth) {
          // XOAUTH2 path — pre-refresh if the cached access token is within
          // 60 s of expiry (handled inside ensureAccessToken). Passing the
          // live accessToken lets nodemailer skip its own refresh call.
          const t = await this.emailOAuth.ensureAccessToken(opts.orgId);
          transporter = nodemailer.createTransport({
            host: cfg.host,
            port: cfg.port,
            secure: cfg.secure,
            auth: {
              type: 'OAuth2',
              user: t.email,
              clientId: t.clientId,
              clientSecret: t.clientSecret,
              refreshToken: t.refreshToken,
              accessToken: t.accessToken,
            },
          });
        } else {
          transporter = nodemailer.createTransport({
            host: cfg.host,
            port: cfg.port,
            secure: cfg.secure,
            auth: cfg.auth,
          });
        }

        const info = await transporter.sendMail({
          from: cfg.from,
          replyTo: cfg.replyTo,
          to: opts.to,
          subject: opts.subject,
          html,
          attachments: opts.attachments,
        });
        this.logger.log(
          `Email sent to ${opts.to} via ${cfg.source} (org ${opts.orgId}): ${info.messageId}`,
        );

        if (trackingId && info.messageId && this.prisma) {
          await this.attachMessageId(trackingId, info.messageId);
        }
        return info;
      }

      // Fallback: env-based platform transporter (unchanged behaviour).
      const from = this.config.get(
        'SMTP_FROM',
        'CRM <noreply@idealhost.cloud>',
      );
      const info = await this.envTransporter.sendMail({
        from,
        to: opts.to,
        subject: opts.subject,
        html,
        attachments: opts.attachments,
      });
      this.logger.log(`Email sent to ${opts.to}: ${info.messageId}`);

      if (trackingId && info.messageId && this.prisma) {
        await this.attachMessageId(trackingId, info.messageId);
      }
      return info;
    } catch (e) {
      this.logger.error(`Email send failed to ${opts.to}`, e as any);
      throw e;
    }
  }

  // ─── White-label email footer ─────────────────────────────────────────────

  /**
   * Load the org's `brandEmailFooter` and return a send-ready HTML fragment,
   * or `null` when unset / empty. Defence-in-depth: <script> blocks are
   * stripped again here even though they were stripped on save. The footer
   * is wrapped in a divider so it visually separates from the message body.
   */
  private async resolveBrandEmailFooter(orgId: string): Promise<string | null> {
    if (!this.prisma) return null;
    const org = await this.prisma.organization.findUnique({
      where: { id: orgId },
      select: { brandEmailFooter: true },
    });
    const raw = org?.brandEmailFooter?.trim();
    if (!raw) return null;
    const safe = raw
      .replace(/<script\b[^>]*>[\s\S]*?<\/script\s*>/gi, '')
      .replace(/<\/?script\b[^>]*>/gi, '');
    return `<div style="margin-top:24px;padding-top:16px;border-top:1px solid #e5e7eb;color:#6b7280;font-size:12px;">${safe}</div>`;
  }

  // ─── Tracking helpers ─────────────────────────────────────────────────────

  /**
   * Create the OutboundMessage row before delivery so we have a stable
   * trackingId to embed in the HTML. Tolerates the (rare) duplicate
   * trackingId collision — re-rolls once, then gives up.
   *
   * Returns both the row `id` (used by callers that need to link records to
   * this exact OutboundMessage — e.g. CampaignRecipient.outboundMessageId)
   * and the `trackingId` (embedded in the HTML at send time). Undefined when
   * the row could not be created.
   */
  private async preCreateTrackingRow(
    orgId: string,
    tracking: OutboundTracking,
    recipientEmail: string,
    subject: string,
  ): Promise<{ id: string; trackingId: string } | undefined> {
    if (!this.prisma) return undefined;
    for (let attempt = 0; attempt < 2; attempt++) {
      const trackingId = generateTrackingId(12);
      try {
        const created = await this.prisma.withOrganization(
          orgId,
          async (tx: any) =>
            tx.outboundMessage.create({
              data: {
                organizationId: orgId,
                trackingId,
                routedTo: tracking.routedTo,
                routedToId: tracking.routedToId,
                subject,
                recipientEmail,
                sentAt: new Date(),
              },
              select: { id: true },
            }),
        );
        return { id: created.id, trackingId };
      } catch (err: any) {
        if (err?.code === 'P2002' && attempt === 0) {
          // Unique violation on trackingId — retry with a new one.
          continue;
        }
        this.logger.warn(
          `Failed to pre-create OutboundMessage for ${tracking.routedTo}:${tracking.routedToId}: ${(err as Error).message}`,
        );
        return undefined;
      }
    }
    return undefined;
  }

  /**
   * Persist the RFC822 Message-ID returned by nodemailer onto the
   * pre-created tracking row. Best-effort — failure does not break send.
   *
   * Uses raw SQL because the `@@unique([organizationId, messageId])` index
   * requires us to set messageId atomically (Prisma can't easily express
   * "update where trackingId = X" without RLS context).
   */
  private async attachMessageId(trackingId: string, messageId: string) {
    if (!this.prisma) return;
    try {
      await this.prisma.$executeRaw`
        UPDATE "outbound_messages"
        SET "messageId" = ${messageId}
        WHERE "trackingId" = ${trackingId} AND "messageId" IS NULL
      `;
    } catch (err) {
      this.logger.warn(
        `Failed to attach messageId for trackingId=${trackingId}: ${(err as Error).message}`,
      );
    }
  }

  // ─── Event listeners ──────────────────────────────────────────────────────

  @OnEvent('invoice.sent')
  async handleInvoiceSent(payload: { invoice: any; orgId: string }) {
    const { invoice, orgId } = payload;
    const to =
      invoice.client?.contacts?.[0]?.email ??
      invoice.client?.primaryEmail ??
      invoice.client?.email;
    if (!to) return;
    if (await this.isStaffOfOrg(orgId, to)) return;
    await this.queue({
      orgId,
      to,
      subject: `Invoice ${invoice.number} from ${invoice.organization?.name ?? 'Us'}`,
      html: `<p>Hi ${invoice.client?.company ?? ''},</p>
<p>Please find your invoice <strong>${invoice.number}</strong> for ${invoice.currency} ${invoice.total}.</p>
<p><a href="${process.env.APP_URL}/portal/invoices/${invoice.id}">View Invoice</a></p>`,
      tracking: { routedTo: 'invoice', routedToId: invoice.id },
    });
  }

  @OnEvent('estimate.sent')
  async handleEstimateSent(payload: { estimate: any; orgId: string }) {
    const { estimate, orgId } = payload;
    const to =
      estimate.client?.contacts?.[0]?.email ??
      estimate.client?.primaryEmail ??
      estimate.client?.email;
    if (!to) return;
    if (await this.isStaffOfOrg(orgId, to)) return;
    await this.queue({
      orgId,
      to,
      subject: `Estimate ${estimate.number} from ${estimate.organization?.name ?? 'Us'}`,
      html: `<p>Hi ${estimate.client?.company ?? ''},</p>
<p>Please find your estimate <strong>${estimate.number}</strong> for ${(estimate as any).currency ?? 'USD'} ${estimate.total}.</p>
<p><a href="${process.env.APP_URL}/portal/estimates/${estimate.id}">View Estimate</a></p>`,
      tracking: { routedTo: 'estimate', routedToId: estimate.id },
    });
  }

  @OnEvent('proposal.sent')
  async handleProposalSent(payload: { proposal: any; orgId: string }) {
    const { proposal, orgId } = payload;
    // Proposal recipients are not always a Client — some tenants attach
    // proposals to leads. Try the common shapes.
    const to =
      proposal.client?.contacts?.[0]?.email ??
      proposal.client?.primaryEmail ??
      proposal.client?.email ??
      proposal.lead?.email ??
      proposal.email;
    if (!to) return;
    if (await this.isStaffOfOrg(orgId, to)) return;

    const link = proposal.hash
      ? `${process.env.APP_URL}/proposal/${proposal.hash}`
      : `${process.env.APP_URL}/portal/proposals/${proposal.id}`;
    await this.queue({
      orgId,
      to,
      subject: `Proposal ${proposal.number ?? ''} — ${proposal.subject ?? ''}`.trim(),
      html: `<p>Hi,</p>
<p>Please find your proposal <strong>${proposal.subject ?? proposal.number ?? ''}</strong>.</p>
<p><a href="${link}">View Proposal</a></p>`,
      tracking: { routedTo: 'proposal', routedToId: proposal.id },
    });
  }

  @OnEvent('contract.sent_for_signing')
  async handleContractSentForSigning(payload: {
    contract: any;
    orgId: string;
  }) {
    const { contract, orgId } = payload;
    const to =
      contract.client?.contacts?.[0]?.email ??
      contract.client?.primaryEmail ??
      contract.client?.email;
    if (!to) return;
    const signUrl = `${process.env.APP_URL}/contract/${contract.hash}`;
    // Contracts aren't in the tracking enum (no contract record id support
    // in OutboundMessage.routedTo today). Skip tracking — see report.
    await this.queue({
      orgId,
      to,
      subject: `Please sign: ${contract.subject}`,
      html: `<p>You have a new contract to review and sign.</p>
<p><a href="${signUrl}">Click here to view and sign</a></p>`,
    });
  }

  @OnEvent('ticket.created')
  async handleTicketCreated(payload: { ticket: any; orgId: string }) {
    const { ticket, orgId } = payload;
    if (!ticket.assignee?.email) return;
    // Internal staff notification — do NOT track (it's a same-tenant
    // user, see the carve-out in the spec).
    await this.queue({
      orgId,
      to: ticket.assignee.email,
      subject: `New ticket assigned: ${ticket.subject}`,
      html: `<p>A new ticket has been assigned to you: <strong>${ticket.subject}</strong></p>
<p><a href="${process.env.APP_URL}/tickets/${ticket.id}">Open ticket</a></p>`,
    });
  }

  @OnEvent('ticket.satisfaction_survey')
  async handleTicketSatisfactionSurvey(payload: {
    ticket: any;
    orgId: string;
    contactEmail: string;
    orgName: string;
  }) {
    const { ticket, orgId, contactEmail, orgName } = payload;
    const surveyUrl = `${process.env.APP_URL}/portal/survey/ticket/${ticket.id}`;
    if (await this.isStaffOfOrg(orgId, contactEmail)) {
      // Survey going to a staff member — don't track.
      await this.queue({
        orgId,
        to: contactEmail,
        subject: `How was your support experience? — ${orgName}`,
        html: `<p>Hi,</p>
<p>Your support ticket <strong>"${ticket.subject}"</strong> has been resolved.</p>
<p>We'd love to hear about your experience. Please take a moment to share your feedback:</p>
<p><a href="${surveyUrl}" style="display:inline-block;padding:10px 20px;background:#2563eb;color:#fff;border-radius:6px;text-decoration:none;">Rate your experience</a></p>
<p>Thank you,<br/>${orgName} Support Team</p>`,
      });
      return;
    }
    await this.queue({
      orgId,
      to: contactEmail,
      subject: `How was your support experience? — ${orgName}`,
      html: `<p>Hi,</p>
<p>Your support ticket <strong>"${ticket.subject}"</strong> has been resolved.</p>
<p>We'd love to hear about your experience. Please take a moment to share your feedback:</p>
<p><a href="${surveyUrl}" style="display:inline-block;padding:10px 20px;background:#2563eb;color:#fff;border-radius:6px;text-decoration:none;">Rate your experience</a></p>
<p>Thank you,<br/>${orgName} Support Team</p>`,
      tracking: { routedTo: 'ticket', routedToId: ticket.id },
    });
  }

  @OnEvent('auth.password_reset_requested')
  async handlePasswordReset(payload: {
    user: any;
    token: string;
    resetUrl: string;
  }) {
    // Password reset is a system email — no per-org SMTP so the user can still
    // receive reset links even if their org's SMTP is mis-configured. Same
    // reason we don't track: no orgId, no tenant scope, and rewriting the
    // reset URL would be actively harmful.
    await this.queue({
      to: payload.user.email,
      subject: 'Password Reset Request',
      html: `<p>Click the link below to reset your password:</p>
<p><a href="${payload.resetUrl}">Reset Password</a></p>
<p>This link expires in 1 hour.</p>`,
    });
  }

  @OnEvent('auth.email_change_requested')
  async handleEmailChangeRequested(payload: {
    user: any;
    token: string;
    confirmUrl: string;
  }) {
    // System email — same reasoning as password reset. No tracking.
    await this.queue({
      to: payload.user.email,
      subject: 'Confirm your new email address',
      html: `<p>Hi ${payload.user.firstName ?? ''},</p>
<p>Click the link below to confirm your new email address:</p>
<p><a href="${payload.confirmUrl}">Confirm Email</a></p>
<p>This link expires in 1 hour. If you didn't request this, you can ignore this email.</p>`,
    });
  }

  @OnEvent('organization.registered')
  async handleOrgRegistered(payload: { org: any }) {
    const admin = payload.org.users?.[0];
    if (!admin?.email) return;
    // Welcome mail uses platform SMTP — org obviously has no custom config yet.
    // No tracking (system email).
    await this.queue({
      to: admin.email,
      subject: `Welcome to CRM — ${payload.org.name}`,
      html: `<p>Hi ${admin.firstName ?? ''},</p>
<p>Your organization <strong>${payload.org.name}</strong> has been created. You're currently on a 14-day free trial.</p>
<p><a href="${process.env.APP_URL}/dashboard">Go to Dashboard</a></p>`,
    });
  }

  // ─── Internal helpers ─────────────────────────────────────────────────────

  /**
   * True when `email` is a `staff`-typed user belonging to `orgId`. Used
   * to skip tracking on emails that go to internal team members so admins
   * don't accidentally inflate "open" stats by previewing their own mail.
   *
   * This is best-effort — if the lookup fails or prisma isn't injected we
   * default to `false` (i.e. track normally).
   */
  private async isStaffOfOrg(orgId: string, email: string): Promise<boolean> {
    if (!this.prisma || !email) return false;
    try {
      const u = await this.prisma.user.findFirst({
        where: {
          organizationId: orgId,
          email: { equals: email, mode: 'insensitive' },
          type: 'staff',
          active: true,
        },
        select: { id: true },
      });
      return !!u;
    } catch {
      return false;
    }
  }
}
