import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Job } from 'bullmq';
import { Logger } from '@nestjs/common';
import { CalendarSyncService } from './calendar-sync.service';

export interface CalendarSyncJob {
  /** calendar_syncs row id. */
  syncId: string;
}

/**
 * Per-CalendarSync worker. Enqueued by CalendarSyncScheduler every 15 min.
 * Concurrency 4 — same as dunning / lead-scoring.
 *
 * runSync() is intentionally non-throwing (it records lastSyncError), so a
 * single tenant's provider outage never fails the job/retries; the worker
 * just logs the recorded error.
 */
@Processor('calendar-sync', { concurrency: 4 })
export class CalendarSyncProcessor extends WorkerHost {
  private readonly logger = new Logger(CalendarSyncProcessor.name);

  constructor(private readonly service: CalendarSyncService) {
    super();
  }

  async process(job: Job<CalendarSyncJob>) {
    const { syncId } = job.data;
    const row = await this.service.getRowById(syncId);
    if (!row || !row.syncEnabled) {
      this.logger.debug(`Skipping calendar-sync ${syncId} (missing/disabled)`);
      return { skipped: true };
    }
    const result = await this.service.runSync(row);
    this.logger.log(
      `Calendar sync done: sync=${syncId} provider=${row.provider} pulled=${result.pulled} pushed=${result.pushed}${result.error ? ` error="${result.error}"` : ''}`,
    );
    return result;
  }
}
