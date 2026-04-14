import {
  Controller,
  UseGuards,
  Get,
  Post,
  Patch,
  Delete,
  Param,
  Body,
} from '@nestjs/common';
import { ApiTags, ApiBearerAuth } from '@nestjs/swagger';
import { RolesService, CreateRoleDto, UpdateRoleDto } from './roles.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RbacGuard } from '../../common/guards/rbac.guard';
import { Permissions } from '../../common/decorators/permissions.decorator';
import { CurrentOrg } from '../../common/decorators/current-org.decorator';

@ApiTags('Roles')
@Controller({ version: '1', path: 'roles' })
@UseGuards(JwtAuthGuard, RbacGuard)
@ApiBearerAuth()
export class RolesController {
  constructor(private service: RolesService) {}

  @Get()
  @Permissions('users.view')
  findAll(@CurrentOrg() org: any) {
    return this.service.findAll(org.id);
  }

  @Get('permissions')
  getDefaultPermissions() {
    return this.service.getDefaultPermissions();
  }

  @Get(':id')
  @Permissions('users.view')
  findOne(@CurrentOrg() org: any, @Param('id') id: string) {
    return this.service.findOne(org.id, id);
  }

  @Post()
  @Permissions('settings.edit')
  create(@CurrentOrg() org: any, @Body() dto: CreateRoleDto) {
    return this.service.create(org.id, dto);
  }

  @Patch(':id')
  @Permissions('settings.edit')
  update(
    @CurrentOrg() org: any,
    @Param('id') id: string,
    @Body() dto: UpdateRoleDto,
  ) {
    return this.service.update(org.id, id, dto);
  }

  @Delete(':id')
  @Permissions('settings.edit')
  remove(@CurrentOrg() org: any, @Param('id') id: string) {
    return this.service.delete(org.id, id);
  }
}
