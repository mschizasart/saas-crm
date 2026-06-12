import {
  Controller,
  Get,
  Post,
  Put,
  Delete,
  Body,
  Param,
  Query,
  UseGuards,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';

import { OpportunitiesService } from './opportunities.service';
import {
  CreateOpportunityDto,
  UpdateOpportunityDto,
  MoveStageDto,
} from './opportunities.dto';
// Wave H3 (E3.1 follow-up) — accept BOTH in-app JWTs and public-API
// `crm_*` bearers. The guard delegates to JwtAuthGuard for any
// non-`crm_` Authorization header so existing JWT auth is unchanged.
import { JwtOrApiKeyGuard } from '../auth/jwt-or-api-key.guard';
import { RbacGuard } from '../../common/guards/rbac.guard';
import { CurrentOrg } from '../../common/decorators/current-org.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Permissions } from '../../common/decorators/permissions.decorator';

@ApiTags('Opportunities')
@Controller({ version: '1', path: 'opportunities' })
@UseGuards(JwtOrApiKeyGuard, RbacGuard)
@ApiBearerAuth()
export class OpportunitiesController {
  constructor(private service: OpportunitiesService) {}

  // ─── Kanban (declared BEFORE /:id so it's not shadowed) ─────

  @Get('kanban')
  @Permissions('opportunities.view')
  @ApiOperation({ summary: 'Kanban board: stages with their opportunities' })
  kanban(@CurrentOrg() org: any, @CurrentUser() user: any) {
    return this.service.kanban(org.id, user);
  }

  // ─── CRUD ────────────────────────────────────────────────────

  @Get()
  @Permissions('opportunities.view')
  @ApiOperation({ summary: 'List opportunities (paginated, filterable)' })
  list(
    @CurrentOrg() org: any,
    @CurrentUser() user: any,
    @Query('search') search?: string,
    @Query('stageId') stageId?: string,
    @Query('ownerId') ownerId?: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    return this.service.list(
      org.id,
      {
        search,
        stageId,
        ownerId,
        page: page ? Number(page) : undefined,
        limit: limit ? Number(limit) : undefined,
      },
      user,
    );
  }

  @Post()
  @Permissions('opportunities.create')
  @ApiOperation({ summary: 'Create a new opportunity' })
  create(
    @CurrentOrg() org: any,
    @CurrentUser() user: any,
    @Body() dto: CreateOpportunityDto,
  ) {
    return this.service.create(org.id, user.id, dto);
  }

  @Get(':id')
  @Permissions('opportunities.view')
  @ApiOperation({ summary: 'Fetch a single opportunity with stage history' })
  findOne(@CurrentOrg() org: any, @Param('id') id: string) {
    return this.service.findOne(org.id, id);
  }

  @Put(':id')
  @Permissions('opportunities.edit')
  @ApiOperation({ summary: 'Update an opportunity (use /move-stage to change stage)' })
  update(
    @CurrentOrg() org: any,
    @Param('id') id: string,
    @Body() dto: UpdateOpportunityDto,
  ) {
    return this.service.update(org.id, id, dto);
  }

  @Delete(':id')
  @Permissions('opportunities.delete')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Delete an opportunity' })
  remove(@CurrentOrg() org: any, @Param('id') id: string) {
    return this.service.remove(org.id, id);
  }

  @Post(':id/move-stage')
  @Permissions('opportunities.edit')
  @ApiOperation({ summary: 'Move an opportunity to a new stage (audited)' })
  moveStage(
    @CurrentOrg() org: any,
    @CurrentUser() user: any,
    @Param('id') id: string,
    @Body() dto: MoveStageDto,
  ) {
    return this.service.moveStage(org.id, user.id, id, dto.stageId);
  }
}
