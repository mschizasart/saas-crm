import { Module } from '@nestjs/common';
import { ValidationRulesController } from './validation-rules.controller';
import { ValidationRulesService } from './validation-rules.service';

/**
 * Salesforce-style validation rules (migration 046).
 *
 * Admins define save-time guards per entity (`fieldTo`: 'lead' | 'client',
 * extensible). When a rule's condition evaluates TRUE for a record being
 * saved, the save is BLOCKED with the rule's `errorMessage`.
 *
 * The pure evaluator lives in `condition-evaluator.ts` and is imported
 * directly by the service (no DI needed — it's stateless functions).
 *
 * ValidationRulesService is EXPORTED so LeadsService / ClientsService can call
 * `assertValid()` inside their save transactions. This module imports nothing
 * from leads/clients, so there is no circular dependency.
 *
 * PrismaService is global, so no explicit import is required here.
 */
@Module({
  controllers: [ValidationRulesController],
  providers: [ValidationRulesService],
  exports: [ValidationRulesService],
})
export class ValidationRulesModule {}
