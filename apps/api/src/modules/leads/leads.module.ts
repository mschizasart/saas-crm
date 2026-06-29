import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { LeadsController } from './leads.controller';
import { LeadsService } from './leads.service';
import { LeadScoringService } from './lead-scoring.service';
import { LeadScoringProcessor } from './lead-scoring.processor';
import { LeadScoringListener } from './lead-scoring.listener';
import { RecordSharingModule } from '../record-sharing/record-sharing.module';
// Wave H3 (E3.1) — JwtOrApiKeyGuard so public-API keys can hit /leads.
import { PublicApiModule } from '../public-api/public-api.module';
// Migration 046 — save-time validation rules. Exports ValidationRulesService
// (no leads/clients dependency back → no cycle).
import { ValidationRulesModule } from '../validation-rules/validation-rules.module';

@Module({
  imports: [
    // Local registration so @InjectQueue('lead-scoring') resolves inside
    // this module (the global QueueModule already declares the queue
    // for the connection / worker host wiring).
    BullModule.registerQueue({ name: 'lead-scoring' }),
    // Wave G1 — hierarchical record sharing helper injected by
    // LeadsService.findAll() to scope by manager/report relationships.
    RecordSharingModule,
    // Wave H3 (E3.1) — JwtOrApiKeyGuard provider supply.
    PublicApiModule,
    // Migration 046 — validation rules enforcement in create/update.
    ValidationRulesModule,
  ],
  controllers: [LeadsController],
  providers: [
    LeadsService,
    LeadScoringService,
    LeadScoringProcessor,
    LeadScoringListener,
  ],
  exports: [LeadsService, LeadScoringService],
})
export class LeadsModule {}
