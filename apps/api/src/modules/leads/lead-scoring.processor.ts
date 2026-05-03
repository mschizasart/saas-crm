import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Job } from 'bullmq';
import { Logger } from '@nestjs/common';
import { LeadScoringService } from './lead-scoring.service';

/**
 * Worker for the 'lead-scoring' queue.
 *
 * Job payload: { orgId: string; leadId: string; force?: boolean }
 *
 * Concurrency is 4 — this is a soft cap on how many concurrent Anthropic
 * calls we'll have in flight per node. The Haiku model is cheap and fast
 * (~1-2s per call) so 4 in flight is plenty for a single org doing a
 * "score all" sweep without blowing through the rate limit shared with
 * the inbox AI features.
 *
 * Failures are NOT retried for individual lead scoring jobs — a transient
 * Anthropic 5xx already triggers the in-service neutral-25 fallback, so
 * the score is always written (just a less informative one). Retrying
 * would just spend more tokens for the same outcome.
 */
@Processor('lead-scoring', { concurrency: 4 })
export class LeadScoringProcessor extends WorkerHost {
  private readonly logger = new Logger(LeadScoringProcessor.name);

  constructor(private readonly scoring: LeadScoringService) {
    super();
  }

  async process(job: Job<{ orgId: string; leadId: string; force?: boolean }>) {
    const { orgId, leadId, force } = job.data;
    if (!orgId || !leadId) {
      this.logger.warn(`Lead scoring job ${job.id} missing orgId/leadId — dropping`);
      return { skipped: true };
    }

    try {
      const result = await this.scoring.scoreLead(orgId, leadId, { force });
      return { score: result.score };
    } catch (err) {
      // Don't let a single missing/deleted lead poison the queue. Log
      // and return success so BullMQ doesn't retry forever.
      this.logger.warn(
        `Lead scoring job ${job.id} for ${leadId} failed: ${(err as Error).message}`,
      );
      return { error: (err as Error).message };
    }
  }
}
