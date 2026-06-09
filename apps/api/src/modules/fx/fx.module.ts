import { Module } from '@nestjs/common';
import { FxController } from './fx.controller';
import { FxService } from './fx.service';
import { FxScheduler } from './fx-scheduler.service';

/**
 * Multi-currency + daily FX (Wave F3).
 *
 * - FxService: getRate(), convert(), createManualRate(),
 *   listRates(), refreshFromEcb(). Decimal-based maths;
 *   triangulates via EUR when a direct pair is missing.
 * - FxScheduler: daily 06:00 Europe/Athens cron sweeping every
 *   org through refreshFromEcb(). Per-org failure isolated.
 *
 * PrismaService is provided by the global DatabaseModule.
 * FxService is exported so other modules (reports, invoices,
 * opportunities) can call `convert()` for cross-currency totals.
 */
@Module({
  controllers: [FxController],
  providers: [FxService, FxScheduler],
  exports: [FxService],
})
export class FxModule {}
