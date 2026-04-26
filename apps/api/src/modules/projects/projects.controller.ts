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
  ProjectsService,
  CreateProjectDto,
  CreateMilestoneDto,
  CreateDiscussionDto,
  CreateDiscussionCommentDto,
  CreateProjectFileDto,
  CreateProjectNoteDto,
} from './projects.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RbacGuard } from '../../common/guards/rbac.guard';
import { CurrentOrg } from '../../common/decorators/current-org.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Permissions } from '../../common/decorators/permissions.decorator';
import { buildCsv, csvFilename } from '../../common/csv/csv-writer';

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

  // ─── CSV Export ──────────────────────────────────────────────
  @Get('export')
  @Permissions('projects.view')
  @ApiOperation({ summary: 'Export projects as CSV (respects current filters)' })
  async exportCsv(
    @CurrentOrg() org: any,
    @Res() res: any,
    @Query('search') search?: string,
    @Query('status') status?: string,
    @Query('clientId') clientId?: string,
  ) {
    const { rows, truncated } = await this.service.findAllForExport(org.id, {
      search,
      status,
      clientId,
    });

    const csv = buildCsv({
      columns: [
        { key: 'name', label: 'Name' },
        { key: 'client.company', label: 'Client' },
        { key: 'status', label: 'Status' },
        { key: 'progress', label: 'Progress %' },
        { key: 'billingType', label: 'Billing' },
        { key: 'fixedRate', label: 'Fixed Rate' },
        { key: 'hourlyRate', label: 'Hourly Rate' },
        { key: 'startDate', label: 'Start Date' },
        { key: 'deadline', label: 'Deadline' },
        { key: 'estimatedHours', label: 'Est. Hours' },
        { key: 'createdAt', label: 'Created' },
      ],
      rows,
    });

    const filename = csvFilename('projects');
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.setHeader('X-Export-Count', String(rows.length));
    if (truncated) res.setHeader('X-Export-Truncated', 'true');
    res.send(csv);
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

  // ─── Milestones ─────────────────────────────────────────────

  @Get(':id/milestones')
  @Permissions('projects.view')
  @ApiOperation({ summary: 'List milestones for a project (with tasks)' })
  getMilestones(@CurrentOrg() org: any, @Param('id') id: string) {
    return this.service.getMilestones(org.id, id);
  }

  @Post(':id/milestones')
  @Permissions('projects.edit')
  @ApiOperation({ summary: 'Create a milestone in a project' })
  createMilestone(
    @CurrentOrg() org: any,
    @Param('id') id: string,
    @Body() dto: CreateMilestoneDto,
  ) {
    return this.service.createMilestone(org.id, id, dto);
  }

  @Patch(':projectId/milestones/:milestoneId')
  @Permissions('projects.edit')
  @ApiOperation({ summary: 'Update a milestone' })
  updateMilestone(
    @CurrentOrg() org: any,
    @Param('projectId') projectId: string,
    @Param('milestoneId') milestoneId: string,
    @Body() dto: Partial<CreateMilestoneDto> & { completed?: boolean },
  ) {
    return this.service.updateMilestone(org.id, projectId, milestoneId, dto);
  }

  @Delete(':projectId/milestones/:milestoneId')
  @Permissions('projects.edit')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Delete a milestone' })
  deleteMilestone(
    @CurrentOrg() org: any,
    @Param('projectId') projectId: string,
    @Param('milestoneId') milestoneId: string,
  ) {
    return this.service.deleteMilestone(org.id, projectId, milestoneId);
  }

  // ─── Project Files ──────────────────────────────────────────

  @Get(':id/files')
  @Permissions('projects.view')
  @ApiOperation({ summary: 'List files attached to a project' })
  getFiles(@CurrentOrg() org: any, @Param('id') id: string) {
    return this.service.getFiles(org.id, id);
  }

  @Post(':id/files')
  @Permissions('projects.edit')
  @ApiOperation({ summary: 'Register a file record for a project' })
  createFile(
    @CurrentOrg() org: any,
    @CurrentUser() user: any,
    @Param('id') id: string,
    @Body() dto: CreateProjectFileDto,
  ) {
    return this.service.createFile(org.id, id, dto, user.id);
  }

  @Delete(':projectId/files/:fileId')
  @Permissions('projects.edit')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Delete a project file record' })
  deleteFile(
    @CurrentOrg() org: any,
    @Param('projectId') projectId: string,
    @Param('fileId') fileId: string,
  ) {
    return this.service.deleteFile(org.id, projectId, fileId);
  }

  // ─── Discussions ────────────────────────────────────────────

  @Get(':id/discussions')
  @Permissions('projects.view')
  @ApiOperation({ summary: 'List discussion threads for a project' })
  getDiscussions(@CurrentOrg() org: any, @Param('id') id: string) {
    return this.service.getDiscussions(org.id, id);
  }

  @Post(':id/discussions')
  @Permissions('projects.edit')
  @ApiOperation({ summary: 'Create a new discussion thread' })
  createDiscussion(
    @CurrentOrg() org: any,
    @CurrentUser() user: any,
    @Param('id') id: string,
    @Body() dto: CreateDiscussionDto,
  ) {
    return this.service.createDiscussion(org.id, id, dto, user.id);
  }

  @Get(':id/discussions/:discussionId')
  @Permissions('projects.view')
  @ApiOperation({ summary: 'Get a discussion with all comments' })
  getDiscussion(
    @CurrentOrg() org: any,
    @Param('id') id: string,
    @Param('discussionId') discussionId: string,
  ) {
    return this.service.getDiscussion(org.id, id, discussionId);
  }

  @Post(':id/discussions/:discussionId/comments')
  @Permissions('projects.edit')
  @ApiOperation({ summary: 'Add a comment to a discussion' })
  addDiscussionComment(
    @CurrentOrg() org: any,
    @CurrentUser() user: any,
    @Param('id') id: string,
    @Param('discussionId') discussionId: string,
    @Body() dto: CreateDiscussionCommentDto,
  ) {
    return this.service.addDiscussionComment(org.id, id, discussionId, dto, user.id);
  }

  // ─── Notes ──────────────────────────────────────────────────

  @Get(':id/notes')
  @Permissions('projects.view')
  @ApiOperation({ summary: 'List notes for a project' })
  getNotes(@CurrentOrg() org: any, @Param('id') id: string) {
    return this.service.getNotes(org.id, id);
  }

  @Post(':id/notes')
  @Permissions('projects.edit')
  @ApiOperation({ summary: 'Add a note to a project' })
  createNote(
    @CurrentOrg() org: any,
    @CurrentUser() user: any,
    @Param('id') id: string,
    @Body() dto: CreateProjectNoteDto,
  ) {
    return this.service.createNote(org.id, id, dto, user.id);
  }

  @Delete(':projectId/notes/:noteId')
  @Permissions('projects.edit')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Delete a note (author or admin)' })
  deleteNote(
    @CurrentOrg() org: any,
    @CurrentUser() user: any,
    @Param('projectId') projectId: string,
    @Param('noteId') noteId: string,
  ) {
    return this.service.deleteNote(org.id, projectId, noteId, user.id);
  }
}
