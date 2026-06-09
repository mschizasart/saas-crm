import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { PrismaService } from '../../database/prisma.service';
import { FxService } from './fx.service';

/**
 * Daily ECB FX refresh (Wave F3).
 *
 * Fires at 06:00 Europe/Athens — after ECB publishes the previous
 * business day's reference rates around 16:00 CET, but before EU
 * sales reps start their day. Runs in process (no BullMQ queue —
 * the ECB feed is one small HTTP call + N small INSERTs per org,
 * and per-org failures don't fan out into retries).
 *
 * Cross-tenant: we sweep every org via `withoutTenant` (mirrors
 * DunningScheduler). Each org's refresh runs inside its own
 * `withOrganization` transaction (set inside FxService.refreshFromEcb).
 * One org's failure logs + skips — it does not abort the sweep.
 */
@Injectable()
export class FxScheduler implements OnModuleInit {
  private readonly logger = new Logger(FxScheduler.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly fx: FxService,
  ) {}

  async onModuleInit() {
    this.logger.log('FxScheduler initialised — daily refresh at 06:00 Athens');
  }

  @Cron('0 6 * * *', { timeZone: 'Europe/Athens', name: 'fx-daily-refresh' })
  async refreshAll() {
    let orgs: { id: string }[] = [];
    try {
      // Intentionally cross-tenant — same pattern as DunningScheduler.
      orgs = await this.prisma.withoutTenant(() =>
        this.prisma.organization.findMany({
          select: { id: true },
        }),
      );
    } catch (err) {
      this.logger.error(
        `Failed to load organizations for FX refresh: ${(err as Error).message}`,
      );
      return;
    }

    // Fetch the ECB feed ONCE up front — same 3KB XML is identical
    // across orgs, so N orgs should not produce N HTTP calls. If the
    // upstream fetch fails there's no point continuing the sweep.
    let pairs: Array<{ currency: string; rate: string }>;
    try {
      pairs = await this.fx.fetchEcbPairs();
    } catch (err) {
      this.logger.error(
        `FX refresh aborted — ECB fetch failed: ${(err as Error).message}`,
      );
      return;
    }

    let succeeded = 0;
    let failed = 0;
    let totalInserted = 0;
    for (const org of orgs) {
      try {
        const { inserted } = await this.fx.insertPairsForOrg(org.id, pairs);
        succeeded++;
        totalInserted += inserted;
      } catch (err) {
        // Per-org failure: log and continue. We intentionally don't
        // retry here — the next morning's run will catch any orgs we
        // missed, and the ECB feed is the rate-limited resource.
        failed++;
        this.logger.error(
          `FX refresh failed for org ${org.id}: ${(err as Error).message}`,
        );
      }
    }

    this.logger.log(
      `FX daily refresh complete: ${succeeded} orgs ok, ${failed} failed, ${totalInserted} rates inserted`,
    );
  }
}
