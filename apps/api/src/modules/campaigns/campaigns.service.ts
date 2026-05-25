import {
  Injectable,
  Logger,
  NotFoundException,
  BadRequestException,
  ConflictException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { PrismaService } from '../../database/prisma.service';
import { EmailsService } from '../emails/emails.service';
import {
  signUnsubscribeToken,
  verifyUnsubscribeToken,
} from './unsubscribe-token';

export interface CreateCampaignDto {
  name: string;
  subject?: string;
  body?: string;
  segmentType?: 'all_clients' | 'all_leads' | 'lead_status' | 'manual';
  segmentConfig?: Record<string, any>;
  scheduledAt?: string | null;
}

export type UpdateCampaignDto = Partial<CreateCampaignDto> & {
  status?: string;
};

interface ResolvedRecipient {
  email: string;
  name: string | null;
  recipientType: 'client' | 'lead';
  recipientId: string | null;
}

const VALID_SEGMENTS = ['all_clients', 'all_leads', 'lead_status', 'manual'];

/**
 * Hard cap on the number of recipients a single campaign send can resolve to.
 * Prevents an accidental (or malicious) unbounded blast that would hammer the
 * SMTP provider and risk the org's sending reputation. This is a flat constant
 * for now; a plan-based limit (e.g. derived from the org's subscription tier)
 * can replace it later without changing the call site.
 */
const MAX_CAMPAIGN_RECIPIENTS = 10000;

@Injectable()
export class CampaignsService {
  private readonly logger = new Logger(CampaignsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    private readonly emails: EmailsService,
    @InjectQueue('campaigns') private readonly queue: Queue,
  ) {}

  // ─── CRUD ──────────────────────────────────────────────────────────────

  async findAll(orgId: string) {
    return this.prisma.withOrganization(orgId, async (tx: any) => {
      const rows = await tx.campaign.findMany({
        where: { organizationId: orgId },
        orderBy: { createdAt: 'desc' },
      });
      // Aggregate open counts per campaign for the "open rate" column. One
      // grouped query across all of this org's campaign outbound rows.
      const ids = rows.map((r: any) => r.id);
      const openByCampaign = await this.openCountsByCampaign(tx, orgId, ids);
      return rows.map((r: any) => ({
        ...r,
        openedCount: openByCampaign.get(r.id) ?? 0,
      }));
    });
  }

  async findOne(orgId: string, id: string) {
    const campaign = await this.prisma.withOrganization(
      orgId,
      async (tx: any) =>
        tx.campaign.findFirst({ where: { id, organizationId: orgId } }),
    );
    if (!campaign) throw new NotFoundException('Campaign not found');
    return campaign;
  }

  async create(orgId: string, dto: CreateCampaignDto, userId?: string) {
    if (!dto.name?.trim()) {
      throw new BadRequestException('Campaign name is required');
    }
    const segmentType = dto.segmentType ?? 'all_clients';
    if (!VALID_SEGMENTS.includes(segmentType)) {
      throw new BadRequestException(`Invalid segmentType: ${segmentType}`);
    }
    return this.prisma.withOrganization(orgId, async (tx: any) =>
      tx.campaign.create({
        data: {
          organizationId: orgId,
          name: dto.name.trim(),
          subject: dto.subject?.trim() ?? '',
          body: dto.body ?? '',
          segmentType,
          segmentConfig: dto.segmentConfig ?? {},
          scheduledAt: dto.scheduledAt ? new Date(dto.scheduledAt) : null,
          status: dto.scheduledAt ? 'scheduled' : 'draft',
          createdById: userId ?? null,
        },
      }),
    );
  }

  async update(orgId: string, id: string, dto: UpdateCampaignDto) {
    const existing = await this.findOne(orgId, id);
    // Once a campaign has started sending we lock the content — editing the
    // body/subject mid-send (or after) would make the stored copy diverge
    // from what recipients actually received.
    if (['sending', 'sent'].includes(existing.status)) {
      throw new ConflictException(
        `Campaign is ${existing.status} and can no longer be edited`,
      );
    }
    if (dto.segmentType && !VALID_SEGMENTS.includes(dto.segmentType)) {
      throw new BadRequestException(`Invalid segmentType: ${dto.segmentType}`);
    }

    const data: any = {};
    if (dto.name !== undefined) data.name = dto.name.trim();
    if (dto.subject !== undefined) data.subject = dto.subject.trim();
    if (dto.body !== undefined) data.body = dto.body;
    if (dto.segmentType !== undefined) data.segmentType = dto.segmentType;
    if (dto.segmentConfig !== undefined) data.segmentConfig = dto.segmentConfig;
    if (dto.scheduledAt !== undefined) {
      data.scheduledAt = dto.scheduledAt ? new Date(dto.scheduledAt) : null;
      // Keep status in sync with scheduling, but never downgrade out of a
      // terminal/in-flight state (guarded above).
      if (dto.status === undefined) {
        data.status = dto.scheduledAt ? 'scheduled' : 'draft';
      }
    }
    if (dto.status !== undefined) data.status = dto.status;

    return this.prisma.withOrganization(orgId, async (tx: any) =>
      tx.campaign.update({
        where: { id: existing.id },
        data,
      }),
    );
  }

  async remove(orgId: string, id: string) {
    const existing = await this.findOne(orgId, id);
    if (existing.status === 'sending') {
      throw new ConflictException('Cannot delete a campaign while it is sending');
    }
    await this.prisma.withOrganization(orgId, async (tx: any) => {
      // CampaignRecipient rows cascade via FK (migration 024).
      await tx.campaign.delete({ where: { id: existing.id } });
    });
    return { deleted: true };
  }

  // ─── Segment resolution ────────────────────────────────────────────────

  /**
   * Resolve a campaign's segment to a de-duplicated, unsubscribe-filtered
   * list of recipients. Pure read — does NOT persist or send.
   *
   * Dedup: a Map keyed by lower-cased email keeps the FIRST occurrence, so
   * a client whose contact email also appears as a lead won't be emailed
   * twice. Unsubscribed addresses (email_unsubscribes for this org) are
   * dropped entirely.
   */
  async resolveRecipients(
    orgId: string,
    campaign: { segmentType: string; segmentConfig: any },
  ): Promise<ResolvedRecipient[]> {
    const cfg = campaign.segmentConfig ?? {};
    const raw: ResolvedRecipient[] = [];

    await this.prisma.withOrganization(orgId, async (tx: any) => {
      if (
        campaign.segmentType === 'all_clients' ||
        (campaign.segmentType === 'manual' && this.isClientManual(cfg))
      ) {
        // Clients themselves have no email column — their addressable
        // contacts are User rows (type='contact') with an email. We email
        // every active contact of each matching client.
        const where: any = { organizationId: orgId };
        if (campaign.segmentType === 'manual') {
          where.id = { in: this.manualIds(cfg) };
        }
        const clients = await tx.client.findMany({
          where,
          select: {
            id: true,
            company: true,
            contacts: {
              where: { type: 'contact', active: true },
              select: { email: true, firstName: true, lastName: true },
            },
          },
        });
        for (const c of clients) {
          for (const contact of c.contacts) {
            if (!contact.email) continue;
            raw.push({
              email: contact.email,
              name:
                [contact.firstName, contact.lastName]
                  .filter(Boolean)
                  .join(' ')
                  .trim() ||
                c.company ||
                null,
              recipientType: 'client',
              recipientId: c.id,
            });
          }
        }
      }

      if (
        campaign.segmentType === 'all_leads' ||
        campaign.segmentType === 'lead_status' ||
        (campaign.segmentType === 'manual' && !this.isClientManual(cfg))
      ) {
        const where: any = { organizationId: orgId, email: { not: null } };
        if (campaign.segmentType === 'lead_status' && cfg.statusId) {
          where.statusId = cfg.statusId;
        }
        if (campaign.segmentType === 'manual') {
          where.id = { in: this.manualIds(cfg) };
        }
        const leads = await tx.lead.findMany({
          where,
          select: { id: true, name: true, email: true },
        });
        for (const l of leads) {
          if (!l.email) continue;
          raw.push({
            email: l.email,
            name: l.name ?? null,
            recipientType: 'lead',
            recipientId: l.id,
          });
        }
      }
    });

    // ── Unsubscribe filtering ──────────────────────────────────────────
    const suppressed = await this.suppressedEmails(orgId);

    // ── Dedup by lower-cased email; keep first occurrence ───────────────
    const seen = new Map<string, ResolvedRecipient>();
    for (const r of raw) {
      const key = r.email.trim().toLowerCase();
      if (!key || !this.looksLikeEmail(key)) continue;
      if (suppressed.has(key)) continue;
      if (!seen.has(key)) seen.set(key, { ...r, email: r.email.trim() });
    }
    return [...seen.values()];
  }

  /** Manual segments default to leads unless `recipientType: 'client'`. */
  private isClientManual(cfg: any): boolean {
    return cfg?.recipientType === 'client';
  }

  private manualIds(cfg: any): string[] {
    return Array.isArray(cfg?.ids) ? cfg.ids.filter((x: any) => !!x) : [];
  }

  private looksLikeEmail(s: string): boolean {
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s);
  }

  private async suppressedEmails(orgId: string): Promise<Set<string>> {
    const rows = await this.prisma.withOrganization(orgId, async (tx: any) =>
      tx.emailUnsubscribe.findMany({
        where: { organizationId: orgId },
        select: { email: true },
      }),
    );
    return new Set(rows.map((r: any) => r.email.trim().toLowerCase()));
  }

  // ─── Preview ───────────────────────────────────────────────────────────

  async previewRecipients(orgId: string, id: string) {
    const campaign = await this.findOne(orgId, id);
    const recipients = await this.resolveRecipients(orgId, campaign);
    return {
      total: recipients.length,
      sample: recipients.slice(0, 20),
    };
  }

  // ─── Send ──────────────────────────────────────────────────────────────

  /**
   * Resolve the segment, persist CampaignRecipient rows (dedup by email),
   * flip status to 'sending', and enqueue ONE BullMQ job to drive the send
   * loop. The actual per-recipient sends happen in the processor with a
   * concurrency cap so we don't hammer the SMTP provider. Returns fast.
   */
  async send(orgId: string, id: string) {
    const campaign = await this.findOne(orgId, id);
    if (['sending', 'sent'].includes(campaign.status)) {
      throw new ConflictException(`Campaign is already ${campaign.status}`);
    }
    if (!campaign.subject?.trim() || !campaign.body?.trim()) {
      throw new BadRequestException(
        'Campaign needs a subject and body before sending',
      );
    }

    // ── Atomic send-claim (compare-and-set) ────────────────────────────────
    // Two concurrent POST /send calls both pass the read-time `draft` guard
    // above. To guarantee EXACTLY ONE of them proceeds, flip the status to
    // 'sending' with a conditional updateMany and inspect the affected row
    // count. The DB serialises these writes: only the first observes
    // status NOT IN ('sending','sent') and gets count=1; the loser gets
    // count=0 and aborts with 409. Only the winner resolves recipients +
    // enqueues, so the campaign can never be double-enqueued / double-sent.
    const claim = await this.prisma.withOrganization(orgId, async (tx: any) =>
      tx.campaign.updateMany({
        where: {
          id: campaign.id,
          organizationId: orgId,
          status: { notIn: ['sending', 'sent'] },
        },
        data: { status: 'sending' },
      }),
    );
    if (claim.count === 0) {
      throw new ConflictException('Campaign already sending or sent');
    }

    // From here on we own the 'sending' claim. Any failure must roll the
    // status back so the campaign isn't stuck mid-send and can be retried.
    try {
      const recipients = await this.resolveRecipients(orgId, campaign);
      if (recipients.length === 0) {
        throw new BadRequestException(
          'Segment resolved to 0 recipients — nothing to send',
        );
      }
      if (recipients.length > MAX_CAMPAIGN_RECIPIENTS) {
        throw new BadRequestException(
          `Campaign exceeds the ${MAX_CAMPAIGN_RECIPIENTS}-recipient limit; narrow the segment.`,
        );
      }

      // Belt-and-suspenders suppression: re-read the unsubscribe list at the
      // moment we materialise recipient rows. resolveRecipients() filtered at
      // resolve time, but an address could have unsubscribed in the window
      // between resolve and here — drop those too so a just-unsubscribed
      // address can never slip into the send set.
      const suppressed = await this.suppressedEmails(orgId);
      const toInsert = recipients.filter(
        (r) => !suppressed.has(r.email.trim().toLowerCase()),
      );
      if (toInsert.length === 0) {
        throw new BadRequestException(
          'Segment resolved to 0 recipients — nothing to send',
        );
      }

      const persistedCount = await this.prisma.withOrganization(
        orgId,
        async (tx: any) => {
          // Insert recipient rows. createMany + skipDuplicates handles the
          // @@unique(campaignId, email) constraint defensively (e.g. a retry
          // of this call after a partial insert).
          await tx.campaignRecipient.createMany({
            data: toInsert.map((r) => ({
              campaignId: campaign.id,
              organizationId: orgId,
              email: r.email,
              name: r.name,
              recipientType: r.recipientType,
              recipientId: r.recipientId,
              status: 'pending',
            })),
            skipDuplicates: true,
          });
          // Authoritative recipient count = rows that actually exist for this
          // campaign (post-dedup / post-skipDuplicates), not the pre-persist
          // resolved length.
          const total = await tx.campaignRecipient.count({
            where: { campaignId: campaign.id, organizationId: orgId },
          });
          await tx.campaign.update({
            where: { id: campaign.id },
            data: {
              // status already 'sending' from the claim above.
              totalRecipients: total,
              sentCount: 0,
              failedCount: 0,
            },
          });
          return total;
        },
      );

      await this.queue.add(
        'send-campaign',
        { orgId, campaignId: campaign.id },
        {
          // Stable jobId so a double-click on "Send" collapses to one job.
          jobId: `campaign:${campaign.id}`,
          attempts: 1,
          removeOnComplete: 100,
          removeOnFail: 200,
        },
      );

      return { queued: true, totalRecipients: persistedCount };
    } catch (err) {
      // Release the claim so the campaign returns to a sendable state. Only
      // roll back if we still hold 'sending' (the processor hasn't taken over).
      await this.prisma
        .withOrganization(orgId, async (tx: any) => {
          await tx.campaign.updateMany({
            where: {
              id: campaign.id,
              organizationId: orgId,
              status: 'sending',
            },
            data: { status: campaign.status },
          });
        })
        .catch(() => undefined);
      throw err;
    }
  }

  /**
   * Drives the actual send for one campaign. Called by the processor.
   * Iterates pending recipients in batches, enqueuing each individual email
   * through EmailsService.queue() with campaign tracking. A small in-loop
   * delay between batches keeps us from flooding the SMTP provider on top of
   * the queue's own per-email retry/backoff.
   *
   * Per-recipient OutboundMessage rows are created by EmailsService.queue()
   * (tracking → preCreateTrackingRow), which RETURNS the new row's id. We
   * stamp that id onto the CampaignRecipient so the stats endpoint can join
   * opens/clicks back — no post-hoc lookup, so no time-of-check race.
   */
  async runSend(orgId: string, campaignId: string) {
    const campaign = await this.prisma.withOrganization(
      orgId,
      async (tx: any) =>
        tx.campaign.findFirst({ where: { id: campaignId, organizationId: orgId } }),
    );
    if (!campaign) {
      this.logger.warn(`runSend: campaign ${campaignId} not found — skipping`);
      return;
    }

    const pending: Array<{
      id: string;
      email: string;
      name: string | null;
    }> = await this.prisma.withOrganization(orgId, async (tx: any) =>
      tx.campaignRecipient.findMany({
        where: { campaignId, organizationId: orgId, status: 'pending' },
        select: { id: true, email: true, name: true },
      }),
    );

    const appUrl =
      process.env.APP_URL ?? this.config.get<string>('APP_URL') ?? '';
    const BATCH = 5; // soft SMTP rate cap — see processor docstring.
    let sent = 0;
    let failed = 0;

    for (let i = 0; i < pending.length; i += BATCH) {
      const batch = pending.slice(i, i + BATCH);
      await Promise.all(
        batch.map(async (r) => {
          try {
            const html = this.buildHtml(orgId, campaign.body, r.email, appUrl);
            // queue() pre-creates the OutboundMessage tracking row and returns
            // its id directly, so we link this recipient to the exact row that
            // was just created — no time-of-check findFirst race.
            const { outboundMessageId: omId } = await this.emails.queue({
              orgId,
              to: r.email,
              subject: campaign.subject,
              html,
              tracking: { routedTo: 'campaign', routedToId: campaignId },
            });
            await this.prisma.withOrganization(orgId, async (tx: any) => {
              await tx.campaignRecipient.update({
                where: { id: r.id },
                data: {
                  status: 'sent',
                  sentAt: new Date(),
                  // null (not undefined) when tracking row wasn't created, so
                  // the column is set explicitly rather than left untouched.
                  outboundMessageId: omId ?? null,
                  error: null,
                },
              });
            });
            sent++;
          } catch (err) {
            failed++;
            this.logger.warn(
              `Campaign ${campaignId} send to ${r.email} failed: ${(err as Error).message}`,
            );
            await this.prisma
              .withOrganization(orgId, async (tx: any) => {
                await tx.campaignRecipient.update({
                  where: { id: r.id },
                  data: {
                    status: 'failed',
                    error: (err as Error).message?.slice(0, 500) ?? 'unknown',
                  },
                });
              })
              .catch(() => undefined);
          }
        }),
      );
      // Update running counters after each batch so the UI reflects progress.
      await this.prisma
        .withOrganization(orgId, async (tx: any) => {
          await tx.campaign.update({
            where: { id: campaignId },
            data: { sentCount: sent, failedCount: failed },
          });
        })
        .catch(() => undefined);
    }

    await this.prisma.withOrganization(orgId, async (tx: any) => {
      await tx.campaign.update({
        where: { id: campaignId },
        data: {
          status: failed > 0 && sent === 0 ? 'failed' : 'sent',
          sentAt: new Date(),
          sentCount: sent,
          failedCount: failed,
        },
      });
    });

    this.logger.log(
      `Campaign ${campaignId} finished: sent=${sent} failed=${failed}`,
    );
  }

  /**
   * Inject an unsubscribe footer into the campaign body. The link points at
   * the public unsubscribe page with an HMAC-signed token. EmailsService's
   * injectTracking() leaves anchors whose URL/text contains "unsubscribe"
   * un-rewritten, so this link reaches the recipient intact (not wrapped in
   * the click tracker).
   */
  private buildHtml(
    orgId: string,
    body: string,
    email: string,
    appUrl: string,
  ): string {
    const token = signUnsubscribeToken(
      { orgId, email },
      this.config.get<string>('ENCRYPTION_KEY') ?? process.env.ENCRYPTION_KEY,
    );
    const base = appUrl.replace(/\/$/, '');
    const url = `${base}/unsubscribe/${token}`;
    const footer = `<div style="margin-top:32px;padding-top:16px;border-top:1px solid #e5e7eb;color:#9ca3af;font-size:12px;text-align:center;">
You received this email as part of a mailing list.
<a href="${url}" style="color:#9ca3af;text-decoration:underline;">Unsubscribe</a>
</div>`;
    return `${body}${footer}`;
  }

  // ─── Stats ─────────────────────────────────────────────────────────────

  /**
   * Aggregate sent/failed (from CampaignRecipient) + opens/clicks (joined
   * from the linked OutboundMessage rows). "uniqueOpens" counts recipients
   * with openCount > 0; "totalOpens" sums the raw open events.
   */
  async stats(orgId: string, id: string) {
    const campaign = await this.findOne(orgId, id);
    return this.prisma.withOrganization(orgId, async (tx: any) => {
      const grouped = await tx.campaignRecipient.groupBy({
        by: ['status'],
        where: { campaignId: id, organizationId: orgId },
        _count: { _all: true },
      });
      const counts: Record<string, number> = {};
      for (const g of grouped) counts[g.status] = g._count._all;

      // Opens/clicks come from OutboundMessage. Sum across all tracking rows
      // for this campaign in one raw query (counters live there).
      const agg = await tx.$queryRaw<
        Array<{
          unique_opens: bigint;
          total_opens: bigint;
          unique_clicks: bigint;
          total_clicks: bigint;
        }>
      >`
        SELECT
          COUNT(*) FILTER (WHERE "openCount"  > 0) AS unique_opens,
          COALESCE(SUM("openCount"), 0)            AS total_opens,
          COUNT(*) FILTER (WHERE "clickCount" > 0) AS unique_clicks,
          COALESCE(SUM("clickCount"), 0)           AS total_clicks
        FROM "outbound_messages"
        WHERE "organizationId" = ${orgId}
          AND "routedTo" = 'campaign'
          AND "routedToId" = ${id}
      `;
      const a = agg[0] ?? {};
      const sent = counts['sent'] ?? 0;
      const uniqueOpens = Number(a.unique_opens ?? 0);
      const uniqueClicks = Number(a.unique_clicks ?? 0);

      return {
        status: campaign.status,
        totalRecipients: campaign.totalRecipients,
        sent,
        failed: counts['failed'] ?? 0,
        pending: counts['pending'] ?? 0,
        skipped: counts['skipped'] ?? 0,
        uniqueOpens,
        totalOpens: Number(a.total_opens ?? 0),
        uniqueClicks,
        totalClicks: Number(a.total_clicks ?? 0),
        openRate: sent > 0 ? Math.round((uniqueOpens / sent) * 100) : 0,
        clickRate: sent > 0 ? Math.round((uniqueClicks / sent) * 100) : 0,
      };
    });
  }

  // ─── Unsubscribe (public) ──────────────────────────────────────────────

  /**
   * Verify the HMAC token and add the (org, email) pair to the suppression
   * list. Idempotent — re-clicking the link is a no-op. Returns the org name
   * for the confirmation page.
   */
  async unsubscribe(token: string) {
    let payload: { orgId: string; email: string };
    try {
      payload = verifyUnsubscribeToken(
        token,
        this.config.get<string>('ENCRYPTION_KEY') ?? process.env.ENCRYPTION_KEY,
      );
    } catch (err) {
      throw new BadRequestException('Invalid or expired unsubscribe link');
    }

    const email = payload.email.trim().toLowerCase();
    // The token is org-scoped; write directly (no JWT/tenant context here).
    await this.prisma.emailUnsubscribe
      .create({
        data: { organizationId: payload.orgId, email },
      })
      .catch((e: any) => {
        // P2002 = already unsubscribed → idempotent success.
        if (e?.code !== 'P2002') throw e;
      });

    const org = await this.prisma.organization.findUnique({
      where: { id: payload.orgId },
      select: { name: true },
    });
    return { unsubscribed: true, email, organizationName: org?.name ?? null };
  }

  // ─── Helpers ───────────────────────────────────────────────────────────

  /** Open counts grouped by campaignId for the list view. */
  private async openCountsByCampaign(
    tx: any,
    orgId: string,
    campaignIds: string[],
  ): Promise<Map<string, number>> {
    const map = new Map<string, number>();
    if (campaignIds.length === 0) return map;
    const rows = await tx.$queryRaw<
      Array<{ routedToId: string; unique_opens: bigint }>
    >`
      SELECT "routedToId", COUNT(*) FILTER (WHERE "openCount" > 0) AS unique_opens
      FROM "outbound_messages"
      WHERE "organizationId" = ${orgId}
        AND "routedTo" = 'campaign'
        AND "routedToId" = ANY(${campaignIds})
      GROUP BY "routedToId"
    `;
    for (const r of rows) map.set(r.routedToId, Number(r.unique_opens ?? 0));
    return map;
  }
}
