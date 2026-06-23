import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Job } from 'bullmq';
import { Logger } from '@nestjs/common';
import { SequencesService } from './sequences.service';

export interface SequenceStepJob {
  orgId: string;
  enrollmentId: string;
  stepIndex: number;
}

/**
 * Worker for the 'sequences' queue.
 *
 * Job payload: { orgId, enrollmentId, stepIndex }
 *
 * Each job executes ONE step for ONE enrollment, then advances the enrollment
 * (schedules the next step's nextStepAt or marks it completed). The scheduler
 * (sequences-scheduler.service.ts) enqueues one job per due enrollment every
 * 5 minutes with a stable jobId (`seq:<enrollmentId>:step:<stepIndex>`) so a
 * duplicate scan can't double-enqueue the same step. SequencesService.
 * executeStep is additionally idempotent (it no-ops a stale stepIndex), so
 * BullMQ retries are safe.
 *
 * Concurrency 10 — a soft cap on how many steps drain in parallel per node.
 */
@Processor('sequences', { concurrency: 10 })
export class SequencesProcessor extends WorkerHost {
  private readonly logger = new Logger(SequencesProcessor.name);

  constructor(private readonly sequences: SequencesService) {
    super();
  }

  async process(job: Job<SequenceStepJob>) {
    const { orgId, enrollmentId, stepIndex } = job.data;
    if (!orgId || !enrollmentId || stepIndex === undefined || stepIndex === null) {
      this.logger.warn(
        `Sequence job ${job.id} missing orgId/enrollmentId/stepIndex — dropping`,
      );
      return { skipped: true };
    }
    this.logger.log(
      `Processing sequence step job ${job.id} → enrollment=${enrollmentId} step=${stepIndex}`,
    );
    try {
      const result = await this.sequences.executeStep(
        orgId,
        enrollmentId,
        stepIndex,
      );
      return result;
    } catch (err) {
      // Let BullMQ retry (attempts:3 set at enqueue) — executeStep is
      // idempotent so a retry won't double-execute a step it already advanced.
      this.logger.error(
        `Sequence step job ${job.id} (enrollment=${enrollmentId} step=${stepIndex}) failed: ${(err as Error).message}`,
      );
      throw err;
    }
  }
}
