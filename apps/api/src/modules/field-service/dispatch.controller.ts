import {
  Controller,
  Get,
  Param,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';

import { DispatchService } from './dispatch.service';
import {
  DispatchBoardQueryDto,
  TechnicianScheduleQueryDto,
  AvailabilityQueryDto,
} from './field-service.dto';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RbacGuard } from '../../common/guards/rbac.guard';
import { CurrentOrg } from '../../common/decorators/current-org.decorator';
import { Permissions } from '../../common/decorators/permissions.decorator';

@ApiTags('Field Service — Dispatch')
@Controller({ version: '1', path: 'dispatch' })
@UseGuards(JwtAuthGuard, RbacGuard)
@ApiBearerAuth()
export class DispatchController {
  constructor(private service: DispatchService) {}

  @Get('board')
  @Permissions('field-service.schedule')
  @ApiOperation({ summary: 'Dispatch board — technicians + WOs in a window' })
  board(@CurrentOrg() org: any, @Query() query: DispatchBoardQueryDto) {
    return this.service.getDispatchBoard(org.id, query);
  }

  @Get('technician/:id/schedule')
  @Permissions('field-service.schedule')
  @ApiOperation({ summary: "Single technician's calendar for a window" })
  technicianSchedule(
    @CurrentOrg() org: any,
    @Param('id') id: string,
    @Query() query: TechnicianScheduleQueryDto,
  ) {
    return this.service.getTechnicianSchedule(org.id, id, query);
  }

  @Get('availability')
  @Permissions('field-service.schedule')
  @ApiOperation({
    summary:
      'Find free time-slots across all technicians that fit a desired duration',
  })
  availability(@CurrentOrg() org: any, @Query() query: AvailabilityQueryDto) {
    return this.service.findAvailability(org.id, query);
  }
}
