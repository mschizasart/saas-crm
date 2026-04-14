import { Controller, UseGuards } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { TasksService } from './tasks.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';

@ApiTags('Tasks')
@Controller({ version: '1', path: 'tasks' })
@UseGuards(JwtAuthGuard)
export class TasksController {
  constructor(private service: TasksService) {}
}
