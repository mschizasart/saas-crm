import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { SequencesController } from './sequences.controller';
import { SequencesService } from './sequences.service';
import { SequencesProcessor } from './sequences.processor';
import { SequencesScheduler } from './sequences-scheduler.service';

/**
 * Sequences / cadences (migration 043) — multi-step automated follow-up flows.
 *
 * - SequencesScheduler: 5-min cron → cross-org scan for due enrollments,
 *   enqueues one per-step job each.
 * - SequencesProcessor: BullMQ worker (concurrency 10) → executes one step
 *   per enrollment via SequencesService.executeStep, then advances it.
 * - SequencesService: the engine + CRUD/steps/enrollment data access.
 *
 * EmailsService is provided globally by the @Global() EmailsModule, so it is
 * injectable here without an explicit import.
 *
 * Registers the 'sequences' queue locally so @InjectQueue('sequences')
 * resolves here; the queue connection itself is owned by the global QueueModule.
 */
@Module({
  imports: [BullModule.registerQueue({ name: 'sequences' })],
  controllers: [SequencesController],
  providers: [SequencesService, SequencesProcessor, SequencesScheduler],
  exports: [SequencesService],
})
export class SequencesModule {}
