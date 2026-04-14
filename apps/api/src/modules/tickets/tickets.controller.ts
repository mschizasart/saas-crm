import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Body,
  Param,
  Query,
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
    @Body() body: { name: string; email?: string },
  ) {
    return this.service.createDepartment(org.id, body.name, body.email);
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

  // ─── Delete ────────────────────────────────────────────────────────────────

  @Delete(':id')
  @Permissions('tickets.delete')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Delete a ticket and all its replies' })
  delete(@CurrentOrg() org: any, @Param('id') id: string) {
    return this.service.delete(org.id, id);
  }
}
