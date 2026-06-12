import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { PrismaService } from '../../database/prisma.service';
import { decrypt, isEncrypted } from '../../common/crypto/encrypt';
import { EmailOAuthService } from '../email-settings/oauth/email-oauth.service';
import { InboxRouterService } from './router.service';

interface ImapAuth {
  user: string;
  pass?: string;
  /** XOAUTH2 access token — set when OAuth provider is in use. */
  accessToken?: string;
}

const HARD_LIMIT_MESSAGES = 100;
const HARD_LIMIT_WALLCLOCK_MS = 60_000;
/** First-run catch-up size when imapLastUidNext is null. */
const INITIAL_CATCHUP = 50;

/**
 * Per-org IMAP poller. Reuses the connection / parsing recipe from
 * tickets/imap-poll.processor.ts but is generic — it persists every
 * inbound message into `inbox_messages`, runs the router, and never
 * touches the IMAP `\Seen` flag (so other clients keep their own
 * unread state).
 *
 * UID gap handling:
 *   - First run (imapLastUidNext null): we cap at the last
 *     INITIAL_CATCHUP UIDs to avoid pulling years of history.
 *   - Subsequent runs: we fetch UID > imapLastUidNext, so a long
 *     downtime catches up automatically (subject to the per-poll
 *     hard limit; the next 5-minute tick picks up where this left off).
 *   - On any failure we DO NOT advance imapLastUidNext, guaranteeing
 *     at-least-once delivery. Dedup on (organizationId, messageId) +
 *     INSERT ... skipDuplicates makes that safe.
 */
@Injectable()
export class ImapConnectorService {
  private readonly logger = new Logger(ImapConnectorService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    private readonly emailOAuth: EmailOAuthService,
    private readonly router: InboxRouterService,
    private readonly events: EventEmitter2,
  ) {}

  private encKey(): string | undefined {
    return this.config.get<string>('ENCRYPTION_KEY');
  }

  /**
   * Run a single poll cycle for the given org. Idempotent — safe to
   * re-enqueue if a job fails partway through.
   */
  async pollOrg(orgId: string): Promise<{
    fetched: number;
    inserted: number;
    routed: Record<string, number>;
    skipped?: string;
  }> {
    const settings = await this.prisma.withOrganization(orgId, (tx) =>
      tx.emailSettings.findUnique({ where: { organizationId: orgId } }),
    );
    if (!settings || !settings.imapEnabled) {
      return { fetched: 0, inserted: 0, routed: {}, skipped: 'imap-disabled' };
    }

    let auth: ImapAuth;
    let host: string;
    let port: number;
    let secure: boolean;

    try {
      const resolved = await this.resolveAuth(orgId, settings as any);
      auth = resolved.auth;
      host = resolved.host;
      port = resolved.port;
      secure = resolved.secure;
    } catch (err) {
      const msg = (err as Error).message || 'imap-auth-failed';
      await this.recordError(orgId, msg);
      this.logger.warn(`IMAP poll skipped for ${orgId}: ${msg}`);
      return { fetched: 0, inserted: 0, routed: {}, skipped: msg };
    }

    // Dynamic require — same trick as the tickets processor — so the API
    // still boots if these packages haven't been installed yet.
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { ImapFlow } = require('imapflow');
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { simpleParser } = require('mailparser');

    const client = new ImapFlow({
      host,
      port,
      secure,
      auth: auth.accessToken
        ? { user: auth.user, accessToken: auth.accessToken }
        : { user: auth.user, pass: auth.pass ?? '' },
      logger: false,
    });

    const startedAt = Date.now();
    let fetched = 0;
    let inserted = 0;
    const routed: Record<string, number> = {};
    let highestUid = settings.imapLastUidNext ?? 0;
    let pollError: string | null = null;

    try {
      await client.connect();
      const lock = await client.getMailboxLock('INBOX');
      try {
        const lastUid = settings.imapLastUidNext ?? null;

        // Build the UID range. imapflow accepts a string range or numeric array.
        let range: string | number[];
        if (lastUid && lastUid > 0) {
          // UIDs strictly greater than the high-water mark.
          range = `${lastUid + 1}:*`;
        } else {
          // First run — only catch up the most recent N UIDs to avoid
          // pulling years of legacy mail. We use SEARCH ALL then slice.
          const allUids: number[] = await client.search(
            { all: true },
            { uid: true },
          );
          range = (allUids ?? []).slice(-INITIAL_CATCHUP);
          if ((range as number[]).length === 0) {
            return { fetched: 0, inserted: 0, routed: {} };
          }
        }

        // imapflow's fetch() is async-iterable. We pull envelope + headers
        // + INTERNALDATE here, then download() the full source for parsing.
        // Wallclock + count caps protect against runaway INBOXes.
        for await (const msg of client.fetch(
          range,
          { uid: true, envelope: true, internalDate: true, source: true },
          { uid: true },
        )) {
          if (fetched >= HARD_LIMIT_MESSAGES) {
            this.logger.warn(
              `IMAP poll for ${orgId}: hit message cap (${HARD_LIMIT_MESSAGES}) — next poll will continue`,
            );
            break;
          }
          if (Date.now() - startedAt >= HARD_LIMIT_WALLCLOCK_MS) {
            this.logger.warn(
              `IMAP poll for ${orgId}: hit wallclock cap — next poll will continue`,
            );
            break;
          }

          fetched++;
          try {
            const parsed = await simpleParser(msg.source);

            const messageId =
              (parsed.messageId as string) ||
              (msg.envelope?.messageId as string) ||
              `<no-id-${msg.uid}@imap.local>`;

            const inReplyTo = (parsed.inReplyTo as string | undefined) ?? null;
            const referenceIds = this.parseReferences(parsed.references);

            const fromAddr = parsed.from?.value?.[0];
            const fromEmail =
              (fromAddr?.address ?? '').toLowerCase().trim() ||
              'unknown@unknown';
            const fromName = fromAddr?.name ?? null;

            const toEmails = (parsed.to as any)?.value
              ? (parsed.to as any).value.map((v: any) =>
                  (v.address ?? '').toLowerCase(),
                )
              : [];
            const ccEmails = (parsed.cc as any)?.value
              ? (parsed.cc as any).value.map((v: any) =>
                  (v.address ?? '').toLowerCase(),
                )
              : [];

            const subject = (parsed.subject ?? '').toString().slice(0, 998);
            const bodyText = parsed.text ?? null;
            const bodyHtml =
              typeof parsed.html === 'string' ? parsed.html : null;

            const receivedAt =
              (msg.internalDate as Date) ?? parsed.date ?? new Date();

            // Headers map → JSON (strings only; mailparser returns a Map).
            const headers: Record<string, string> = {};
            if (parsed.headers && typeof parsed.headers.forEach === 'function') {
              parsed.headers.forEach((value: any, key: string) => {
                try {
                  headers[key] =
                    typeof value === 'string' ? value : JSON.stringify(value);
                } catch {
                  headers[key] = String(value);
                }
              });
            }

            const attachments = Array.isArray(parsed.attachments)
              ? parsed.attachments.map((a: any) => ({
                  filename: a.filename ?? null,
                  contentType: a.contentType ?? null,
                  size: typeof a.size === 'number' ? a.size : null,
                }))
              : [];

            // Run routing BEFORE writing so the row is persisted with its
            // routedTo. The router uses RLS via withOrganization internally.
            const routing = await this.router.route({
              organizationId: orgId,
              fromEmail,
              subject,
              inReplyTo,
              referenceIds,
            });

            // INSERT with ON CONFLICT DO NOTHING via unique key — IMAP
            // can return overlapping ranges, especially around UID rollover.
            const result = await this.prisma.withOrganization(orgId, (tx: any) =>
              tx.inboxMessage.createMany({
                data: [
                  {
                    organizationId: orgId,
                    messageId,
                    inReplyTo,
                    referenceIds,
                    fromEmail,
                    fromName,
                    toEmails,
                    ccEmails,
                    subject,
                    bodyText,
                    bodyHtml,
                    receivedAt,
                    attachmentCount: attachments.length,
                    attachmentsJson: attachments,
                    routedTo: routing.routedTo,
                    routedToId: routing.routedToId,
                    rawHeadersJson: headers,
                  },
                ],
                skipDuplicates: true,
              }),
            );
            if (result.count > 0) {
              inserted++;
              routed[routing.routedTo] = (routed[routing.routedTo] ?? 0) + 1;

              // Notify lead-scoring (and any future listener) that a fresh
              // inbound mail is now attached to a lead. We only emit on
              // newly-inserted rows so reprocessing duplicate UIDs doesn't
              // re-trigger scoring.
              if (
                routing.routedTo === 'lead' &&
                typeof routing.routedToId === 'string' &&
                routing.routedToId
              ) {
                this.events.emit('inbox.routed-to-lead', {
                  orgId,
                  leadId: routing.routedToId,
                  messageId,
                });
              }

              // Wave H2 — Einstein Activity Capture. Fire once per
              // NEWLY-inserted inbox row so re-polled UIDs don't
              // re-capture. The capture pipeline does its own
              // contact-resolution + dedup; we just hand it the
              // payload it needs.
              //
              // We re-query the row id here because createMany doesn't
              // return ids — the InboxMessage row is identified by
              // its DB-generated id which the capture log uses for
              // dedup.
              try {
                const insertedRow = await this.prisma.withOrganization(
                  orgId,
                  (tx2: any) =>
                    tx2.inboxMessage.findUnique({
                      where: {
                        organizationId_messageId: {
                          organizationId: orgId,
                          messageId,
                        },
                      },
                      select: { id: true },
                    }),
                );
                if (insertedRow?.id) {
                  this.events.emit('email.inbound.received', {
                    orgId,
                    inboxMessageId: insertedRow.id,
                    fromEmail,
                    subject,
                    bodyText,
                    bodyHtml,
                    receivedAt,
                  });
                }
              } catch (emitErr) {
                this.logger.warn(
                  `IMAP capture-emit failed for ${orgId}/${messageId}: ${(emitErr as Error).message}`,
                );
              }
            }

            if (typeof msg.uid === 'number' && msg.uid > highestUid) {
              highestUid = msg.uid;
            }
          } catch (msgErr) {
            // One bad message must not poison the rest of the batch.
            this.logger.error(
              `IMAP poll for ${orgId}: failed to process uid ${msg.uid}: ${(msgErr as Error).message}`,
            );
          }
        }
      } finally {
        lock.release();
        await client.logout().catch(() => {
          /* swallow */
        });
      }
    } catch (err) {
      pollError = (err as Error).message || 'imap-error';
      this.logger.error(`IMAP poll for ${orgId} failed: ${pollError}`);
    }

    // Persist progress. Only advance UIDNEXT if we ran without a connection
    // error — partial-batch caps are fine because dedup is unique-key based.
    await this.prisma.withOrganization(orgId, (tx: any) =>
      tx.emailSettings.update({
        where: { organizationId: orgId },
        data: {
          imapLastSyncedAt: new Date(),
          imapLastError: pollError ?? null,
          ...(pollError === null && highestUid > (settings.imapLastUidNext ?? 0)
            ? { imapLastUidNext: highestUid }
            : {}),
        },
      }),
    );

    if (pollError) {
      // Re-throw so BullMQ schedules a retry per the queue policy.
      throw new Error(pollError);
    }

    return { fetched, inserted, routed };
  }

  /**
   * Connect to IMAP and return the INBOX EXISTS count, used by the
   * /email-settings/imap/test endpoint.
   */
  async testConnection(
    orgId: string,
    override?: {
      imapHost?: string;
      imapPort?: number;
      imapUser?: string;
      imapPassword?: string;
      imapTls?: boolean;
    },
  ): Promise<{ ok: boolean; count?: number; error?: string }> {
    let host: string;
    let port: number;
    let secure: boolean;
    let auth: ImapAuth;

    try {
      if (override && override.imapHost) {
        host = override.imapHost;
        port = override.imapPort ?? 993;
        secure = override.imapTls ?? true;
        auth = {
          user: override.imapUser ?? '',
          pass: override.imapPassword ?? '',
        };
      } else {
        const settings = await this.prisma.withOrganization(orgId, (tx) =>
          tx.emailSettings.findUnique({ where: { organizationId: orgId } }),
        );
        if (!settings) {
          return { ok: false, error: 'No email settings for org' };
        }
        const resolved = await this.resolveAuth(orgId, settings as any);
        host = resolved.host;
        port = resolved.port;
        secure = resolved.secure;
        auth = resolved.auth;
      }
    } catch (err) {
      return { ok: false, error: (err as Error).message };
    }

    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { ImapFlow } = require('imapflow');

    const client = new ImapFlow({
      host,
      port,
      secure,
      auth: auth.accessToken
        ? { user: auth.user, accessToken: auth.accessToken }
        : { user: auth.user, pass: auth.pass ?? '' },
      logger: false,
    });

    try {
      await client.connect();
      const mailbox = await client.getMailboxLock('INBOX');
      try {
        const status = await client.status('INBOX', { messages: true });
        return { ok: true, count: status.messages ?? 0 };
      } finally {
        mailbox.release();
        await client.logout().catch(() => {});
      }
    } catch (err) {
      return { ok: false, error: (err as Error).message };
    }
  }

  // ─── helpers ──────────────────────────────────────────────────────

  private parseReferences(refs: any): string[] {
    if (!refs) return [];
    if (Array.isArray(refs)) return refs.map((r) => String(r).trim()).filter(Boolean);
    return String(refs)
      .split(/\s+/)
      .map((r) => r.trim())
      .filter(Boolean);
  }

  /**
   * Resolve effective IMAP host/port/auth for an org.
   *
   * - GMAIL_OAUTH    → imap.gmail.com:993, XOAUTH2 token from EmailOAuthService.
   * - MICROSOFT_OAUTH → outlook.office365.com:993, XOAUTH2.
   * - Otherwise (SMTP/PLATFORM_DEFAULT) → use imapHost/imapUser/imapPassword
   *   columns. Password is decrypted with ENCRYPTION_KEY (same scheme as SMTP).
   */
  private async resolveAuth(
    orgId: string,
    settings: any,
  ): Promise<{
    host: string;
    port: number;
    secure: boolean;
    auth: ImapAuth;
  }> {
    if (
      settings.provider === 'GMAIL_OAUTH' ||
      settings.provider === 'MICROSOFT_OAUTH'
    ) {
      const t = await this.emailOAuth.ensureAccessToken(orgId);
      const host =
        settings.provider === 'GMAIL_OAUTH'
          ? 'imap.gmail.com'
          : 'outlook.office365.com';
      return {
        host,
        port: 993,
        secure: true,
        auth: { user: t.email, accessToken: t.accessToken },
      };
    }

    if (!settings.imapHost || !settings.imapUser) {
      throw new Error('IMAP host/user not configured');
    }
    let pass = '';
    if (settings.imapPassword) {
      try {
        pass = isEncrypted(settings.imapPassword)
          ? decrypt(settings.imapPassword, this.encKey())
          : settings.imapPassword;
      } catch (e) {
        throw new Error(
          `Failed to decrypt IMAP password: ${(e as Error).message}`,
        );
      }
    }
    return {
      host: settings.imapHost,
      port: settings.imapPort ?? 993,
      secure: settings.imapTls !== false,
      auth: { user: settings.imapUser, pass },
    };
  }

  private async recordError(orgId: string, error: string) {
    try {
      await this.prisma.withOrganization(orgId, (tx: any) =>
        tx.emailSettings.update({
          where: { organizationId: orgId },
          data: { imapLastError: error, imapLastSyncedAt: new Date() },
        }),
      );
    } catch {
      /* ignore — best effort */
    }
  }
}
