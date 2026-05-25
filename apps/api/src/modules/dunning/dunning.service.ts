import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service';
import { EmailsService } from '../emails/emails.service';

/**
 * Automated dunning engine — sends overdue/payment-reminder emails for
 * invoices according to per-org `DunningRule` steps.
 *
 * ─── Double-send prevention (READ THIS — flagged for the reviewer) ──────────
 * The hard guarantee that a given (invoice, rule) reminder fires AT MOST ONCE
 * — even when two scheduler passes run concurrently (e.g. a cron tick and a
 * manual "Run now" overlapping) — is the `@@unique([invoiceId, ruleId])`
 * constraint on `dunning_logs`.
 *
 * Ordering chosen: INSERT-LOG-FIRST, then ENQUEUE-EMAIL.
 *   1. We INSERT the `DunningLog` row in its OWN small transaction.
 *      - If it succeeds, this pass has exclusively "claimed" that
 *        (invoiceId, ruleId) send. We proceed to enqueue the email.
 *      - If it throws P2002 (unique violation), another pass already
 *        claimed it → we SKIP the email entirely. No double send.
 *   2. Only AFTER the insert commits do we call `emailsService.queue(...)`,
 *      which hands the email to the BullMQ `emails` queue (NOT sent in this
 *      code path).
 *
 * Why insert-first (not send-first):
 *   - `emailsService.queue()` already has its own retry semantics; the email
 *     queue is the durable, retryable layer. Claiming the log first means a
 *     crash between insert and enqueue costs us, at worst, ONE missed reminder
 *     (the rule will simply not re-fire because the log exists) — which is the
 *     safe failure direction for dunning (under-send, never over-send/spam).
 *   - Send-first would risk a double-send if the process crashed after the
 *     SMTP handoff but before writing the log. We explicitly prefer
 *     "at most once" over "at least once" here.
 *
 * Each (invoice, rule) insert is its OWN transaction so a single P2002 only
 * rolls back that one claim — it never aborts the whole org sweep.
 */

export interface DunningRunResult {
  enabled: boolean;
  invoicesScanned: number;
  remindersSent: number;
  skippedAlreadySent: number;
  skippedNoRecipient: number;
  errors: number;
}

/** Hard cap on invoices processed per run to bound a single pass. */
const MAX_INVOICES_PER_RUN = 500;

/**
 * Authoritative bound for `offsetDays`, mirroring the controller's
 * validation. An unbounded offset (e.g. -99999) would make the
 * `today >= dueDate + offset` gate true for EVERY open invoice → a runaway
 * send to the whole book. The controller rejects out-of-range values with a
 * 400; this clamp is a defensive backstop so a bad value reaching the service
 * by any other path can never trigger the runaway.
 */
const OFFSET_DAYS_MIN = -365;
const OFFSET_DAYS_MAX = 365;

function clampOffsetDays(value: number): number {
  return Math.min(OFFSET_DAYS_MAX, Math.max(OFFSET_DAYS_MIN, Math.trunc(value)));
}

@Injectable()
export class DunningService {
  private readonly logger = new Logger(DunningService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly emails: EmailsService,
  ) {}

  // ─── Settings ───────────────────────────────────────────────────────────

  /** Read (or lazily create) the org's dunning settings row. */
  async getSettings(orgId: string) {
    return this.prisma.withOrganization(orgId, async (tx: any) => {
      const existing = await tx.dunningSettings.findUnique({
        where: { organizationId: orgId },
      });
      if (existing) return existing;
      return tx.dunningSettings.create({
        data: { organizationId: orgId, enabled: false },
      });
    });
  }

  async updateSettings(orgId: string, enabled: boolean) {
    return this.prisma.withOrganization(orgId, async (tx: any) =>
      tx.dunningSettings.upsert({
        where: { organizationId: orgId },
        update: { enabled },
        create: { organizationId: orgId, enabled },
      }),
    );
  }

  // ─── Rules CRUD ─────────────────────────────────────────────────────────

  async listRules(orgId: string) {
    return this.prisma.withOrganization(orgId, async (tx: any) =>
      tx.dunningRule.findMany({
        where: { organizationId: orgId },
        orderBy: { offsetDays: 'asc' },
      }),
    );
  }

  async createRule(
    orgId: string,
    dto: {
      name: string;
      offsetDays: number;
      subject: string;
      body: string;
      isActive?: boolean;
    },
  ) {
    return this.prisma.withOrganization(orgId, async (tx: any) =>
      tx.dunningRule.create({
        data: {
          organizationId: orgId,
          name: dto.name,
          offsetDays: clampOffsetDays(dto.offsetDays),
          subject: dto.subject,
          body: dto.body,
          isActive: dto.isActive ?? true,
        },
      }),
    );
  }

  async updateRule(
    orgId: string,
    id: string,
    dto: Partial<{
      name: string;
      offsetDays: number;
      subject: string;
      body: string;
      isActive: boolean;
    }>,
  ) {
    return this.prisma.withOrganization(orgId, async (tx: any) => {
      // Scope the update to the org so a foreign id can't be edited.
      const existing = await tx.dunningRule.findFirst({
        where: { id, organizationId: orgId },
        select: { id: true },
      });
      if (!existing) return null;
      const data: any = {};
      if (dto.name !== undefined) data.name = dto.name;
      if (dto.offsetDays !== undefined)
        data.offsetDays = clampOffsetDays(dto.offsetDays);
      if (dto.subject !== undefined) data.subject = dto.subject;
      if (dto.body !== undefined) data.body = dto.body;
      if (dto.isActive !== undefined) data.isActive = dto.isActive;
      return tx.dunningRule.update({ where: { id }, data });
    });
  }

  async deleteRule(orgId: string, id: string) {
    return this.prisma.withOrganization(orgId, async (tx: any) => {
      const existing = await tx.dunningRule.findFirst({
        where: { id, organizationId: orgId },
        select: { id: true },
      });
      if (!existing) return { deleted: false };
      await tx.dunningRule.delete({ where: { id } });
      return { deleted: true };
    });
  }

  // ─── Logs (sent-reminder history for an invoice) ──────────────────────────

  async getLogsForInvoice(orgId: string, invoiceId: string) {
    return this.prisma.withOrganization(orgId, async (tx: any) =>
      tx.dunningLog.findMany({
        where: { organizationId: orgId, invoiceId },
        orderBy: { sentAt: 'desc' },
      }),
    );
  }

  // ─── Engine ───────────────────────────────────────────────────────────────

  /**
   * Run the dunning pass for a single org. Idempotent and safe to call
   * concurrently with itself (see the class-level double-send note).
   */
  async runForOrg(orgId: string): Promise<DunningRunResult> {
    const result: DunningRunResult = {
      enabled: false,
      invoicesScanned: 0,
      remindersSent: 0,
      skippedAlreadySent: 0,
      skippedNoRecipient: 0,
      errors: 0,
    };

    const settings = await this.getSettings(orgId);
    if (!settings?.enabled) {
      this.logger.debug(`Dunning disabled for org ${orgId} — skipping`);
      return result;
    }
    result.enabled = true;

    // Active rules only. No rules → nothing to do.
    const rules = await this.prisma.withOrganization(orgId, async (tx: any) =>
      tx.dunningRule.findMany({
        where: { organizationId: orgId, isActive: true },
        orderBy: { offsetDays: 'asc' },
      }),
    );
    if (rules.length === 0) {
      this.logger.debug(`No active dunning rules for org ${orgId}`);
      return result;
    }

    // Candidate invoices: currently UNPAID (unpaid | partial | overdue),
    // NOT paid/cancelled/draft, with a dueDate. "Currently unpaid" is the
    // gate that stops the sequence the moment an invoice is paid/cancelled:
    // a rule whose target date passed while the invoice was still open is
    // simply never sent once the invoice leaves the open set.
    const OPEN_STATUSES = ['unpaid', 'partial', 'overdue'];
    const invoices = await this.prisma.withOrganization(
      orgId,
      async (tx: any) =>
        tx.invoice.findMany({
          where: {
            organizationId: orgId,
            status: { in: OPEN_STATUSES },
            dueDate: { not: null },
          },
          select: {
            id: true,
            number: true,
            dueDate: true,
            total: true,
            status: true,
            currency: {
              select: { code: true, symbol: true, decimalPlaces: true },
            },
            client: {
              select: {
                company: true,
                contacts: {
                  where: { type: 'contact', active: true },
                  orderBy: { isPrimary: 'desc' },
                  select: { email: true, firstName: true, lastName: true },
                },
              },
            },
          },
          take: MAX_INVOICES_PER_RUN,
          orderBy: { dueDate: 'asc' },
        }),
    );

    result.invoicesScanned = invoices.length;
    const today = startOfToday();

    for (const inv of invoices) {
      if (!inv.dueDate) continue;
      const due = new Date(inv.dueDate);

      // Resolve the recipient the same way EmailsService does for invoices.
      const recipient =
        inv.client?.contacts?.[0]?.email ??
        (inv.client as any)?.primaryEmail ??
        (inv.client as any)?.email ??
        null;

      if (!recipient) {
        // Can't send without an address; don't burn any (invoice, rule)
        // slot — leave them unclaimed so they can fire once a contact email
        // is added. Count this invoice ONCE (not once per rule).
        result.skippedNoRecipient++;
        continue;
      }

      for (const rule of rules) {
        // Target date = dueDate + offsetDays. Fire when today >= target.
        const target = addDays(startOfDay(due), rule.offsetDays);
        if (today < target) continue;

        // ── DOUBLE-SEND GUARD ──────────────────────────────────────────
        // Claim the (invoiceId, ruleId) by inserting the log row FIRST,
        // in its own transaction. P2002 → already claimed → skip.
        try {
          await this.prisma.withOrganization(orgId, async (tx: any) => {
            await tx.dunningLog.create({
              data: {
                organizationId: orgId,
                invoiceId: inv.id,
                ruleId: rule.id,
                recipientEmail: recipient,
              },
              select: { id: true },
            });
          });
        } catch (err: any) {
          if (err?.code === 'P2002') {
            // Another pass already sent this (invoice, rule). Skip silently.
            result.skippedAlreadySent++;
            continue;
          }
          this.logger.error(
            `Dunning claim failed for invoice=${inv.id} rule=${rule.id}: ${(err as Error).message}`,
          );
          result.errors++;
          continue;
        }

        // Log row committed → we own this send. Enqueue the email.
        try {
          const { subject, html } = this.interpolate(rule, inv, recipient);
          await this.emails.queue({
            orgId,
            to: recipient,
            subject,
            html,
            tracking: { routedTo: 'invoice', routedToId: inv.id },
          });
          result.remindersSent++;
        } catch (err) {
          // The email failed to ENQUEUE (e.g. Redis down). We intentionally
          // do NOT delete the claimed log row. `emailsService.queue()` hands
          // the job to BullMQ/Redis asynchronously: if Redis accepted the job
          // but the call still threw on the return path, deleting the log
          // would let the NEXT pass re-claim + re-enqueue → a confirmed
          // double-send. Keeping the log preserves the at-most-once guarantee
          // (see the class-level note). The cost is, at worst, ONE missed
          // reminder — the safe failure direction for dunning (under-send,
          // never spam). A failure INSIDE the queue/worker is the email
          // queue's own retry concern, not ours.
          this.logger.error(
            `Dunning enqueue failed for invoice=${inv.id} rule=${rule.id}: ${(err as Error).message} — keeping log (at-most-once)`,
          );
          result.errors++;
        }
      }
    }

    this.logger.log(
      `Dunning run org=${orgId} scanned=${result.invoicesScanned} sent=${result.remindersSent} alreadySent=${result.skippedAlreadySent} noRecipient=${result.skippedNoRecipient} errors=${result.errors}`,
    );
    return result;
  }

  // ─── Placeholder interpolation ─────────────────────────────────────────────

  /**
   * Replace {{invoice_number}} {{amount}} {{due_date}} {{client_name}} in
   * both subject and body. Unknown placeholders are left untouched. Values
   * are HTML-escaped before substitution into the (HTML) body to avoid a
   * stray client name breaking markup; the subject is plain text.
   */
  private interpolate(
    rule: { subject: string; body: string },
    inv: any,
    recipient: string,
  ): { subject: string; html: string } {
    const currency = inv.currency?.symbol ?? inv.currency?.code ?? '';
    const amountNum = Number(inv.total ?? 0);
    // Honor the invoice currency's decimalPlaces (e.g. JPY → 0). Fall back
    // to 2 when the currency (or the field) isn't available. Clamp to the
    // range Number.prototype.toFixed accepts (0..100).
    const dp = Number.isFinite(inv.currency?.decimalPlaces)
      ? Math.min(100, Math.max(0, Math.trunc(inv.currency.decimalPlaces)))
      : 2;
    const amount = `${currency}${currency ? ' ' : ''}${amountNum.toFixed(dp)}`.trim();
    const dueDate = inv.dueDate
      ? new Date(inv.dueDate).toISOString().slice(0, 10)
      : '';
    const clientName = inv.client?.company ?? '';
    const invoiceNumber = inv.number ?? '';

    const valuesPlain: Record<string, string> = {
      invoice_number: invoiceNumber,
      amount,
      due_date: dueDate,
      client_name: clientName,
    };
    const valuesHtml: Record<string, string> = {
      invoice_number: escapeHtml(invoiceNumber),
      amount: escapeHtml(amount),
      due_date: escapeHtml(dueDate),
      client_name: escapeHtml(clientName),
    };

    return {
      subject: applyPlaceholders(rule.subject, valuesPlain),
      html: applyPlaceholders(rule.body, valuesHtml),
    };
  }
}

// ─── Pure helpers ─────────────────────────────────────────────────────────────

function applyPlaceholders(
  template: string,
  values: Record<string, string>,
): string {
  return template.replace(/\{\{\s*([a-z_]+)\s*\}\}/gi, (match, key) => {
    const k = String(key).toLowerCase();
    return Object.prototype.hasOwnProperty.call(values, k) ? values[k] : match;
  });
}

function escapeHtml(s: string): string {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** Midnight UTC of `d`. Comparisons are date-granular (no time-of-day). */
function startOfDay(d: Date): Date {
  const x = new Date(d);
  x.setUTCHours(0, 0, 0, 0);
  return x;
}

function startOfToday(): Date {
  return startOfDay(new Date());
}

function addDays(d: Date, days: number): Date {
  const x = new Date(d);
  x.setUTCDate(x.getUTCDate() + days);
  return x;
}
