/**
 * HTTP surface for saved report definitions (Wave D2 builder).
 *
 * Mounted at `/report-defs` (not `/reports`) to avoid colliding with
 * the existing canned ReportsController which owns `/reports/sales`,
 * `/reports/leads`, `/reports/clients`, etc.
 *
 * Permissions:
 *   - reports.view   → GET endpoints + POST :id/run
 *   - reports.create → POST /
 *   - reports.edit   → PUT  /:id
 *   - reports.delete → DELETE /:id
 */
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
import { ReportDefsService } from './report-defs.service';
import { CreateReportDto, UpdateReportDto } from './reports.dto';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RbacGuard } from '../../common/guards/rbac.guard';
import { CurrentOrg } from '../../common/decorators/current-org.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Permissions } from '../../common/decorators/permissions.decorator';

@ApiTags('Report Definitions (Builder)')
@ApiBearerAuth()
@Controller({ version: '1', path: 'report-defs' })
@UseGuards(JwtAuthGuard, RbacGuard)
export class ReportDefsController {
  constructor(private service: ReportDefsService) {}

  // ─── Metadata for the builder UI ──────────────────────────────────
  // NB: registered BEFORE :id so the static path wins route matching.
  @Get('entities')
  @Permissions('reports.view')
  @ApiOperation({
    summary:
      'List the whitelisted entities + fields the report builder can target',
  })
  entities() {
    return this.service.entities();
  }

  // ─── CRUD ─────────────────────────────────────────────────────────

  @Get()
  @Permissions('reports.view')
  @ApiOperation({ summary: 'List saved report definitions' })
  list(
    @CurrentOrg() org: any,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    return this.service.list(org.id, {
      page: page ? Number(page) : undefined,
      limit: limit ? Number(limit) : undefined,
    });
  }

  @Post()
  @Permissions('reports.create')
  @ApiOperation({ summary: 'Create a saved report definition' })
  create(
    @CurrentOrg() org: any,
    @CurrentUser() user: any,
    @Body() dto: CreateReportDto,
  ) {
    return this.service.create(org.id, user?.id ?? null, dto);
  }

  @Get(':id')
  @Permissions('reports.view')
  @ApiOperation({ summary: 'Get a saved report definition' })
  findOne(@CurrentOrg() org: any, @Param('id') id: string) {
    return this.service.findOne(org.id, id);
  }

  @Put(':id')
  @Permissions('reports.edit')
  @ApiOperation({ summary: 'Update a saved report definition' })
  update(
    @CurrentOrg() org: any,
    @Param('id') id: string,
    @Body() dto: UpdateReportDto,
  ) {
    return this.service.update(org.id, id, dto);
  }

  @Delete(':id')
  @Permissions('reports.delete')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Delete a saved report definition' })
  remove(@CurrentOrg() org: any, @Param('id') id: string) {
    return this.service.remove(org.id, id);
  }

  // ─── Execution ────────────────────────────────────────────────────

  @Post(':id/run')
  @Permissions('reports.view')
  @ApiOperation({ summary: 'Execute a saved report and return its data' })
  run(@CurrentOrg() org: any, @Param('id') id: string) {
    return this.service.run(org.id, id);
  }
}
