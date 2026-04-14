import { Controller, Get, Param, Query, UseGuards } from '@nestjs/common';
import { ApiTags, ApiBearerAuth } from '@nestjs/swagger';
import { ActivityLogService } from './activity-log.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RbacGuard } from '../../common/guards/rbac.guard';
import { CurrentOrg } from '../../common/decorators/current-org.decorator';

@ApiTags('Activity Log')
@ApiBearerAuth()
@Controller({ version: '1', path: 'activity-log' })
@UseGuards(JwtAuthGuard, RbacGuard)
export class ActivityLogController {
  constructor(private service: ActivityLogService) {}

  @Get()
  findAll(@CurrentOrg() org: any, @Query() query: any) {
    return this.service.findAll(org.id, query);
  }

  @Get('entity/:type/:id')
  findForEntity(
    @CurrentOrg() org: any,
    @Param('type') type: string,
    @Param('id') id: string,
  ) {
    return this.service.findByEntity(org.id, type, id);
  }
}
