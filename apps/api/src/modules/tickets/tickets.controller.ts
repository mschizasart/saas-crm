import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Body,
  Param,
  Query,
  Res,
  UseGuards,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import {
  TicketsService,
  CreateTicketDto,
  CreateReplyDto,
} from './tickets.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RbacGuard } from '../../common/guards/rbac.guard';
import { CurrentOrg } from '../../common/decorators/current-org.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Permissions } from '../../common/decorators/permissions.decorator';
import { buildCsv, csvFilename } from '../../common/csv/csv-writer';

@ApiTags('Tickets')
@Controller({ version: '1', path: 'tickets' })
@UseGuards(JwtAuthGuard, RbacGuard)
@ApiBearerAuth()
export class TicketsController {
  constructor(private service: TicketsService) {}

  // ─── Stats ─────────────────────────────────────────────────────────────────

  @Get('stats')
  @Permissions('tickets.view')
  @ApiOperation({ summary: 'Get ticket status and priority counts' })
  getStats(@CurrentOrg() org: any) {
    return this.service.getStats(org.id);
  }

  // ─── SLA Report ────────────────────────────────────────────────────────────

  @Get('sla-report')
  @Permissions('tickets.view')
  @ApiOperation({ summary: 'Get SLA compliance report' })
  getSlaReport(@CurrentOrg() org: any) {
    return this.service.getSlaReport(org.id);
  }

  // ─── CSV Export ────────────────────────────────────────────────────────────
  @Get('export')
  @Permissions('tickets.view')
  @ApiOperation({ summary: 'Export tickets as CSV (respects current filters)' })
  async exportCsv(
    @CurrentOrg() org: any,
    @Res() res: any,
    @Query('search') search?: string,
    @Query('status') status?: string,
    @Query('priority') priority?: string,
    @Query('assignedTo') assignedTo?: string,
    @Query('departmentId') departmentId?: string,
    @Query('clientId') clientId?: string,
  ) {
    const { rows, truncated } = await this.service.findAllForExport(org.id, {
      search,
      status,
      priority,
      assignedTo,
      departmentId,
      clientId,
    });

    const csv = buildCsv({
      columns: [
        { key: 'subject', label: 'Subject' },
        { key: 'client.company', label: 'Client' },
        { key: 'department.name', label: 'Department' },
        { key: 'status', label: 'Status' },
        { key: 'priority', label: 'Priority' },
        { key: 'service', label: 'Service' },
        { key: 'source', label: 'Source' },
        { key: 'createdAt', label: 'Created' },
        { key: 'lastReplyAt', label: 'Last Reply' },
        { key: 'closedAt', label: 'Closed' },
      ],
      rows,
    });

    const filename = csvFilename('tickets');
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.setHeader('X-Export-Count', String(rows.length));
    if (truncated) res.setHeader('X-Export-Truncated', 'true');
    res.send(csv);
  }

  // ─── Departments ───────────────────────────────────────────────────────────

  @Get('departments')
  @Permissions('tickets.view')
  @ApiOperation({ summary: 'List all ticket departments' })
  getDepartments(@CurrentOrg() org: any) {
    return this.service.getDepartments(org.id);
  }

  @Post('departments')
  @Permissions('settings.edit')
  @ApiOperation({ summary: 'Create a new ticket department' })
  createDepartment(
    @CurrentOrg() org: any,
    @Body() body: { name: string; email?: string; slaResponseHours?: number | null; slaResolutionHours?: number | null },
  ) {
    return this.service.createDepartment(org.id, body.name, body.email, body.slaResponseHours, body.slaResolutionHours);
  }

  @Patch('departments/:id')
  @Permissions('settings.edit')
  @ApiOperation({ summary: 'Update a ticket department' })
  updateDepartment(
    @CurrentOrg() org: any,
    @Param('id') id: string,
    @Body() body: { name?: string; email?: string; slaResponseHours?: number | null; slaResolutionHours?: number | null },
  ) {
    return this.service.updateDepartment(org.id, id, body);
  }

  @Delete('departments/:id')
  @Permissions('settings.edit')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Delete a ticket department' })
  deleteDepartment(@CurrentOrg() org: any, @Param('id') id: string) {
    return this.service.deleteDepartment(org.id, id);
  }

  // ─── List ──────────────────────────────────────────────────────────────────

  @Get()
  @Permissions('tickets.view')
  @ApiOperation({ summary: 'List all tickets (paginated, filterable)' })
  findAll(
    @CurrentOrg() org: any,
    @Query('search') search?: string,
    @Query('status') status?: string,
    @Query('priority') priority?: string,
    @Query('assignedTo') assignedTo?: string,
    @Query('departmentId') departmentId?: string,
    @Query('clientId') clientId?: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    return this.service.findAll(org.id, {
      search,
      status,
      priority,
      assignedTo,
      departmentId,
      clientId,
      page: page ? Number(page) : undefined,
      limit: limit ? Number(limit) : undefined,
    });
  }

  // ─── Single ────────────────────────────────────────────────────────────────

  @Get(':id')
  @Permissions('tickets.view')
  @ApiOperation({ summary: 'Get a single ticket with replies' })
  findOne(@CurrentOrg() org: any, @Param('id') id: string) {
    return this.service.findOne(org.id, id);
  }

  // ─── Create ────────────────────────────────────────────────────────────────

  @Post()
  @Permissions('tickets.create')
  @ApiOperation({ summary: 'Create a new ticket' })
  create(
    @CurrentOrg() org: any,
    @CurrentUser() user: any,
    @Body() dto: CreateTicketDto,
  ) {
    return this.service.create(org.id, dto, user.id);
  }

  // ─── Update Status ─────────────────────────────────────────────────────────

  @Patch(':id/status')
  @Permissions('tickets.edit')
  @ApiOperation({ summary: 'Update ticket status' })
  updateStatus(
    @CurrentOrg() org: any,
    @Param('id') id: string,
    @Body() body: { status: string },
  ) {
    return this.service.updateStatus(org.id, id, body.status);
  }

  // ─── Assign ────────────────────────────────────────────────────────────────

  @Patch(':id/assign')
  @Permissions('tickets.assign')
  @ApiOperation({ summary: 'Assign a ticket to a staff member' })
  assign(
    @CurrentOrg() org: any,
    @Param('id') id: string,
    @Body() body: { assignedTo: string },
  ) {
    return this.service.assign(org.id, id, body.assignedTo);
  }

  // ─── Reply ─────────────────────────────────────────────────────────────────

  @Post(':id/replies')
  @Permissions('tickets.create')
  @ApiOperation({ summary: 'Add a reply to a ticket' })
  reply(
    @CurrentOrg() org: any,
    @CurrentUser() user: any,
    @Param('id') id: string,
    @Body() dto: CreateReplyDto,
  ) {
    return this.service.reply(org.id, id, dto, user.id);
  }

  // ─── Merge ─────────────────────────────────────────────────────────────────

  @Post(':id/merge')
  @Permissions('tickets.edit')
  @ApiOperation({ summary: 'Merge another ticket into this one' })
  merge(
    @CurrentOrg() org: any,
    @Param('id') id: string,
    @Body() body: { sourceTicketId: string },
  ) {
    return this.service.merge(org.id, id, body.sourceTicketId);
  }

  // ─── Delete ────────────────────────────────────────────────────────────────

  @Delete(':id')
  @Permissions('tickets.delete')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Delete a ticket and all its replies' })
  delete(@CurrentOrg() org: any, @Param('id') id: string) {
    return this.service.delete(org.id, id);
  }
}
