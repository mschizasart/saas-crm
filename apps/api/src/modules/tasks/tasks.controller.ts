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
import { TasksService, CreateTaskDto } from './tasks.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { CurrentOrg } from '../../common/decorators/current-org.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';

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
