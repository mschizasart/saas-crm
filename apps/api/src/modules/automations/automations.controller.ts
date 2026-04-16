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
import { AutomationsService, CreateAutomationDto, UpdateAutomationDto } from './automations.service';

@ApiTags('Automations')
@Controller({ version: '1', path: 'automations' })
@UseGuards(JwtAuthGuard)
export class AutomationsController {
  constructor(private service: AutomationsService) {}

  @Get()
  findAll(@Req() req: any) {
    return this.service.findAll(req.user.orgId ?? req.user.organizationId);
  }

  @Post()
  create(@Req() req: any, @Body() dto: CreateAutomationDto) {
    return this.service.create(req.user.orgId ?? req.user.organizationId, dto);
  }

  @Patch(':id')
  update(@Req() req: any, @Param('id') id: string, @Body() dto: UpdateAutomationDto) {
    return this.service.update(req.user.orgId ?? req.user.organizationId, id, dto);
  }

  @Delete(':id')
  delete(@Req() req: any, @Param('id') id: string) {
    return this.service.delete(req.user.orgId ?? req.user.organizationId, id);
  }
}
