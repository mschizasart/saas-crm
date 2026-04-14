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
import { LeadsService, CreateLeadDto } from './leads.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RbacGuard } from '../../common/guards/rbac.guard';
import { CurrentOrg } from '../../common/decorators/current-org.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Permissions } from '../../common/decorators/permissions.decorator';

@ApiTags('Leads')
@Controller({ version: '1', path: 'leads' })
@UseGuards(JwtAuthGuard, RbacGuard)
@ApiBearerAuth()
export class LeadsController {
  constructor(private service: LeadsService) {}

  // ─── Kanban ─────────────────────────────────────────────────

  @Get('kanban')
  @Permissions('leads.view')
  @ApiOperation({ summary: 'Get leads grouped by status for kanban board' })
  getKanbanBoard(@CurrentOrg() org: any) {
    return this.service.getKanbanBoard(org.id);
  }

  // ─── CRUD ────────────────────────────────────────────────────

  @Get()
  @Permissions('leads.view')
  @ApiOperation({ summary: 'List all leads (paginated, searchable)' })
  findAll(
    @CurrentOrg() org: any,
    @Query('search') search?: string,
    @Query('status') status?: string,
    @Query('assignedToId') assignedToId?: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    return this.service.findAll(org.id, {
      search,
      status,
      assignedToId,
      page: page ? Number(page) : undefined,
      limit: limit ? Number(limit) : undefined,
    });
  }

  @Get(':id')
  @Permissions('leads.view')
  @ApiOperation({ summary: 'Get a single lead with notes and custom fields' })
  findOne(@CurrentOrg() org: any, @Param('id') id: string) {
    return this.service.findOne(org.id, id);
  }

  @Post()
  @Permissions('leads.create')
  @ApiOperation({ summary: 'Create a new lead' })
  create(
    @CurrentOrg() org: any,
    @CurrentUser() user: any,
    @Body() dto: CreateLeadDto,
  ) {
    return this.service.create(org.id, dto, user.id);
  }

  @Patch(':id')
  @Permissions('leads.edit')
  @ApiOperation({ summary: 'Update lead details' })
  update(
    @CurrentOrg() org: any,
    @Param('id') id: string,
    @Body() dto: Partial<CreateLeadDto>,
  ) {
    return this.service.update(org.id, id, dto);
  }

  @Delete(':id')
  @Permissions('leads.delete')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Delete a lead' })
  delete(@CurrentOrg() org: any, @Param('id') id: string) {
    return this.service.delete(org.id, id);
  }

  // ─── Status ──────────────────────────────────────────────────

  @Patch(':id/status')
  @Permissions('leads.edit')
  @ApiOperation({ summary: 'Update the status of a lead' })
  updateStatus(
    @CurrentOrg() org: any,
    @Param('id') id: string,
    @Body() body: { status: string },
  ) {
    return this.service.updateStatus(org.id, id, body.status);
  }

  // ─── Convert ─────────────────────────────────────────────────

  @Post(':id/convert')
  @Permissions('leads.edit')
  @ApiOperation({ summary: 'Convert a lead to a client' })
  convertToClient(
    @CurrentOrg() org: any,
    @CurrentUser() user: any,
    @Param('id') id: string,
  ) {
    return this.service.convertToClient(org.id, id, user.id);
  }

  // ─── Notes ───────────────────────────────────────────────────

  @Post(':id/notes')
  @Permissions('leads.edit')
  @ApiOperation({ summary: 'Add a note to a lead' })
  addNote(
    @CurrentOrg() org: any,
    @CurrentUser() user: any,
    @Param('id') id: string,
    @Body() body: { note: string },
  ) {
    return this.service.addNote(org.id, id, body.note, user.id);
  }
}
