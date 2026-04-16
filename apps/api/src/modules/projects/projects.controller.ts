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
import { ProjectsService, CreateProjectDto } from './projects.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RbacGuard } from '../../common/guards/rbac.guard';
import { CurrentOrg } from '../../common/decorators/current-org.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Permissions } from '../../common/decorators/permissions.decorator';

@ApiTags('Projects')
@Controller({ version: '1', path: 'projects' })
@UseGuards(JwtAuthGuard, RbacGuard)
@ApiBearerAuth()
export class ProjectsController {
  constructor(private service: ProjectsService) {}

  // ─── Stats ───────────────────────────────────────────────────

  @Get('stats')
  @Permissions('projects.view')
  @ApiOperation({ summary: 'Get project counts grouped by status' })
  getStats(@CurrentOrg() org: any) {
    return this.service.getStats(org.id);
  }

  // ─── CRUD ────────────────────────────────────────────────────

  @Get()
  @Permissions('projects.view')
  @ApiOperation({ summary: 'List all projects (paginated, searchable)' })
  findAll(
    @CurrentOrg() org: any,
    @Query('search') search?: string,
    @Query('status') status?: string,
    @Query('clientId') clientId?: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    return this.service.findAll(org.id, {
      search,
      status,
      clientId,
      page: page ? Number(page) : undefined,
      limit: limit ? Number(limit) : undefined,
    });
  }

  @Get(':id')
  @Permissions('projects.view')
  @ApiOperation({ summary: 'Get a single project with members and milestones' })
  findOne(@CurrentOrg() org: any, @Param('id') id: string) {
    return this.service.findOne(org.id, id);
  }

  @Post()
  @Permissions('projects.create')
  @ApiOperation({ summary: 'Create a new project' })
  create(
    @CurrentOrg() org: any,
    @CurrentUser() user: any,
    @Body() dto: CreateProjectDto,
  ) {
    return this.service.create(org.id, dto, user.id);
  }

  @Patch(':id')
  @Permissions('projects.edit')
  @ApiOperation({ summary: 'Update project details' })
  update(
    @CurrentOrg() org: any,
    @Param('id') id: string,
    @Body() dto: Partial<CreateProjectDto>,
  ) {
    return this.service.update(org.id, id, dto);
  }

  @Delete(':id')
  @Permissions('projects.delete')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Delete a project' })
  delete(@CurrentOrg() org: any, @Param('id') id: string) {
    return this.service.delete(org.id, id);
  }

  // ─── Clone ──────────────────────────────────────────────────

  @Post(':id/clone')
  @Permissions('projects.create')
  @ApiOperation({ summary: 'Clone a project with tasks, milestones, and members' })
  clone(
    @CurrentOrg() org: any,
    @CurrentUser() user: any,
    @Param('id') id: string,
  ) {
    return this.service.clone(org.id, id, user.id);
  }

  // ─── Progress ────────────────────────────────────────────────

  @Patch(':id/progress')
  @Permissions('projects.edit')
  @ApiOperation({ summary: 'Manually set project progress (0–100)' })
  updateProgress(
    @CurrentOrg() org: any,
    @Param('id') id: string,
    @Body() body: { progress: number },
  ) {
    return this.service.updateProgress(org.id, id, body.progress);
  }

  // ─── Members ─────────────────────────────────────────────────

  @Get(':id/members')
  @Permissions('projects.view')
  @ApiOperation({ summary: 'List members of a project' })
  getMembers(@CurrentOrg() org: any, @Param('id') id: string) {
    return this.service.getMembers(org.id, id);
  }

  @Post(':id/members')
  @Permissions('projects.edit')
  @ApiOperation({ summary: 'Add a member to a project' })
  addMember(
    @CurrentOrg() org: any,
    @Param('id') id: string,
    @Body() body: { userId: string; role?: string },
  ) {
    return this.service.addMember(org.id, id, body.userId, body.role);
  }

  @Delete(':id/members/:userId')
  @Permissions('projects.edit')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Remove a member from a project' })
  removeMember(
    @CurrentOrg() org: any,
    @Param('id') id: string,
    @Param('userId') userId: string,
  ) {
    return this.service.removeMember(org.id, id, userId);
  }

  // ─── Time Entries ────────────────────────────────────────────

  @Get(':id/time-entries')
  @Permissions('projects.view')
  @ApiOperation({ summary: 'List time entries for a project (paginated)' })
  getTimeEntries(
    @CurrentOrg() org: any,
    @Param('id') id: string,
    @Query('userId') userId?: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    return this.service.getTimeEntries(org.id, id, {
      userId,
      page: page ? Number(page) : undefined,
      limit: limit ? Number(limit) : undefined,
    });
  }

  @Post(':id/time')
  @Permissions('projects.edit')
  @ApiOperation({ summary: 'Log time against a project' })
  logTime(
    @CurrentOrg() org: any,
    @CurrentUser() user: any,
    @Param('id') id: string,
    @Body() dto: { taskId?: string; startTime: string; endTime?: string; duration?: number; note?: string; billable?: boolean },
  ) {
    return this.service.logTime(org.id, id, dto, user.id);
  }
}
