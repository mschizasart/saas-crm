import { Module } from '@nestjs/common';
import { OpportunitiesController } from './opportunities.controller';
import { PipelinesController } from './pipelines.controller';
import { ForecastsController } from './forecasts.controller';
import { OpportunitiesService } from './opportunities.service';
import { PipelinesService } from './pipelines.service';
import { ForecastsService } from './forecasts.service';

/**
 * Opportunities / deal pipeline / weighted forecast (Wave D1).
 *
 * - OpportunitiesService: CRUD + stage transitions (always wrapped in
 *   a single transaction with a matching `opportunity_stage_history`
 *   insert so the audit log can never drift from the deal state).
 * - PipelinesService: stages CRUD + reorder. Stage deletes are refused
 *   while any opportunity references the stage.
 * - ForecastsService: weighted forecast by period and by owner, summed
 *   in JS because Postgres `Decimal` comes back as a `Prisma.Decimal`.
 *
 * PrismaService is supplied by the global DatabaseModule (no explicit
 * import needed — same pattern as DunningModule / CampaignsModule).
 */
@Module({
  controllers: [
    OpportunitiesController,
    PipelinesController,
    ForecastsController,
  ],
  providers: [OpportunitiesService, PipelinesService, ForecastsService],
  exports: [OpportunitiesService, PipelinesService, ForecastsService],
})
export class OpportunitiesModule {}
