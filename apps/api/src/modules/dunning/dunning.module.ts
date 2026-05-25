import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { DunningController } from './dunning.controller';
import { DunningService } from './dunning.service';
import { DunningProcessor } from './dunning.processor';
import { DunningScheduler } from './dunning-scheduler.service';

/**
 * Automated dunning (overdue-invoice reminder sequences).
 *
 * - DunningScheduler: daily cron → enqueues per-org `dunning-run` jobs.
 * - DunningProcessor: BullMQ worker (concurrency 4) → runs DunningService.runForOrg.
 * - DunningService: the engine + settings/rules/logs data access.
 *
 * EmailsService is provided globally by the @Global() EmailsModule, so it is
 * injectable here without an explicit import.
 */
@Module({
  imports: [
    // Local registration so @InjectQueue('dunning') resolves inside this
    // module (the global QueueModule declares the queue for connection /
    // worker-host wiring).
    BullModule.registerQueue({ name: 'dunning' }),
  ],
  controllers: [DunningController],
  providers: [DunningService, DunningProcessor, DunningScheduler],
  exports: [DunningService],
})
export class DunningModule {}
