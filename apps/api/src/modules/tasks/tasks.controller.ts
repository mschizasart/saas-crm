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
import { TasksService, CreateTaskDto } from './tasks.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { CurrentOrg } from '../../common/decorators/current-org.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { buildCsv, csvFilename } from '../../common/csv/csv-writer';

@ApiTags('Tasks')
@Controller({ version: '1', path: 'tasks' })
@UseGuards(JwtAuthGuard)
@ApiBearerAuth()
export class TasksController {
  constructor(private service: TasksService) {}

  @Get('my')
  @ApiOperation({ summary: 'Tasks assigned to the current user' })
  getMy(@CurrentOrg() org: any, @CurrentUser() user: any) {
    return this.service.getMyTasks(org.id, user.id);
  }

  // ─── CSV Export ────────────────────────────────────────────
  @Get('export')
  @ApiOperation({ summary: 'Export tasks as CSV (respects current filters)' })
  async exportCsv(
    @CurrentOrg() org: any,
    @Res() res: any,
    @Query('search') search?: string,
    @Query('status') status?: string,
    @Query('assignedToId') assignedToId?: string,
    @Query('projectId') projectId?: string,
    @Query('dueBefore') dueBefore?: string,
  ) {
    const { rows, truncated } = await this.service.findAllForExport(org.id, {
      search,
      status,
      assignedToId,
      projectId,
      dueBefore,
    });

    const csv = buildCsv({
      columns: [
        { key: 'name', label: 'Name' },
        { key: 'project.name', label: 'Project' },
        { key: 'status', label: 'Status' },
        { key: 'priority', label: 'Priority' },
        {
          key: 'assignments',
          label: 'Assignees',
          format: (value: any) =>
            Array.isArray(value)
              ? value
                  .map((a: any) =>
                    a?.user
                      ? `${a.user.firstName ?? ''} ${a.user.lastName ?? ''}`.trim() ||
                        (a.user.email ?? '')
                      : '',
                  )
                  .filter(Boolean)
                  .join('; ')
              : '',
        },
        { key: 'startDate', label: 'Start Date' },
        { key: 'dueDate', label: 'Due Date' },
        { key: 'estimatedHours', label: 'Est. Hours' },
        { key: 'description', label: 'Description' },
        { key: 'createdAt', label: 'Created' },
      ],
      rows,
    });

    const filename = csvFilename('tasks');
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.setHeader('X-Export-Count', String(rows.length));
    if (truncated) res.setHeader('X-Export-Truncated', 'true');
    res.send(csv);
  }

  @Get()
  @ApiOperation({ summary: 'List tasks (paginated, filterable)' })
  findAll(
    @CurrentOrg() org: any,
    @Query('search') search?: string,
    @Query('status') status?: string,
    @Query('assignedToId') assignedToId?: string,
    @Query('projectId') projectId?: string,
    @Query('dueBefore') dueBefore?: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    return this.service.findAll(org.id, {
      search,
      status,
      assignedToId,
      projectId,
      dueBefore,
      page: page ? Number(page) : undefined,
      limit: limit ? Number(limit) : undefined,
    });
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get a single task' })
  findOne(@CurrentOrg() org: any, @Param('id') id: string) {
    return this.service.findOne(org.id, id);
  }

  @Post()
  @ApiOperation({ summary: 'Create a new task' })
  create(
    @CurrentOrg() org: any,
    @CurrentUser() user: any,
    @Body() dto: CreateTaskDto,
  ) {
    return this.service.create(org.id, dto, user.id);
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Update a task' })
  update(
    @CurrentOrg() org: any,
    @Param('id') id: string,
    @Body() dto: Partial<CreateTaskDto>,
  ) {
    return this.service.update(org.id, id, dto);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Delete a task' })
  delete(@CurrentOrg() org: any, @Param('id') id: string) {
    return this.service.delete(org.id, id);
  }

  @Post(':id/assign')
  @ApiOperation({ summary: 'Assign task to a user' })
  assign(
    @CurrentOrg() org: any,
    @Param('id') id: string,
    @Body() body: { userId: string },
  ) {
    return this.service.assign(org.id, id, body.userId);
  }

  @Post(':id/checklist')
  @ApiOperation({ summary: 'Add a checklist item' })
  addChecklist(
    @CurrentOrg() org: any,
    @Param('id') id: string,
    @Body() body: { text: string },
  ) {
    return this.service.addChecklistItem(org.id, id, body.text);
  }

  @Patch('checklist/:itemId/toggle')
  @ApiOperation({ summary: 'Toggle a checklist item' })
  toggleChecklist(
    @CurrentOrg() org: any,
    @Param('itemId') itemId: string,
  ) {
    return this.service.toggleChecklistItem(org.id, itemId);
  }

  @Post(':id/comments')
  @ApiOperation({ summary: 'Add a comment to a task' })
  addComment(
    @CurrentOrg() org: any,
    @CurrentUser() user: any,
    @Param('id') id: string,
    @Body() body: { content: string },
  ) {
    return this.service.addComment(org.id, id, body.content, user.id);
  }

  // ─── Task Dependencies ──────────────────────────────────────────────────────

  @Get(':id/dependencies')
  @ApiOperation({ summary: 'List dependencies for a task' })
  getDependencies(
    @CurrentOrg() org: any,
    @Param('id') id: string,
  ) {
    return this.service.getDependencies(org.id, id);
  }

  @Post(':id/dependencies')
  @ApiOperation({ summary: 'Add a dependency to a task' })
  addDependency(
    @CurrentOrg() org: any,
    @Param('id') id: string,
    @Body() body: { dependsOnId: string },
  ) {
    return this.service.addDependency(org.id, id, body.dependsOnId);
  }

  @Delete(':id/dependencies/:dependsOnId')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Remove a dependency from a task' })
  removeDependency(
    @CurrentOrg() org: any,
    @Param('id') id: string,
    @Param('dependsOnId') dependsOnId: string,
  ) {
    return this.service.removeDependency(org.id, id, dependsOnId);
  }

  @Get(':id/can-start')
  @ApiOperation({ summary: 'Check if a task can start (all dependencies completed)' })
  checkCanStart(
    @CurrentOrg() org: any,
    @Param('id') id: string,
  ) {
    return this.service.checkCanStart(org.id, id);
  }

  // ─── Task Timers ──────────────────────────────────────────────────────────

  @Post(':id/timer/start')
  @ApiOperation({ summary: 'Start a timer on a task' })
  startTimer(
    @CurrentOrg() org: any,
    @CurrentUser() user: any,
    @Param('id') id: string,
  ) {
    return this.service.startTimer(org.id, id, user.id);
  }

  @Post(':id/timer/stop')
  @ApiOperation({ summary: 'Stop a running timer on a task' })
  stopTimer(
    @CurrentOrg() org: any,
    @CurrentUser() user: any,
    @Param('id') id: string,
  ) {
    return this.service.stopTimer(org.id, id, user.id);
  }

  @Get(':id/timer')
  @ApiOperation({ summary: 'Get the active timer for a task' })
  getActiveTimer(
    @CurrentOrg() org: any,
    @CurrentUser() user: any,
    @Param('id') id: string,
  ) {
    return this.service.getActiveTimer(org.id, id, user.id);
  }

  @Get(':id/time-entries')
  @ApiOperation({ summary: 'Get all time entries for a task' })
  getTimeEntries(
    @CurrentOrg() org: any,
    @Param('id') id: string,
  ) {
    return this.service.getTimeEntries(org.id, id);
  }
}
