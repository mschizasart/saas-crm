import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Job } from 'bullmq';
import { Logger } from '@nestjs/common';
import { EmailsService, OutboundTracking } from './emails.service';

export interface EmailJobData {
  to: string;
  subject: string;
  html: string;
  attachments?: any[];
  /** When present, EmailsService resolves per-org SMTP; else env fallback. */
  orgId?: string;
  /** Tracking metadata passed through from EmailsService.queue(). */
  tracking?: OutboundTracking;
  /**
   * Pre-allocated trackingId — set by EmailsService.queue() so the same
   * tracking row is used across BullMQ retries (no duplicate rows).
   */
  trackingId?: string;
}

@Processor('emails')
export class EmailProcessor extends WorkerHost {
  private readonly logger = new Logger(EmailProcessor.name);

  constructor(private readonly emails: EmailsService) {
    super();
  }

  async process(job: Job<EmailJobData>) {
    this.logger.log(`Processing email job ${job.id} → ${job.data.to}`);
    try {
      // Spread so EmailsService.send() sees both the `tracking` block (kept
      // for direct-send compatibility) AND the pre-allocated trackingId.
      await this.emails.send(job.data);
      return { sent: true };
    } catch (err) {
      this.logger.error(
        `Email job ${job.id} failed (attempt ${job.attemptsMade + 1}): ${(err as Error).message}`,
      );
      throw err;
    }
  }
}
