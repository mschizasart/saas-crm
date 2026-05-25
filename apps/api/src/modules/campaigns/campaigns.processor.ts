import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Job } from 'bullmq';
import { Logger } from '@nestjs/common';
import { CampaignsService } from './campaigns.service';

/**
 * Worker for the 'campaigns' queue.
 *
 * Job payload: { orgId: string; campaignId: string }
 *
 * One job per campaign drives the whole send. The per-recipient fan-out and
 * the SMTP rate cap live inside CampaignsService.runSend() (it sends in
 * batches of 5 via EmailsService.queue(), which itself retries/backs-off per
 * email). Concurrency here is 5 so at most 5 campaigns across the org base
 * are draining at once — bounding total pressure on the shared SMTP path.
 *
 * attempts:1 (set at enqueue) — we do NOT retry the whole campaign on
 * failure, because runSend is not idempotent at the campaign level (already
 * 'sent' recipients are skipped via the pending filter, but a blanket retry
 * could double-count). Individual email retries are handled by the 'emails'
 * queue. Per-recipient failures are recorded on the CampaignRecipient row.
 */
@Processor('campaigns', { concurrency: 5 })
export class CampaignsProcessor extends WorkerHost {
  private readonly logger = new Logger(CampaignsProcessor.name);

  constructor(private readonly campaigns: CampaignsService) {
    super();
  }

  async process(job: Job<{ orgId: string; campaignId: string }>) {
    const { orgId, campaignId } = job.data;
    if (!orgId || !campaignId) {
      this.logger.warn(`Campaign job ${job.id} missing orgId/campaignId — dropping`);
      return { skipped: true };
    }
    this.logger.log(`Processing campaign send job ${job.id} → ${campaignId}`);
    try {
      await this.campaigns.runSend(orgId, campaignId);
      return { done: true };
    } catch (err) {
      this.logger.error(
        `Campaign send job ${job.id} (${campaignId}) failed: ${(err as Error).message}`,
      );
      // Swallow so BullMQ doesn't retry the whole campaign — partial sends
      // are already recorded per-recipient. Surface via logs only.
      return { error: (err as Error).message };
    }
  }
}
