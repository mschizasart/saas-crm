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

import { WorkOrdersService } from './work-orders.service';
import {
  CreateWorkOrderDto,
  UpdateWorkOrderDto,
  ScheduleDto,
  StatusTransitionDto,
  CompleteWorkOrderDto,
  ListWorkOrdersQueryDto,
} from './field-service.dto';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RbacGuard } from '../../common/guards/rbac.guard';
import { CurrentOrg } from '../../common/decorators/current-org.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Permissions } from '../../common/decorators/permissions.decorator';

@ApiTags('Field Service — Work Orders')
@Controller({ version: '1', path: 'work-orders' })
@UseGuards(JwtAuthGuard, RbacGuard)
@ApiBearerAuth()
export class WorkOrdersController {
  constructor(private service: WorkOrdersService) {}

  @Get()
  @Permissions('field-service.view')
  @ApiOperation({ summary: 'List work orders (paginated, filterable)' })
  list(@CurrentOrg() org: any, @Query() query: ListWorkOrdersQueryDto) {
    return this.service.list(org.id, query);
  }

  @Get(':id')
  @Permissions('field-service.view')
  @ApiOperation({ summary: 'Fetch a single work order with lines + history' })
  findOne(@CurrentOrg() org: any, @Param('id') id: string) {
    return this.service.findOne(org.id, id);
  }

  @Post()
  @Permissions('field-service.create')
  @ApiOperation({ summary: 'Create a draft work order' })
  create(
    @CurrentOrg() org: any,
    @CurrentUser() user: any,
    @Body() dto: CreateWorkOrderDto,
  ) {
    return this.service.create(org.id, user.id, dto);
  }

  @Put(':id')
  @Permissions('field-service.edit')
  @ApiOperation({
    summary:
      'Update a non-terminal work order (use lifecycle endpoints for status)',
  })
  update(
    @CurrentOrg() org: any,
    @Param('id') id: string,
    @Body() dto: UpdateWorkOrderDto,
  ) {
    return this.service.update(org.id, id, dto);
  }

  @Delete(':id')
  @Permissions('field-service.delete')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({
    summary: 'Delete a DRAFT work order (refused for any other status — cancel instead)',
  })
  remove(@CurrentOrg() org: any, @Param('id') id: string) {
    return this.service.remove(org.id, id);
  }

  // ─── Lifecycle ────────────────────────────────────────────────

  @Post(':id/schedule')
  @Permissions('field-service.schedule')
  @ApiOperation({
    summary:
      'Assign a technician + window (draft → scheduled, or re-schedule a scheduled WO)',
  })
  schedule(
    @CurrentOrg() org: any,
    @CurrentUser() user: any,
    @Param('id') id: string,
    @Body() dto: ScheduleDto,
  ) {
    return this.service.schedule(org.id, user.id, id, dto);
  }

  @Post(':id/start')
  @Permissions('field-service.execute')
  @ApiOperation({
    summary:
      'Technician marks the WO in progress (scheduled → in_progress)',
  })
  start(
    @CurrentOrg() org: any,
    @CurrentUser() user: any,
    @Param('id') id: string,
    @Body() dto: StatusTransitionDto,
  ) {
    return this.service.start(org.id, user, id, dto ?? {});
  }

  @Post(':id/complete')
  @Permissions('field-service.execute')
  @ApiOperation({
    summary:
      'Technician completes the WO (in_progress → completed); may replace line items',
  })
  complete(
    @CurrentOrg() org: any,
    @CurrentUser() user: any,
    @Param('id') id: string,
    @Body() dto: CompleteWorkOrderDto,
  ) {
    return this.service.complete(org.id, user, id, dto ?? {});
  }

  @Post(':id/cancel')
  @Permissions('field-service.edit')
  @ApiOperation({
    summary: 'Cancel a non-terminal WO (draft / scheduled / in_progress)',
  })
  cancel(
    @CurrentOrg() org: any,
    @CurrentUser() user: any,
    @Param('id') id: string,
    @Body() dto: StatusTransitionDto,
  ) {
    return this.service.cancel(org.id, user.id, id, dto ?? {});
  }
}
