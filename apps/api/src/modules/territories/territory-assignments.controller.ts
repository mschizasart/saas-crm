import {
  Controller,
  Get,
  Post,
  Delete,
  Body,
  Param,
  Query,
  UseGuards,
  HttpCode,
  HttpStatus,
  BadRequestException,
} from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';

import { TerritoryAssignmentsService } from './territory-assignments.service';
import { AssignEntityDto } from './territories.dto';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RbacGuard } from '../../common/guards/rbac.guard';
import { CurrentOrg } from '../../common/decorators/current-org.decorator';
import { Permissions } from '../../common/decorators/permissions.decorator';

// ─── Territory assignments controller (Wave G2) ─────────────────
//
// Two route shapes:
//   * /territories/:id/assignments — per-territory list + add/remove.
//   * /territories/lookup           — reverse lookup ("which
//                                     territories is this entity in?").
//                                     STATIC segment — declared
//                                     BEFORE `:id` everywhere so
//                                     Fastify routes it ahead.

const VALID_ENTITY_TYPES = ['client', 'lead', 'opportunity'] as const;
type EntityType = (typeof VALID_ENTITY_TYPES)[number];

@ApiTags('Territory assignments')
@Controller({ version: '1', path: 'territories' })
@UseGuards(JwtAuthGuard, RbacGuard)
@ApiBearerAuth()
export class TerritoryAssignmentsController {
  constructor(private service: TerritoryAssignmentsService) {}

  // ─── Static-segment route — declared BEFORE :id ─────────────

  @Get('lookup')
  @Permissions('territories.view')
  @ApiOperation({
    summary:
      'Reverse lookup: which territories is THIS entity in? Use ?entityType=…&entityId=…',
  })
  lookup(
    @CurrentOrg() org: any,
    @Query('entityType') entityType?: string,
    @Query('entityId') entityId?: string,
  ) {
    // Manual @Query validation because the @Query decorator alone
    // doesn't run class-validator.
    if (!entityType || !entityId) {
      throw new BadRequestException(
        'entityType and entityId are required',
      );
    }
    if (!VALID_ENTITY_TYPES.includes(entityType as EntityType)) {
      throw new BadRequestException(
        `entityType must be one of: ${VALID_ENTITY_TYPES.join(', ')}`,
      );
    }
    return this.service.getTerritoriesForEntity(
      org.id,
      entityType as EntityType,
      entityId,
    );
  }

  // ─── Per-territory routes ────────────────────────────────────

  @Get(':id/assignments')
  @Permissions('territories.view')
  @ApiOperation({
    summary:
      'List assignments in a territory, optionally filtered by entityType',
  })
  list(
    @CurrentOrg() org: any,
    @Param('id') id: string,
    @Query('entityType') entityType?: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    if (
      entityType !== undefined &&
      !VALID_ENTITY_TYPES.includes(entityType as EntityType)
    ) {
      throw new BadRequestException(
        `entityType must be one of: ${VALID_ENTITY_TYPES.join(', ')}`,
      );
    }
    return this.service.list(org.id, id, {
      entityType: entityType as EntityType | undefined,
      page: page ? Number(page) : undefined,
      limit: limit ? Number(limit) : undefined,
    });
  }

  @Post(':id/assignments')
  @Permissions('territories.configure')
  @ApiOperation({
    summary: 'Assign a Client / Lead / Opportunity to this territory',
  })
  assign(
    @CurrentOrg() org: any,
    @Param('id') id: string,
    @Body() dto: AssignEntityDto,
  ) {
    return this.service.assign(org.id, id, dto);
  }

  @Delete(':id/assignments/:assignmentId')
  @Permissions('territories.configure')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Unassign an entity from this territory' })
  unassign(
    @CurrentOrg() org: any,
    @Param('id') id: string,
    @Param('assignmentId') assignmentId: string,
  ) {
    return this.service.unassign(org.id, id, assignmentId);
  }
}
