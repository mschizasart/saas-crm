import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { OnEvent } from '@nestjs/event-emitter';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import * as nodemailer from 'nodemailer';

@Injectable()
export class EmailsService {
  private readonly logger = new Logger(EmailsService.name);
  private transporter: nodemailer.Transporter;

  constructor(
    private config: ConfigService,
    @InjectQueue('emails') private emailsQueue: Queue,
  ) {
    this.transporter = nodemailer.createTransport({
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
   */
  async queue(opts: {
    to: string;
    subject: string;
    html: string;
    attachments?: any[];
  }) {
    await this.emailsQueue.add('send-email', opts, {
      attempts: 3,
      backoff: { type: 'exponential', delay: 5000 },
      removeOnComplete: 1000,
      removeOnFail: 5000,
    });
  }

  async send(opts: {
    to: string;
    subject: string;
    html: string;
    attachments?: any[];
  }) {
    try {
      const from = this.config.get(
        'SMTP_FROM',
        'CRM <noreply@idealhost.cloud>',
      );
      const info = await this.transporter.sendMail({ from, ...opts });
      this.logger.log(`Email sent to ${opts.to}: ${info.messageId}`);
      return info;
    } catch (e) {
      this.logger.error(`Email send failed to ${opts.to}`, e as any);
      throw e;
    }
  }

  // ─── Event listeners ──────────────────────────────────────────────────────

  @OnEvent('invoice.sent')
  async handleInvoiceSent(payload: { invoice: any; orgId: string }) {
    const { invoice } = payload;
    const to =
      invoice.client?.contacts?.[0]?.email ??
      invoice.client?.primaryEmail ??
      invoice.client?.email;
    if (!to) return;
    await this.queue({
      to,
      subject: `Invoice ${invoice.number} from ${invoice.organization?.name ?? 'Us'}`,
      html: `<p>Hi ${invoice.client?.company ?? ''},</p>
<p>Please find your invoice <strong>${invoice.number}</strong> for ${invoice.currency} ${invoice.total}.</p>
<p><a href="${process.env.APP_URL}/portal/invoices/${invoice.id}">View Invoice</a></p>`,
    });
  }

  @OnEvent('estimate.sent')
  async handleEstimateSent(payload: { estimate: any; orgId: string }) {
    const { estimate } = payload;
    const to =
      estimate.client?.contacts?.[0]?.email ??
      estimate.client?.primaryEmail ??
      estimate.client?.email;
    if (!to) return;
    await this.queue({
      to,
      subject: `Estimate ${estimate.number} from ${estimate.organization?.name ?? 'Us'}`,
      html: `<p>Hi ${estimate.client?.company ?? ''},</p>
<p>Please find your estimate <strong>${estimate.number}</strong> for ${(estimate as any).currency ?? 'USD'} ${estimate.total}.</p>
<p><a href="${process.env.APP_URL}/portal/estimates/${estimate.id}">View Estimate</a></p>`,
    });
  }

  @OnEvent('contract.sent_for_signing')
  async handleContractSentForSigning(payload: {
    contract: any;
    orgId: string;
  }) {
    const { contract } = payload;
    const to =
      contract.client?.contacts?.[0]?.email ??
      contract.client?.primaryEmail ??
      contract.client?.email;
    if (!to) return;
    const signUrl = `${process.env.APP_URL}/contract/${contract.hash}`;
    await this.queue({
      to,
      subject: `Please sign: ${contract.subject}`,
      html: `<p>You have a new contract to review and sign.</p>
<p><a href="${signUrl}">Click here to view and sign</a></p>`,
    });
  }

  @OnEvent('ticket.created')
  async handleTicketCreated(payload: { ticket: any; orgId: string }) {
    const { ticket } = payload;
    if (!ticket.assignee?.email) return;
    await this.queue({
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
    const { ticket, contactEmail, orgName } = payload;
    const surveyUrl = `${process.env.APP_URL}/portal/survey/ticket/${ticket.id}`;
    await this.queue({
      to: contactEmail,
      subject: `How was your support experience? — ${orgName}`,
      html: `<p>Hi,</p>
<p>Your support ticket <strong>"${ticket.subject}"</strong> has been resolved.</p>
<p>We'd love to hear about your experience. Please take a moment to share your feedback:</p>
<p><a href="${surveyUrl}" style="display:inline-block;padding:10px 20px;background:#2563eb;color:#fff;border-radius:6px;text-decoration:none;">Rate your experience</a></p>
<p>Thank you,<br/>${orgName} Support Team</p>`,
    });
  }

  @OnEvent('auth.password_reset_requested')
  async handlePasswordReset(payload: {
    user: any;
    token: string;
    resetUrl: string;
  }) {
    await this.queue({
      to: payload.user.email,
      subject: 'Password Reset Request',
      html: `<p>Click the link below to reset your password:</p>
<p><a href="${payload.resetUrl}">Reset Password</a></p>
<p>This link expires in 1 hour.</p>`,
    });
  }

  @OnEvent('organization.registered')
  async handleOrgRegistered(payload: { org: any }) {
    const admin = payload.org.users?.[0];
    if (!admin?.email) return;
    await this.queue({
      to: admin.email,
      subject: `Welcome to CRM — ${payload.org.name}`,
      html: `<p>Hi ${admin.firstName ?? ''},</p>
<p>Your organization <strong>${payload.org.name}</strong> has been created. You're currently on a 14-day free trial.</p>
<p><a href="${process.env.APP_URL}/dashboard">Go to Dashboard</a></p>`,
    });
  }
}
