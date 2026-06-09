import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  Put,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RbacGuard } from '../../common/guards/rbac.guard';
import { Permissions } from '../../common/decorators/permissions.decorator';
import { PublicWebhooksService } from './webhooks.service';
import { CreateWebhookDto, UpdateWebhookDto } from './public-api.dto';

@ApiTags('Public API')
@ApiBearerAuth()
@Controller({ version: '1', path: 'settings/webhooks' })
@UseGuards(JwtAuthGuard, RbacGuard)
export class PublicWebhooksController {
  constructor(private readonly service: PublicWebhooksService) {}

  // ─── Webhooks CRUD ────────────────────────────────────────────

  @Get()
  @ApiOperation({ summary: 'List webhooks for the current organization' })
  @Permissions('webhooks.manage')
  list(@Req() req: any) {
    const orgId = req.user.orgId ?? req.user.organizationId;
    return this.service.list(orgId);
  }

  @Post()
  @ApiOperation({
    summary: 'Create a new webhook subscription',
    description:
      'Generates a fresh HMAC secret server-side. The plaintext secret is included in the response — store it now; it is shown only once.',
  })
  @Permissions('webhooks.manage')
  create(@Req() req: any, @Body() dto: CreateWebhookDto) {
    const orgId = req.user.orgId ?? req.user.organizationId;
    const userId = req.user.sub ?? req.user.id ?? null;
    return this.service.create(orgId, userId, dto);
  }

  @Put(':id')
  @ApiOperation({ summary: 'Update a webhook subscription' })
  @Permissions('webhooks.manage')
  update(
    @Req() req: any,
    @Param('id') id: string,
    @Body() dto: UpdateWebhookDto,
  ) {
    const orgId = req.user.orgId ?? req.user.organizationId;
    return this.service.update(orgId, id, dto);
  }

  @Post(':id/rotate-secret')
  @ApiOperation({
    summary: 'Rotate a webhook secret',
    description:
      'Invalidates the previous HMAC secret. The new plaintext secret is returned ONCE in the response.',
  })
  @Permissions('webhooks.manage')
  rotateSecret(@Req() req: any, @Param('id') id: string) {
    const orgId = req.user.orgId ?? req.user.organizationId;
    return this.service.rotateSecret(orgId, id);
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Delete a webhook subscription' })
  @Permissions('webhooks.manage')
  remove(@Req() req: any, @Param('id') id: string) {
    const orgId = req.user.orgId ?? req.user.organizationId;
    return this.service.remove(orgId, id);
  }

  // ─── Deliveries ───────────────────────────────────────────────

  @Get(':id/deliveries')
  @ApiOperation({ summary: 'List recent delivery attempts for a webhook' })
  @Permissions('webhooks.manage')
  deliveries(
    @Req() req: any,
    @Param('id') id: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
    @Query('succeeded') succeeded?: string,
  ) {
    const orgId = req.user.orgId ?? req.user.organizationId;
    return this.service.listDeliveries(orgId, id, {
      page: page ? parseInt(page, 10) : undefined,
      limit: limit ? parseInt(limit, 10) : undefined,
      succeeded:
        succeeded === undefined ? undefined : succeeded === 'true',
    });
  }

  @Post(':webhookId/deliveries/:id/redeliver')
  @ApiOperation({ summary: 'Re-queue a single delivery attempt' })
  @Permissions('webhooks.manage')
  redeliver(
    @Req() req: any,
    @Param('webhookId') webhookId: string,
    @Param('id') id: string,
  ) {
    const orgId = req.user.orgId ?? req.user.organizationId;
    return this.service.redeliver(orgId, webhookId, id);
  }
}
