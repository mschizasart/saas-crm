import { Module } from '@nestjs/common';
import { TerritoriesController } from './territories.controller';
import { TerritoryMembersController } from './territory-members.controller';
import { TerritoryAssignmentsController } from './territory-assignments.controller';
import { TerritoriesService } from './territories.service';
import { TerritoryMembersService } from './territory-members.service';
import { TerritoryAssignmentsService } from './territory-assignments.service';

/**
 * Territories (Wave G2).
 *
 * Sales orgs partition their book of business by geography,
 * industry, or product line. Each tenant defines territories
 * (optionally arranged into a parent/child hierarchy), assigns
 * users as members or managers, and routes Clients / Leads /
 * Opportunities to specific territories. Per-territory rollup
 * metrics + territory-filtered reports follow.
 *
 * PrismaService is supplied by the global DatabaseModule (same as
 * AccountHierarchyModule / CpqModule / FxModule).
 */
@Module({
  controllers: [
    TerritoriesController,
    TerritoryMembersController,
    TerritoryAssignmentsController,
  ],
  providers: [
    TerritoriesService,
    TerritoryMembersService,
    TerritoryAssignmentsService,
  ],
  exports: [
    TerritoriesService,
    TerritoryMembersService,
    TerritoryAssignmentsService,
  ],
})
export class TerritoriesModule {}
