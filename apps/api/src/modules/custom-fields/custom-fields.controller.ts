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
import { CurrentUser } from '../../common/decorators/current-user.decorator';
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

  // Computed-field option metadata for the admin field-builder UI.
  // Placed before the ':id' catch-all so "meta" isn't treated as an id.
  @Get('meta/:fieldTo')
  @Permissions('settings.edit')
  getComputedMeta(@CurrentOrg() org: any, @Param('fieldTo') fieldTo: string) {
    return this.service.getComputedMeta(org.id, fieldTo);
  }

  // Validate + preview a formula expression (parse only, no persistence).
  @Post('formula/preview')
  @Permissions('settings.edit')
  previewFormula(@Body() body: { expr?: string }) {
    return this.service.previewFormula(body?.expr ?? '');
  }

  // No static @Permissions: value access is entity-type-dependent (reading an
  // invoice's custom fields needs invoices.view, a client's needs clients.view,
  // …). The service enforces <resource>.view / <resource>.edit dynamically via
  // assertEntityPermission, keeping the RbacGuard super-admin/portal bypasses.
  @Get('values/:fieldTo/:entityId')
  getValues(
    @CurrentOrg() org: any,
    @CurrentUser() user: any,
    @Param('fieldTo') fieldTo: string,
    @Param('entityId') entityId: string,
  ) {
    return this.service.getValuesForEntity(org.id, user, fieldTo, entityId);
  }

  @Put('values/:fieldTo/:entityId')
  setValues(
    @CurrentOrg() org: any,
    @CurrentUser() user: any,
    @Param('fieldTo') fieldTo: string,
    @Param('entityId') entityId: string,
    @Body() body: Record<string, any>,
  ) {
    return this.service.setValues(org.id, user, fieldTo, entityId, body);
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
