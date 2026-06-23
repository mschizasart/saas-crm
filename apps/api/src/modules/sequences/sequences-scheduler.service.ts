import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { PrismaService } from '../../database/prisma.service';

/**
 * Every 5 minutes, scan ACROSS ALL ORGS for sequence enrollments that are due
 * (status='active' AND nextStepAt <= now) and enqueue one BullMQ job per due
 * enrollment on the 'sequences' queue to execute its current step.
 *
 * Cross-tenant scan: uses `prisma.withoutTenant` to make the no-RLS intent
 * explicit (same pattern as DunningScheduler). The per-step execution inside
 * SequencesService.executeStep re-scopes each run via withOrganization.
 *
 * Stable jobId (`seq:<enrollmentId>:step:<stepIndex>`) de-dupes: a step that
 * is still queued/running from a previous scan is ignored until it
 * completes/expires. executeStep is also idempotent on a stale stepIndex.
 */
@Injectable()
export class SequencesScheduler implements OnModuleInit {
  private readonly logger = new Logger(SequencesScheduler.name);

  constructor(
    private readonly prisma: PrismaService,
    @InjectQueue('sequences') private readonly queue: Queue,
  ) {}

  async onModuleInit() {
    this.logger.log('SequencesScheduler initialised');
  }

  @Cron('*/5 * * * *')
  async scanDue() {
    let due: Array<{
      id: string;
      organizationId: string;
      currentStepIndex: number;
    }> = [];
    try {
      // Intentionally cross-tenant: sweep EVERY org's due enrollments.
      due = await this.prisma.withoutTenant(() =>
        this.prisma.sequenceEnrollment.findMany({
          // FIX 2(b): also exclude enrollments whose parent sequence isn't
          // active (paused/archived), so we don't enqueue pointless jobs that
          // executeStep would just skip via its sequence_not_active guard.
          where: {
            status: 'active',
            nextStepAt: { lte: new Date() },
            sequence: { status: 'active' },
          },
          select: { id: true, organizationId: true, currentStepIndex: true },
        }),
      );
    } catch (err) {
      this.logger.error(
        `Failed to scan due sequence enrollments: ${(err as Error).message}`,
      );
      return;
    }

    let enqueued = 0;
    for (const e of due) {
      try {
        await this.queue.add(
          'execute-step',
          {
            orgId: e.organizationId,
            enrollmentId: e.id,
            stepIndex: e.currentStepIndex,
          },
          {
            jobId: `seq:${e.id}:step:${e.currentStepIndex}`,
            attempts: 3,
            backoff: { type: 'exponential', delay: 5000 },
            removeOnComplete: 100,
            removeOnFail: 500,
          },
        );
        enqueued++;
      } catch (err) {
        this.logger.error(
          `Failed to enqueue sequence step for enrollment ${e.id}: ${(err as Error).message}`,
        );
      }
    }
    if (enqueued > 0) {
      this.logger.log(`Enqueued ${enqueued} sequence step job(s)`);
    }
  }
}
