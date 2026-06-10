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

import { TerritoriesService } from './territories.service';
import {
  CreateTerritoryDto,
  UpdateTerritoryDto,
} from './territories.dto';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RbacGuard } from '../../common/guards/rbac.guard';
import { CurrentOrg } from '../../common/decorators/current-org.decorator';
import { Permissions } from '../../common/decorators/permissions.decorator';

// ─── Territories controller (Wave G2) ───────────────────────────
//
// Static segments (`hierarchy`) are declared BEFORE parameterized
// ones (`:id`) so Fastify routes them ahead — otherwise
// `GET /territories/hierarchy` would resolve to `:id` and 404.

@ApiTags('Territories')
@Controller({ version: '1', path: 'territories' })
@UseGuards(JwtAuthGuard, RbacGuard)
@ApiBearerAuth()
export class TerritoriesController {
  constructor(private service: TerritoriesService) {}

  // ─── Static-segment routes (must come first) ────────────────

  @Get('hierarchy')
  @Permissions('territories.view')
  @ApiOperation({
    summary:
      'Walk the territory tree DOWN — optionally rooted at ?rootId=…',
  })
  hierarchy(@CurrentOrg() org: any, @Query('rootId') rootId?: string) {
    return this.service.getHierarchy(org.id, rootId);
  }

  // ─── CRUD ────────────────────────────────────────────────────

  @Get()
  @Permissions('territories.view')
  @ApiOperation({ summary: 'List territories (paginated)' })
  list(
    @CurrentOrg() org: any,
    @Query('search') search?: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    return this.service.list(org.id, {
      search,
      page: page ? Number(page) : undefined,
      limit: limit ? Number(limit) : undefined,
    });
  }

  @Post()
  @Permissions('territories.configure')
  @ApiOperation({ summary: 'Create a territory' })
  create(@CurrentOrg() org: any, @Body() dto: CreateTerritoryDto) {
    return this.service.create(org.id, dto);
  }

  @Get(':id')
  @Permissions('territories.view')
  @ApiOperation({ summary: 'Fetch a single territory with members + counts' })
  findOne(@CurrentOrg() org: any, @Param('id') id: string) {
    return this.service.findOne(org.id, id);
  }

  @Put(':id')
  @Permissions('territories.configure')
  @ApiOperation({ summary: 'Update a territory' })
  update(
    @CurrentOrg() org: any,
    @Param('id') id: string,
    @Body() dto: UpdateTerritoryDto,
  ) {
    return this.service.update(org.id, id, dto);
  }

  @Delete(':id')
  @Permissions('territories.configure')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({
    summary:
      'Delete a territory. Refuses if it has children or assignments.',
  })
  remove(@CurrentOrg() org: any, @Param('id') id: string) {
    return this.service.remove(org.id, id);
  }

  @Get(':id/ancestors')
  @Permissions('territories.view')
  @ApiOperation({ summary: 'Get the ancestor chain (oldest-first)' })
  ancestors(@CurrentOrg() org: any, @Param('id') id: string) {
    return this.service.getAncestors(org.id, id);
  }
}
