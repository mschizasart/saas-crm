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

import { ApprovalProcessesService } from './approval-processes.service';
import { CreateProcessDto, UpdateProcessDto } from './approvals.dto';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RbacGuard } from '../../common/guards/rbac.guard';
import { CurrentOrg } from '../../common/decorators/current-org.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Permissions } from '../../common/decorators/permissions.decorator';

@ApiTags('Approvals')
@Controller({ version: '1', path: 'approval-processes' })
@UseGuards(JwtAuthGuard, RbacGuard)
@ApiBearerAuth()
export class ApprovalProcessesController {
  constructor(private service: ApprovalProcessesService) {}

  @Get()
  @Permissions('approvals.view')
  @ApiOperation({ summary: 'List approval processes (paginated, filterable)' })
  list(
    @CurrentOrg() org: any,
    @Query('entityType') entityType?: string,
    @Query('active') active?: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    return this.service.list(org.id, {
      entityType,
      active: active === undefined ? undefined : active === 'true',
      page: page ? Number(page) : undefined,
      limit: limit ? Number(limit) : undefined,
    });
  }

  @Get(':id')
  @Permissions('approvals.view')
  @ApiOperation({ summary: 'Fetch a single approval process with steps' })
  findOne(@CurrentOrg() org: any, @Param('id') id: string) {
    return this.service.findOne(org.id, id);
  }

  @Post()
  @Permissions('approvals.configure')
  @ApiOperation({ summary: 'Create a new approval process with steps' })
  create(
    @CurrentOrg() org: any,
    @CurrentUser() user: any,
    @Body() dto: CreateProcessDto,
  ) {
    return this.service.create(org.id, user.id, dto);
  }

  @Put(':id')
  @Permissions('approvals.configure')
  @ApiOperation({ summary: 'Update an approval process (replaces steps if sent)' })
  update(
    @CurrentOrg() org: any,
    @Param('id') id: string,
    @Body() dto: UpdateProcessDto,
  ) {
    return this.service.update(org.id, id, dto);
  }

  @Delete(':id')
  @Permissions('approvals.configure')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Delete an approval process (refused if requests reference it)' })
  remove(@CurrentOrg() org: any, @Param('id') id: string) {
    return this.service.remove(org.id, id);
  }
}
