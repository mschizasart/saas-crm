import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { PrismaService } from '../../database/prisma.service';

/**
 * Belt-and-braces retry sweeper.
 *
 * BullMQ + Redis can lose delayed jobs (process restart, redis flush,
 * cluster failover). Our delivery rows in `public_webhook_deliveries`
 * carry their own `nextAttemptAt`, which is the AUTHORITATIVE schedule.
 * Every minute we look for rows that are due (nextAttemptAt <= now,
 * succeeded=false, attemptCount < MAX) and re-enqueue them.
 *
 * The processor de-dups via `jobId`, so re-enqueueing a row that's
 * already in flight is a no-op — meaning we can re-enqueue greedily
 * without worrying about double-delivery.
 */
@Injectable()
export class WebhookRetryScheduler {
  private readonly logger = new Logger(WebhookRetryScheduler.name);
  private static readonly MAX_ATTEMPTS = 5;
  private static readonly BATCH_SIZE = 200;

  constructor(
    private readonly prisma: PrismaService,
    @InjectQueue('webhook-delivery') private readonly queue: Queue,
  ) {}

  @Cron(CronExpression.EVERY_MINUTE)
  async sweep() {
    try {
      const due = await this.prisma.publicWebhookDelivery.findMany({
        where: {
          succeeded: false,
          nextAttemptAt: { not: null, lte: new Date() },
          attemptCount: { lt: WebhookRetryScheduler.MAX_ATTEMPTS },
        },
        select: { id: true, organizationId: true, attemptCount: true },
        take: WebhookRetryScheduler.BATCH_SIZE,
        orderBy: { nextAttemptAt: 'asc' },
      });

      if (due.length === 0) return;

      for (const d of due) {
        // SAME jobId formula the processor uses when it self-re-enqueues
        // after a retry-eligible failure: `deliver:<id>:<nextAttempt>`,
        // where nextAttempt = current attemptCount + 1. BullMQ then dedupes
        // this scheduler job against the processor's delayed retry — only
        // one fires per attempt, so we don't double-deliver.
        const nextAttempt = (d.attemptCount ?? 0) + 1;
        await this.queue.add(
          'deliver',
          { deliveryId: d.id, organizationId: d.organizationId },
          {
            jobId: `deliver:${d.id}:${nextAttempt}`,
            removeOnComplete: 1000,
            removeOnFail: 1000,
          },
        );
      }
      this.logger.log(`Re-enqueued ${due.length} due webhook deliveries`);
    } catch (err) {
      this.logger.error(`Retry sweep failed: ${(err as Error).message}`);
    }
  }
}
