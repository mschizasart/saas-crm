import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RbacGuard } from '../../common/guards/rbac.guard';
import { Permissions } from '../../common/decorators/permissions.decorator';
import { ApiKeysService } from './api-keys.service';
import { CreateApiKeyDto } from './public-api.dto';

@ApiTags('Public API')
@ApiBearerAuth()
@Controller({ version: '1', path: 'settings/api-keys' })
@UseGuards(JwtAuthGuard, RbacGuard)
export class PublicApiKeysController {
  constructor(private readonly service: ApiKeysService) {}

  @Get()
  @ApiOperation({
    summary: 'List API keys for the current organization',
    description:
      'Returns key metadata only — never includes the secret. Use POST to create a new key.',
  })
  @Permissions('api.manage')
  list(@Req() req: any) {
    const orgId = req.user.orgId ?? req.user.organizationId;
    return this.service.list(orgId);
  }

  @Post()
  @ApiOperation({
    summary: 'Create a new API key',
    description:
      'Returns the FULL key in the response. This is the only time the key is visible — copy it immediately.',
  })
  @Permissions('api.manage')
  create(@Req() req: any, @Body() dto: CreateApiKeyDto) {
    const orgId = req.user.orgId ?? req.user.organizationId;
    const userId = req.user.sub ?? req.user.id ?? null;
    return this.service.create(orgId, userId, dto);
  }

  @Delete(':id')
  @ApiOperation({
    summary: 'Revoke an API key',
    description:
      'Soft-deletes the key. The row remains so audit and delivery trails stay attributable.',
  })
  @Permissions('api.manage')
  revoke(@Req() req: any, @Param('id') id: string) {
    const orgId = req.user.orgId ?? req.user.organizationId;
    return this.service.revoke(orgId, id);
  }
}
