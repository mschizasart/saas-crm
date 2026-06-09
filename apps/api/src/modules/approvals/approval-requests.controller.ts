import {
  Controller,
  Get,
  Post,
  Body,
  Param,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';

import { ApprovalRequestsService } from './approval-requests.service';
import { CreateRequestDto, DecisionDto } from './approvals.dto';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RbacGuard } from '../../common/guards/rbac.guard';
import { CurrentOrg } from '../../common/decorators/current-org.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Permissions } from '../../common/decorators/permissions.decorator';

@ApiTags('Approvals')
@Controller({ version: '1', path: 'approval-requests' })
@UseGuards(JwtAuthGuard, RbacGuard)
@ApiBearerAuth()
export class ApprovalRequestsController {
  constructor(private service: ApprovalRequestsService) {}

  // ─── /my-pending (declared BEFORE /:id so it's not shadowed) ──

  @Get('my-pending')
  @Permissions('approvals.view')
  @ApiOperation({ summary: 'Approval requests awaiting the current user' })
  myPending(@CurrentOrg() org: any, @CurrentUser() user: any) {
    return this.service.myPending(org.id, user.id);
  }

  // ─── CRUD ─────────────────────────────────────────────────────

  @Get()
  @Permissions('approvals.view')
  @ApiOperation({ summary: 'List approval requests (paginated, filterable)' })
  list(
    @CurrentOrg() org: any,
    @Query('status') status?: string,
    @Query('targetType') targetType?: string,
    @Query('targetId') targetId?: string,
    @Query('requestedById') requestedById?: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    return this.service.list(org.id, {
      status,
      targetType,
      targetId,
      requestedById,
      page: page ? Number(page) : undefined,
      limit: limit ? Number(limit) : undefined,
    });
  }

  @Get(':id')
  @Permissions('approvals.view')
  @ApiOperation({ summary: 'Fetch a single approval request with decisions' })
  findOne(@CurrentOrg() org: any, @Param('id') id: string) {
    return this.service.findOne(org.id, id);
  }

  @Post()
  @Permissions('approvals.request')
  @ApiOperation({ summary: 'Submit a new approval request' })
  create(
    @CurrentOrg() org: any,
    @CurrentUser() user: any,
    @Body() dto: CreateRequestDto,
  ) {
    return this.service.create(org.id, user.id, dto);
  }

  @Post(':id/decide')
  @Permissions('approvals.decide')
  @ApiOperation({ summary: 'Approve or reject the current step of a request' })
  decide(
    @CurrentOrg() org: any,
    @CurrentUser() user: any,
    @Param('id') id: string,
    @Body() dto: DecisionDto,
  ) {
    return this.service.decide(org.id, user.id, id, dto);
  }

  @Post(':id/cancel')
  @Permissions('approvals.request')
  @ApiOperation({ summary: 'Cancel a pending approval request (requester only)' })
  cancel(
    @CurrentOrg() org: any,
    @CurrentUser() user: any,
    @Param('id') id: string,
  ) {
    return this.service.cancel(org.id, user.id, id);
  }
}
