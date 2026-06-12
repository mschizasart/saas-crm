import { Module } from '@nestjs/common';
import { BulkController } from './bulk.controller';
import { BulkService } from './bulk.service';
import { CsvImportService } from './csv-import.service';
import { ClientsModule } from '../clients/clients.module';
import { LeadsModule } from '../leads/leads.module';
import { OpportunitiesModule } from '../opportunities/opportunities.module';
import { TasksModule } from '../tasks/tasks.module';
import { PublicApiModule } from '../public-api/public-api.module';

/**
 * Wave H3 — Bulk API + CSV import.
 *
 * Imports the four entity modules so BulkService can inject their
 * services directly — keeps all per-entity invariants (tenant
 * scoping, cross-tenant FK validation, audit-log emission) intact
 * because every bulk row goes through the entity service's normal
 * `create / update / delete` paths.
 *
 * `PublicApiModule` is imported for `JwtOrApiKeyGuard` — the
 * BulkController opts in so callers can hit `/bulk/*` with either
 * an in-app JWT or a `crm_*` public-API bearer token.
 *
 * PrismaService is supplied by the global DatabaseModule (no
 * explicit import needed — same pattern as DunningModule).
 */
@Module({
  imports: [
    ClientsModule,
    LeadsModule,
    OpportunitiesModule,
    TasksModule,
    PublicApiModule,
  ],
  controllers: [BulkController],
  providers: [BulkService, CsvImportService],
  exports: [BulkService, CsvImportService],
})
export class BulkApiModule {}
