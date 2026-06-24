import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Put,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  CallsService,
  DialDto,
  ListCallsQueryDto,
  LogCallDto,
  UpdateCallDto,
} from './calls.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RbacGuard } from '../../common/guards/rbac.guard';
import { CurrentOrg } from '../../common/decorators/current-org.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Permissions } from '../../common/decorators/permissions.decorator';

/**
 * Built-in calling + call logging (migration 044).
 *
 * Gated by the `calls.*` permission group. Admin/owner tiers bypass RBAC via
 * RbacGuard. There is no separate `calls.edit` permission — updating a call's
 * outcome/notes/duration reuses `calls.create` to keep the perm set small.
 */
@ApiTags('Calls')
@Controller({ version: '1', path: 'calls' })
@UseGuards(JwtAuthGuard, RbacGuard)
@ApiBearerAuth()
export class CallsController {
  constructor(private readonly service: CallsService) {}

  @Get()
  @Permissions('calls.view')
  @ApiOperation({ summary: 'List calls (global log or filtered by lead/client)' })
  list(@CurrentOrg() org: any, @Query() query: ListCallsQueryDto) {
    return this.service.list(org.id, query);
  }

  @Post()
  @Permissions('calls.create')
  @ApiOperation({ summary: 'Log a phone call against a lead/client' })
  log(
    @CurrentOrg() org: any,
    @CurrentUser() user: any,
    @Body() dto: LogCallDto,
  ) {
    return this.service.logCall(org.id, dto, user?.id);
  }

  @Get('settings')
  @Permissions('calls.view')
  @ApiOperation({
    summary:
      'Telephony status for this org (configured / fromNumber / source) — auth token never returned',
  })
  settings(@CurrentOrg() org: any) {
    return this.service.settings(org.id);
  }

  @Post('dial')
  @Permissions('calls.create')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Click-to-call: bridge the agent\'s phone to the customer via Twilio',
  })
  dial(
    @CurrentOrg() org: any,
    @CurrentUser() user: any,
    @Body() dto: DialDto,
  ) {
    return this.service.dial(org.id, org.slug, dto, user);
  }

  @Get(':id')
  @Permissions('calls.view')
  @ApiOperation({ summary: 'Get one call' })
  findOne(@CurrentOrg() org: any, @Param('id') id: string) {
    return this.service.findOne(org.id, id);
  }

  @Put(':id')
  @Permissions('calls.create')
  @ApiOperation({ summary: 'Update a call (outcome / notes / duration)' })
  update(
    @CurrentOrg() org: any,
    @Param('id') id: string,
    @Body() dto: UpdateCallDto,
  ) {
    return this.service.update(org.id, id, dto);
  }

  @Delete(':id')
  @Permissions('calls.create')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Delete a call' })
  async remove(@CurrentOrg() org: any, @Param('id') id: string) {
    await this.service.remove(org.id, id);
  }
}
