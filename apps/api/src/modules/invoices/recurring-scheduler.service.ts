import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';

/**
 * Every 6 hours, enqueue a single job into 'recurring-invoices'.
 * The processor scans for due invoices and regenerates them.
 */
@Injectable()
export class RecurringScheduler {
  private readonly logger = new Logger(RecurringScheduler.name);

  constructor(
    @InjectQueue('recurring-invoices') private readonly queue: Queue,
  ) {}

  @Cron(CronExpression.EVERY_6_HOURS)
  async scheduleRecurringCheck() {
    try {
      await this.queue.add(
        'check',
        { triggeredAt: new Date().toISOString() },
        {
          attempts: 3,
          backoff: { type: 'exponential', delay: 10000 },
          removeOnComplete: 100,
          removeOnFail: 500,
        },
      );
      this.logger.log('Enqueued recurring-invoice check job');
    } catch (err) {
      this.logger.error(
        `Failed to enqueue recurring-invoice check: ${(err as Error).message}`,
      );
    }
  }
}
