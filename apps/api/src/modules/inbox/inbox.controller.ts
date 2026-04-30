import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RbacGuard } from '../../common/guards/rbac.guard';
import { CurrentOrg } from '../../common/decorators/current-org.decorator';
import { Permissions } from '../../common/decorators/permissions.decorator';
import { InboxService, UpdateInboxDto } from './inbox.service';
import { ImapConnectorService } from './imap-connector.service';
import { RoutedTarget } from './router.service';

/**
 * NB: There is no `emails.view` permission in the role catalogue —
 * `tickets.view` is the closest existing analogue (the legacy IMAP
 * code lived in tickets). All inbox routes use it.
 */
@ApiTags('Inbox')
@Controller({ version: '1', path: 'inbox' })
@UseGuards(JwtAuthGuard, RbacGuard)
@ApiBearerAuth()
export class InboxController {
  constructor(
    private readonly service: InboxService,
    private readonly connector: ImapConnectorService,
  ) {}

  @Get()
  @Permissions('tickets.view')
  @ApiOperation({ summary: 'List inbox messages (paginated)' })
  list(
    @CurrentOrg() org: any,
    @Query('routedTo') routedTo?: string,
    @Query('routedToId') routedToId?: string,
    @Query('search') search?: string,
    @Query('isArchived') isArchived?: string,
    @Query('isStarred') isStarred?: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    return this.service.list(org.id, {
      routedTo,
      routedToId,
      search,
      isArchived:
        typeof isArchived === 'string' ? isArchived === 'true' : undefined,
      isStarred:
        typeof isStarred === 'string' ? isStarred === 'true' : undefined,
      page: page ? Number(page) : undefined,
      limit: limit ? Number(limit) : undefined,
    });
  }

  @Get(':id')
  @Permissions('tickets.view')
  @ApiOperation({
    summary: 'Get one message — marks it as read on first GET',
  })
  findOne(@CurrentOrg() org: any, @Param('id') id: string) {
    return this.service.findOne(org.id, id, true);
  }

  @Get(':id/attachments')
  @Permissions('tickets.view')
  @ApiOperation({
    summary: 'List attachment metadata for a message (no bodies in v1)',
  })
  attachments(@CurrentOrg() org: any, @Param('id') id: string) {
    return this.service.getAttachments(org.id, id);
  }

  @Patch(':id')
  @Permissions('tickets.edit')
  @ApiOperation({
    summary: 'Update flags (read / starred / archived) and/or routing',
  })
  update(
    @CurrentOrg() org: any,
    @Param('id') id: string,
    @Body() dto: UpdateInboxDto,
  ) {
    return this.service.update(org.id, id, dto);
  }

  @Post(':id/route')
  @Permissions('tickets.edit')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Explicitly re-route a message to a record' })
  route(
    @CurrentOrg() org: any,
    @Param('id') id: string,
    @Body() body: { routedTo: RoutedTarget; routedToId: string | null },
  ) {
    return this.service.manualRoute(
      org.id,
      id,
      body.routedTo,
      body.routedToId ?? null,
    );
  }

  /**
   * Manually trigger a poll for the current org. Useful for the UI's
   * "Sync now" button. Runs synchronously — beware of long-running INBOXes.
   */
  @Post('sync')
  @Permissions('settings.edit')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Run an IMAP poll for this org right now' })
  async syncNow(@CurrentOrg() org: any) {
    return this.connector.pollOrg(org.id);
  }
}
