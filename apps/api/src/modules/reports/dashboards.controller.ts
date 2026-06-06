/**
 * HTTP surface for dashboards (Wave D2).
 *
 * GET /dashboards/:id returns the dashboard + EVERY widget's executed
 * report data (`findOneWithData`). Each widget runs through the same
 * hardened report engine as a standalone report; widget reports execute
 * in parallel via `Promise.all`.
 *
 * Permissions:
 *   - reports.view → all GET endpoints
 *   - reports.edit → all POST / PUT / DELETE endpoints (dashboards are
 *     edit-only — no separate "dashboards.*" permission family yet).
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
import { DashboardsService } from './dashboards.service';
import {
  CreateDashboardDto,
  UpdateDashboardDto,
  CreateWidgetDto,
  UpdateWidgetDto,
} from './reports.dto';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RbacGuard } from '../../common/guards/rbac.guard';
import { CurrentOrg } from '../../common/decorators/current-org.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Permissions } from '../../common/decorators/permissions.decorator';

@ApiTags('Dashboards')
@ApiBearerAuth()
@Controller({ version: '1', path: 'dashboards' })
@UseGuards(JwtAuthGuard, RbacGuard)
export class DashboardsController {
  constructor(private service: DashboardsService) {}

  @Get()
  @Permissions('reports.view')
  @ApiOperation({ summary: 'List dashboards' })
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
  @Permissions('reports.edit')
  @ApiOperation({ summary: 'Create a dashboard' })
  create(
    @CurrentOrg() org: any,
    @CurrentUser() user: any,
    @Body() dto: CreateDashboardDto,
  ) {
    return this.service.create(org.id, user?.id ?? null, dto);
  }

  @Get(':id')
  @Permissions('reports.view')
  @ApiOperation({
    summary:
      'Get a dashboard + all widget data (parallel report execution)',
  })
  findOne(@CurrentOrg() org: any, @Param('id') id: string) {
    return this.service.findOneWithData(org.id, id);
  }

  @Put(':id')
  @Permissions('reports.edit')
  @ApiOperation({ summary: 'Update a dashboard' })
  update(
    @CurrentOrg() org: any,
    @Param('id') id: string,
    @Body() dto: UpdateDashboardDto,
  ) {
    return this.service.update(org.id, id, dto);
  }

  @Delete(':id')
  @Permissions('reports.edit')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Delete a dashboard' })
  remove(@CurrentOrg() org: any, @Param('id') id: string) {
    return this.service.remove(org.id, id);
  }

  // ─── Widgets ──────────────────────────────────────────────────────

  @Post(':id/widgets')
  @Permissions('reports.edit')
  @ApiOperation({ summary: 'Add a widget (report) to a dashboard' })
  addWidget(
    @CurrentOrg() org: any,
    @Param('id') id: string,
    @Body() dto: CreateWidgetDto,
  ) {
    return this.service.addWidget(org.id, id, dto);
  }

  @Put(':id/widgets/:widgetId')
  @Permissions('reports.edit')
  @ApiOperation({ summary: 'Update widget position/title' })
  updateWidget(
    @CurrentOrg() org: any,
    @Param('id') id: string,
    @Param('widgetId') widgetId: string,
    @Body() dto: UpdateWidgetDto,
  ) {
    return this.service.updateWidget(org.id, id, widgetId, dto);
  }

  @Delete(':id/widgets/:widgetId')
  @Permissions('reports.edit')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Remove a widget from a dashboard' })
  removeWidget(
    @CurrentOrg() org: any,
    @Param('id') id: string,
    @Param('widgetId') widgetId: string,
  ) {
    return this.service.removeWidget(org.id, id, widgetId);
  }
}
