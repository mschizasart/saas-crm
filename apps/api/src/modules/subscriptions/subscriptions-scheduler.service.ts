import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { SubscriptionsService } from './subscriptions.service';

/**
 * Stub scheduler for subscription billing. Runs every 6 hours and asks the
 * SubscriptionsService to process any subscriptions whose `nextInvoiceAt` has
 * passed. Kept intentionally lightweight (no BullMQ queue yet) — mirrors the
 * shape of invoices' RecurringScheduler so it can be swapped in later.
 */
@Injectable()
export class SubscriptionsScheduler {
  private readonly logger = new Logger(SubscriptionsScheduler.name);

  constructor(private readonly subscriptions: SubscriptionsService) {}

  @Cron(CronExpression.EVERY_6_HOURS)
  async tick() {
    try {
      const result = await this.subscriptions.runDueBilling();
      this.logger.log(
        `Subscription billing tick: processed=${result.processed ?? 0}${result.skipped ? ' (skipped — missing columns)' : ''}`,
      );
    } catch (err) {
      this.logger.error(
        `Subscription billing tick failed: ${(err as Error).message}`,
      );
    }
  }
}
