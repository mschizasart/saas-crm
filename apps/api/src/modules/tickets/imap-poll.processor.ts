import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Job } from 'bullmq';
import { Logger } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { PrismaService } from '../../database/prisma.service';
import { TicketSpamFiltersService } from '../ticket-spam-filters/ticket-spam-filters.service';

interface ImapPollJob {
  orgId: string;
}

interface ImapConfig {
  host: string;
  port: number;
  user: string;
  pass: string;
  secure?: boolean;
}

/**
 * Polls an organization's IMAP inbox and converts unseen messages into tickets.
 * Subjects matching `[#<ticketId>]` are appended as replies to the existing ticket.
 *
 * Inbound messages that don't match an existing ticket are run through the
 * org's TicketSpamFilter rules before a ticket is created. Matched rules can
 * mark the ticket as `spam`, auto-close it, or reject it entirely.
 */
@Processor('imap-poll')
export class ImapPollProcessor extends WorkerHost {
  private readonly logger = new Logger(ImapPollProcessor.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly events: EventEmitter2,
    private readonly spamFilters: TicketSpamFiltersService,
  ) {
    super();
  }

  async process(job: Job<ImapPollJob>) {
    const { orgId } = job.data;
    this.logger.log(`IMAP poll starting for org ${orgId}`);

    let processed = 0;
    try {
      const org = await (this.prisma as any).organization.findUnique({
        where: { id: orgId },
      });
      if (!org) {
        this.logger.warn(`Org ${orgId} not found, skipping`);
        return { processed: 0 };
      }

      const settings = (org.settings ?? {}) as any;
      const imap: ImapConfig | undefined = settings.imap;
      if (!imap || !imap.host || !imap.user || !imap.pass) {
        this.logger.warn(`Org ${orgId} has no valid IMAP config, skipping`);
        return { processed: 0 };
      }

      // Dynamic imports so the API can still boot if packages are missing
      // during dev / before `pnpm install`.
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const { ImapFlow } = require('imapflow');
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const { simpleParser } = require('mailparser');

      const client = new ImapFlow({
        host: imap.host,
        port: imap.port ?? 993,
        secure: imap.secure ?? true,
        auth: { user: imap.user, pass: imap.pass },
        logger: false,
      });

      await client.connect();
      const lock = await client.getMailboxLock('INBOX');
      try {
        // UIDs of unseen messages
        const uids: number[] = await client.search({ seen: false }, { uid: true });
        if (!uids || uids.length === 0) {
          this.logger.log(`Org ${orgId}: no unseen messages`);
        } else {
          for (const uid of uids) {
            try {
              const { content } = await client.download(uid, undefined, {
                uid: true,
              });
              const parsed = await simpleParser(content);

              const fromEmail =
                parsed.from?.value?.[0]?.address ?? 'unknown@unknown';
              const subject = (parsed.subject ?? '(no subject)').trim();
              const body =
                parsed.text ?? (parsed.html ? String(parsed.html) : '');

              await this.handleMessage(orgId, fromEmail, subject, body);
              processed++;

              // Mark as seen
              await client.messageFlagsAdd(
                { uid },
                ['\\Seen'],
                { uid: true },
              );
            } catch (msgErr) {
              this.logger.error(
                `Org ${orgId}: failed to process uid ${uid}: ${(msgErr as Error).message}`,
              );
            }
          }
        }
      } finally {
        lock.release();
        await client.logout().catch(() => {});
      }
    } catch (err) {
      this.logger.error(
        `IMAP poll failed for org ${orgId}: ${(err as Error).message}`,
      );
      throw err;
    }

    this.logger.log(`IMAP poll done for org ${orgId}: ${processed} msg(s)`);
    return { processed };
  }

  private async handleMessage(
    orgId: string,
    fromEmail: string,
    subject: string,
    body: string,
  ) {
    // Try to match an existing ticket via `[#<id>]` tag in the subject.
    // Replies to existing tickets bypass spam filtering — the conversation
    // is already trusted.
    const tagMatch = subject.match(/\[#([a-zA-Z0-9-]+)\]/);
    const existingId = tagMatch?.[1];

    if (existingId) {
      await this.prisma.withOrganization(orgId, async (tx: any) => {
        const existing = await tx.ticket.findFirst({
          where: { id: existingId, organizationId: orgId },
        });
        if (existing) {
          await tx.ticketReply.create({
            data: {
              ticketId: existing.id,
              message: body || '(empty)',
              isStaff: false,
            },
          });
          await tx.ticket.update({
            where: { id: existing.id },
            data: { lastReplyAt: new Date(), status: 'open' },
          });
          this.events.emit('ticket.replied', {
            ticketId: existing.id,
            orgId,
            source: 'email',
            fromEmail,
          });
          return;
        }
        // Tag didn't resolve — fall through to spam-filter + new-ticket path
        // by re-invoking on a fresh transaction.
        await this.createInboundTicket(orgId, fromEmail, subject, body);
      });
      return;
    }

    await this.createInboundTicket(orgId, fromEmail, subject, body);
  }

  /**
   * Run the inbound message through this org's spam filters, then either
   * create the ticket (with status overridden by the matched rule) or skip
   * it entirely (`reject`).
   */
  private async createInboundTicket(
    orgId: string,
    fromEmail: string,
    subject: string,
    body: string,
  ) {
    const fromDomain = fromEmail.includes('@')
      ? fromEmail.split('@')[1] ?? ''
      : '';

    let evaluation:
      | Awaited<ReturnType<TicketSpamFiltersService['evaluate']>>
      | null = null;
    try {
      evaluation = await this.spamFilters.evaluate(orgId, {
        subject,
        fromEmail,
        body,
        fromDomain,
      });
    } catch (err) {
      // Filter evaluation must never block ticket creation — log and proceed.
      this.logger.warn(
        `Spam-filter evaluation failed for org ${orgId}: ${(err as Error).message}`,
      );
    }

    // ─── reject ─────────────────────────────────────────────────────────
    if (evaluation?.matched && evaluation.action === 'reject') {
      this.logger.log(
        `Spam-filter REJECT (org ${orgId}, rule ${evaluation.filterName}): dropping message from ${fromEmail} subject "${subject}"`,
      );
      // Telemetry already bumped inside evaluate(). No ticket created, no
      // ticket.created event, so no notification emails / webhooks fire.
      return;
    }

    // ─── mark_spam | auto_close | none ──────────────────────────────────
    let status: 'open' | 'spam' | 'closed' = 'open';
    let autoCloseNote: string | null = null;
    if (evaluation?.matched) {
      if (evaluation.action === 'mark_spam') {
        status = 'spam';
      } else if (evaluation.action === 'auto_close') {
        status = 'closed';
        autoCloseNote = `[auto-closed by spam filter: ${evaluation.filterName ?? 'unnamed'}]`;
      }
    }

    await this.prisma.withOrganization(orgId, async (tx: any) => {
      const contact = await tx.contact
        .findFirst({
          where: { organizationId: orgId, email: fromEmail },
        })
        .catch(() => null);

      const ticket = await tx.ticket.create({
        data: {
          organizationId: orgId,
          subject: subject || '(no subject)',
          message: body || '',
          clientId: contact?.clientId ?? null,
          contactId: contact?.id ?? null,
          priority: 'medium',
          source: 'email',
          status,
          ...(status === 'closed' && { closedAt: new Date() }),
          lastReplyAt: new Date(),
        },
      });

      if (autoCloseNote) {
        await tx.ticketReply
          .create({
            data: {
              ticketId: ticket.id,
              message: autoCloseNote,
              isInternal: true,
            },
          })
          .catch(() => {
            // Non-critical: a missing internal note shouldn't block the close.
          });
      }

      // Only emit the standard event for normal tickets — spam / auto-closed
      // tickets shouldn't trigger assignment notifications, autoresponders,
      // or webhooks downstream.
      if (status === 'open') {
        this.events.emit('ticket.created', {
          ticket,
          orgId,
          source: 'email',
          fromEmail,
        });
      } else {
        this.events.emit('ticket.spam_filtered', {
          ticket,
          orgId,
          source: 'email',
          fromEmail,
          filterId: evaluation?.filterId,
          filterName: evaluation?.filterName,
          action: evaluation?.action,
        });
      }
    });
  }
}
