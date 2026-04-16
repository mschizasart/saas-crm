import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Body,
  Param,
  UseGuards,
  Req,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { WebhooksService, CreateWebhookDto, UpdateWebhookDto } from './webhooks.service';

@ApiTags('Webhooks')
@Controller({ version: '1', path: 'webhooks' })
@UseGuards(JwtAuthGuard)
export class WebhooksController {
  constructor(private service: WebhooksService) {}

  @Get()
  findAll(@Req() req: any) {
    return this.service.findAll(req.user.orgId ?? req.user.organizationId);
  }

  @Post()
  create(@Req() req: any, @Body() dto: CreateWebhookDto) {
    return this.service.create(req.user.orgId ?? req.user.organizationId, dto);
  }

  @Patch(':id')
  update(@Req() req: any, @Param('id') id: string, @Body() dto: UpdateWebhookDto) {
    return this.service.update(req.user.orgId ?? req.user.organizationId, id, dto);
  }

  @Delete(':id')
  delete(@Req() req: any, @Param('id') id: string) {
    return this.service.delete(req.user.orgId ?? req.user.organizationId, id);
  }

  @Post(':id/test')
  test(@Req() req: any, @Param('id') id: string) {
    return this.service.test(req.user.orgId ?? req.user.organizationId, id);
  }
}
