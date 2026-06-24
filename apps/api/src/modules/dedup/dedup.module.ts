import { Module } from '@nestjs/common';
import { DedupController } from './dedup.controller';
import { DedupService } from './dedup.service';
// JwtOrApiKeyGuard (used on the controller, matching leads/clients) is
// provided + exported by PublicApiModule.
import { PublicApiModule } from '../public-api/public-api.module';

/**
 * Duplicate detection + record merge (migration 045).
 *
 * - Detection: pg_trgm similarity() over leads / clients, scoped per-org.
 * - Merge: repoints every reference (hard FKs via Prisma, soft polymorphic
 *   refs via parameterized raw SQL) from a loser onto a winner atomically
 *   inside a single prisma.withOrganization() transaction, then soft-marks
 *   the loser and writes a MergeAudit row.
 *
 * PrismaService is global; EventEmitter2 is provided by the global
 * EventEmitterModule (used by leads.service for lead.* events). Neither
 * needs an explicit import here.
 */
@Module({
  imports: [PublicApiModule],
  controllers: [DedupController],
  providers: [DedupService],
  exports: [DedupService],
})
export class DedupModule {}
