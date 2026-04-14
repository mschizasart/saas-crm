import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Patch,
  Post,
  Put,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiTags, ApiBearerAuth } from '@nestjs/swagger';
import { CustomFieldsService } from './custom-fields.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RbacGuard } from '../../common/guards/rbac.guard';
import { CurrentOrg } from '../../common/decorators/current-org.decorator';
import { Permissions } from '../../common/decorators/permissions.decorator';

@ApiTags('Custom Fields')
@ApiBearerAuth()
@Controller({ version: '1', path: 'custom-fields' })
@UseGuards(JwtAuthGuard, RbacGuard)
export class CustomFieldsController {
  constructor(private service: CustomFieldsService) {}

  @Get()
  @Permissions('settings.edit')
  findAll(@CurrentOrg() org: any, @Query('fieldTo') fieldTo?: string) {
    return this.service.findAll(org.id, fieldTo);
  }

  @Get('values/:fieldTo/:entityId')
  getValues(
    @CurrentOrg() org: any,
    @Param('fieldTo') fieldTo: string,
    @Param('entityId') entityId: string,
  ) {
    return this.service.getValuesForEntity(org.id, fieldTo, entityId);
  }

  @Put('values/:fieldTo/:entityId')
  setValues(
    @CurrentOrg() org: any,
    @Param('fieldTo') fieldTo: string,
    @Param('entityId') entityId: string,
    @Body() body: Record<string, any>,
  ) {
    return this.service.setValues(org.id, fieldTo, entityId, body);
  }

  @Get(':id')
  @Permissions('settings.edit')
  findOne(@CurrentOrg() org: any, @Param('id') id: string) {
    return this.service.findOne(org.id, id);
  }

  @Post()
  @Permissions('settings.edit')
  create(@CurrentOrg() org: any, @Body() body: any) {
    return this.service.create(org.id, body);
  }

  @Patch(':id')
  @Permissions('settings.edit')
  update(
    @CurrentOrg() org: any,
    @Param('id') id: string,
    @Body() body: any,
  ) {
    return this.service.update(org.id, id, body);
  }

  @Delete(':id')
  @Permissions('settings.edit')
  @HttpCode(204)
  async delete(@CurrentOrg() org: any, @Param('id') id: string) {
    await this.service.delete(org.id, id);
  }
}
