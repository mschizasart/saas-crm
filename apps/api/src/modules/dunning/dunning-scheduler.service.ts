import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { PrismaService } from '../../database/prisma.service';

/**
 * Daily at 08:00 (server time), enqueue a per-org `dunning-run` job for every
 * org with `DunningSettings.enabled = true`. Mirrors InboxScheduler.
 *
 * Per-org dedup via `jobId` prevents stacking up overlapping runs if a sweep
 * runs long or the cron fires while a manual "Run now" is still in flight.
 * Worker concurrency (4) lives on DunningProcessor.
 *
 * Cadence note: dunning is date-granular (it compares today's date to
 * dueDate + offsetDays), so once-per-day is the correct frequency — running
 * more often would never send anything extra, and the unique guard would
 * dedupe it anyway.
 */
@Injectable()
export class DunningScheduler implements OnModuleInit {
  private readonly logger = new Logger(DunningScheduler.name);

  constructor(
    private readonly prisma: PrismaService,
    @InjectQueue('dunning') private readonly queue: Queue,
  ) {}

  async onModuleInit() {
    this.logger.log('DunningScheduler initialised');
  }

  @Cron('0 8 * * *')
  async scheduleAll() {
    let rows: { organizationId: string }[] = [];
    try {
      // Intentionally cross-tenant: we sweep EVERY org with dunning enabled.
      // `withoutTenant` makes the no-RLS intent explicit (the per-org sweep
      // inside DunningService re-scopes each run via withOrganization).
      rows = await this.prisma.withoutTenant(() =>
        this.prisma.dunningSettings.findMany({
          where: { enabled: true },
          select: { organizationId: true },
        }),
      );
    } catch (err) {
      this.logger.error(
        `Failed to load dunning_settings: ${(err as Error).message}`,
      );
      return;
    }

    let enqueued = 0;
    for (const row of rows) {
      try {
        await this.queue.add(
          'dunning-run',
          { orgId: row.organizationId },
          {
            attempts: 3,
            backoff: { type: 'exponential', delay: 30_000 },
            removeOnComplete: 500,
            removeOnFail: 1000,
            // De-dupe in-flight sweeps — a run already queued/running for
            // this org is ignored until it completes/expires.
            jobId: `dunning-run:${row.organizationId}`,
          },
        );
        enqueued++;
      } catch (err) {
        this.logger.error(
          `Failed to enqueue dunning-run for ${row.organizationId}: ${(err as Error).message}`,
        );
      }
    }
    if (enqueued > 0) {
      this.logger.log(`Enqueued ${enqueued} dunning-run job(s)`);
    }
  }
}
