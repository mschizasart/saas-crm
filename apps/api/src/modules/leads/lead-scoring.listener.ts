import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { PrismaService } from '../../database/prisma.service';

/**
 * Bridges domain events → 'lead-scoring' queue jobs and exposes helpers
 * for the controller (manual recompute, bulk score-all).
 *
 * NEVER blocks the originating HTTP path — every entry point only enqueues.
 */
@Injectable()
export class LeadScoringListener {
  private readonly logger = new Logger(LeadScoringListener.name);

  constructor(
    @InjectQueue('lead-scoring') private readonly queue: Queue,
    private readonly prisma: PrismaService,
  ) {}

  // ─── Event hooks ────────────────────────────────────────────────────

  @OnEvent('lead.created')
  async onLeadCreated(payload: { lead: { id: string }; orgId: string }) {
    if (!payload?.lead?.id || !payload?.orgId) return;
    await this.enqueue(payload.orgId, payload.lead.id, false);
  }

  @OnEvent('lead.updated')
  async onLeadUpdated(payload: { lead?: { id: string }; leadId?: string; orgId: string }) {
    const leadId = payload?.lead?.id ?? payload?.leadId;
    if (!leadId || !payload?.orgId) return;
    await this.enqueue(payload.orgId, leadId, false);
  }

  /**
   * Fired by the inbox connector when an inbound message is routed to a
   * lead — strong signal the lead is engaging, so we re-score immediately
   * (force=true to bypass the 6-hour freshness window).
   */
  @OnEvent('inbox.routed-to-lead')
  async onInboxRoutedToLead(payload: { orgId: string; leadId: string }) {
    if (!payload?.leadId || !payload?.orgId) return;
    await this.enqueue(payload.orgId, payload.leadId, true);
  }

  // ─── Public helpers (controller calls these) ────────────────────────

  /** Enqueue a single lead with force=true (manual recompute endpoint). */
  async enqueueOne(orgId: string, leadId: string): Promise<void> {
    await this.enqueue(orgId, leadId, true);
  }

  /**
   * Enqueue scoring for every lead in the org. Returns the number queued.
   *
   * Each lead gets its own job — concurrency: 4 in the processor means
   * we'll burn through them at ~4 leads/sec (2 of those seconds are the
   * Anthropic round-trip).
   */
  async enqueueAllForOrg(orgId: string): Promise<{ enqueued: number }> {
    const leads = await this.prisma.lead.findMany({
      where: { organizationId: orgId },
      select: { id: true },
    });

    // Add in batches with a stable jobId so a re-trigger doesn't double-queue.
    let enqueued = 0;
    for (const l of leads) {
      try {
        await this.enqueue(orgId, l.id, true);
        enqueued++;
      } catch (err) {
        this.logger.warn(
          `Failed to enqueue lead ${l.id} during score-all for ${orgId}: ${(err as Error).message}`,
        );
      }
    }
    return { enqueued };
  }

  // ─── Internals ──────────────────────────────────────────────────────

  private async enqueue(orgId: string, leadId: string, force: boolean): Promise<void> {
    try {
      await this.queue.add(
        'score',
        { orgId, leadId, force },
        {
          // Stable jobId so a burst of edits to the same lead collapses
          // into one pending job rather than N. The `force` flag flips
          // the suffix so a manual recompute isn't deduped against the
          // routine event-driven enqueue.
          jobId: `lead:${leadId}:${force ? 'force' : 'auto'}`,
          attempts: 1,
          removeOnComplete: 100,
          removeOnFail: 200,
        },
      );
    } catch (err) {
      this.logger.error(
        `Failed to enqueue scoring for lead ${leadId}: ${(err as Error).message}`,
      );
    }
  }
}
