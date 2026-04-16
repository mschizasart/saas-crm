import {
  Controller,
  Get,
  Post,
  Delete,
  Body,
  Param,
  UseGuards,
  Req,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { ApiKeysService } from './api-keys.service';

@ApiTags('API Keys')
@Controller({ version: '1', path: 'api-keys' })
@UseGuards(JwtAuthGuard)
export class ApiKeysController {
  constructor(private service: ApiKeysService) {}

  @Get()
  findAll(@Req() req: any) {
    return this.service.findAll(req.user.orgId ?? req.user.organizationId);
  }

  @Post()
  create(
    @Req() req: any,
    @Body() dto: { name: string; expiresAt?: string },
  ) {
    return this.service.create(
      req.user.orgId ?? req.user.organizationId,
      dto.name,
      dto.expiresAt,
    );
  }

  @Post('validate')
  async validate(@Body() dto: { key: string }) {
    const result = await this.service.validate(dto.key);
    return { valid: !!result, ...(result ?? {}) };
  }

  @Post(':id/revoke')
  revoke(@Req() req: any, @Param('id') id: string) {
    return this.service.revoke(req.user.orgId ?? req.user.organizationId, id);
  }

  @Delete(':id')
  delete(@Req() req: any, @Param('id') id: string) {
    return this.service.delete(req.user.orgId ?? req.user.organizationId, id);
  }
}
