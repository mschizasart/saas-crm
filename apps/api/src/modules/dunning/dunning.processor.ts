import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Job } from 'bullmq';
import { Logger } from '@nestjs/common';
import { DunningService } from './dunning.service';

export interface DunningRunJob {
  orgId: string;
}

/**
 * Worker for the 'dunning' queue. Each job runs the dunning pass for a
 * single org. Concurrency 4 — a soft cap on how many org sweeps run in
 * parallel per node.
 *
 * Re-running the same org concurrently is SAFE: the
 * `@@unique([invoiceId, ruleId])` guard in dunning.service.ts makes any
 * duplicate send impossible. The scheduler additionally de-dupes in-flight
 * jobs per org via `jobId`.
 */
@Processor('dunning', { concurrency: 4 })
export class DunningProcessor extends WorkerHost {
  private readonly logger = new Logger(DunningProcessor.name);

  constructor(private readonly dunning: DunningService) {
    super();
  }

  async process(job: Job<DunningRunJob>) {
    const { orgId } = job.data;
    if (!orgId) {
      this.logger.warn(`Dunning job ${job.id} missing orgId — dropping`);
      return { skipped: true };
    }
    this.logger.log(`Dunning run start: org=${orgId} job=${job.id}`);
    try {
      const result = await this.dunning.runForOrg(orgId);
      return result;
    } catch (err) {
      // Don't poison the queue on a single org's failure — log and return.
      this.logger.error(
        `Dunning run failed for org=${orgId}: ${(err as Error).message}`,
      );
      return { error: (err as Error).message };
    }
  }
}
