import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Job } from 'bullmq';
import { Logger } from '@nestjs/common';
import { EmailsService } from './emails.service';

export interface EmailJobData {
  to: string;
  subject: string;
  html: string;
  attachments?: any[];
  /** When present, EmailsService resolves per-org SMTP; else env fallback. */
  orgId?: string;
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
