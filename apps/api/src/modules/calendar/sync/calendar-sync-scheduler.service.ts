import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { CalendarSyncService } from './calendar-sync.service';

/**
 * Every 15 minutes, enqueue a per-CalendarSync `sync` job for every row with
 * `syncEnabled = true`. Mirrors InboxScheduler:
 *   - BullMQ-only (no in-process intervals).
 *   - Per-row jobId dedup so a long-running sync doesn't stack up backlog.
 *   - Worker concurrency is set on the processor (CalendarSyncProcessor = 4).
 *
 * A provider error inside a job is swallowed by CalendarSyncService.runSync()
 * (recorded as lastSyncError) so one tenant's broken connection never blocks
 * the others or triggers a retry storm.
 */
@Injectable()
export class CalendarSyncScheduler implements OnModuleInit {
  private readonly logger = new Logger(CalendarSyncScheduler.name);

  constructor(
    private readonly syncService: CalendarSyncService,
    @InjectQueue('calendar-sync') private readonly queue: Queue,
  ) {}

  async onModuleInit() {
    this.logger.log('CalendarSyncScheduler initialised');
  }

  @Cron('*/15 * * * *')
  async scheduleAll() {
    let rows: { id: string; userId: string; provider: string; organizationId: string }[] = [];
    try {
      rows = await this.syncService.listEnabledSyncs();
    } catch (err) {
      this.logger.error(
        `Failed to load calendar_syncs: ${(err as Error).message}`,
      );
      return;
    }

    let enqueued = 0;
    for (const row of rows) {
      try {
        await this.queue.add(
          'sync',
          { syncId: row.id },
          {
            attempts: 1, // runSync never throws; retries would double-sync.
            removeOnComplete: 500,
            removeOnFail: 1000,
            // De-dupe: a sync already running for this row is ignored until
            // it completes/expires.
            jobId: `calendar-sync:${row.id}`,
          },
        );
        enqueued++;
      } catch (err) {
        this.logger.error(
          `Failed to enqueue calendar-sync for ${row.id}: ${(err as Error).message}`,
        );
      }
    }
    if (enqueued > 0) {
      this.logger.log(`Enqueued ${enqueued} calendar-sync job(s)`);
    }
  }
}
