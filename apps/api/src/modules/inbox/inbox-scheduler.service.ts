import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { PrismaService } from '../../database/prisma.service';

/**
 * Every 5 minutes, enqueue an `inbox-imap` poll job for each org that has
 * `EmailSettings.imapEnabled = true`. Per-org dedup via `jobId` prevents
 * stacking up backlog if a poll runs long.
 *
 * BullMQ-only — no in-process intervals. The job concurrency / retries
 * are encoded on the job options; the worker runs inside InboxImapProcessor.
 */
@Injectable()
export class InboxScheduler implements OnModuleInit {
  private readonly logger = new Logger(InboxScheduler.name);

  constructor(
    private readonly prisma: PrismaService,
    @InjectQueue('inbox-imap') private readonly queue: Queue,
  ) {}

  async onModuleInit() {
    // Make the queue's concurrency intent visible at boot. The actual
    // worker concurrency is controlled by Worker options if needed; for
    // now we accept BullMQ's default and rely on the per-org jobId to
    // cap overlap.
    this.logger.log('InboxScheduler initialised');
  }

  @Cron('*/5 * * * *')
  async scheduleAll() {
    let rows: { organizationId: string }[] = [];
    try {
      rows = await (this.prisma as any).emailSettings.findMany({
        where: { imapEnabled: true },
        select: { organizationId: true },
      });
    } catch (err) {
      this.logger.error(
        `Failed to load email_settings: ${(err as Error).message}`,
      );
      return;
    }

    let enqueued = 0;
    for (const row of rows) {
      try {
        await this.queue.add(
          'imap-poll-org',
          { orgId: row.organizationId },
          {
            attempts: 3,
            backoff: { type: 'exponential', delay: 30_000 },
            removeOnComplete: 500,
            removeOnFail: 1000,
            // De-dupe in-flight polls — a poll already running for this
            // org will be ignored by BullMQ until it completes/expires.
            jobId: `inbox-imap:${row.organizationId}`,
          },
        );
        enqueued++;
      } catch (err) {
        this.logger.error(
          `Failed to enqueue inbox-imap for ${row.organizationId}: ${(err as Error).message}`,
        );
      }
    }
    if (enqueued > 0) {
      this.logger.log(`Enqueued ${enqueued} inbox-imap poll job(s)`);
    }
  }
}
