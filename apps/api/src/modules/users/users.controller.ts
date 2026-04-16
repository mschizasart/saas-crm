import {
  Controller,
  UseGuards,
  Get,
  Post,
  Patch,
  Delete,
  Param,
  Body,
  Query,
} from '@nestjs/common';
import { ApiTags, ApiBearerAuth } from '@nestjs/swagger';
import {
  UsersService,
  CreateUserDto,
  UpdateUserDto,
  UpdateProfileDto,
} from './users.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RbacGuard } from '../../common/guards/rbac.guard';
import { Permissions } from '../../common/decorators/permissions.decorator';
import { CurrentOrg } from '../../common/decorators/current-org.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';

@ApiTags('Users')
@Controller({ version: '1', path: 'users' })
@UseGuards(JwtAuthGuard, RbacGuard)
@ApiBearerAuth()
export class UsersController {
  constructor(private service: UsersService) {}

  @Get()
  @Permissions('users.view')
  findAll(
    @CurrentOrg() org: any,
    @Query('search') search?: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
    @Query('active') active?: string,
  ) {
    return this.service.findAll(org.id, {
      search,
      page: page ? Number(page) : undefined,
      limit: limit ? Number(limit) : undefined,
      active: active !== undefined ? active === 'true' : undefined,
    });
  }

  @Get('me')
  getMe(@CurrentUser() user: any) {
    return user;
  }

  @Get('me/dashboard-layout')
  getDashboardLayout(@CurrentUser() user: any) {
    return this.service.getDashboardLayout(user.id);
  }

  @Patch('me/dashboard-layout')
  updateDashboardLayout(
    @CurrentUser() user: any,
    @Body() body: { widgets: any[] },
  ) {
    return this.service.updateDashboardLayout(user.id, body.widgets);
  }

  @Patch('me')
  updateProfile(
    @CurrentOrg() org: any,
    @CurrentUser() user: any,
    @Body() dto: UpdateProfileDto,
  ) {
    return this.service.updateProfile(org.id, user.id, dto);
  }

  @Get('me/sessions')
  getSessions(@CurrentUser() user: any) {
    return this.service.getSessions(user.id);
  }

  @Delete('me/sessions')
  revokeAllSessions(@CurrentUser() user: any) {
    return this.service.revokeAllSessions(user.id);
  }

  @Get(':id')
  @Permissions('users.view')
  findOne(@CurrentOrg() org: any, @Param('id') id: string) {
    return this.service.findOne(org.id, id);
  }

  @Post()
  @Permissions('users.create')
  create(@CurrentOrg() org: any, @Body() dto: CreateUserDto) {
    return this.service.create(org.id, dto);
  }

  @Patch(':id')
  @Permissions('users.edit')
  update(
    @CurrentOrg() org: any,
    @Param('id') id: string,
    @Body() dto: UpdateUserDto,
  ) {
    return this.service.update(org.id, id, dto);
  }

  @Delete(':id')
  @Permissions('users.delete')
  remove(
    @CurrentOrg() org: any,
    @CurrentUser() user: any,
    @Param('id') id: string,
  ) {
    return this.service.delete(org.id, id, user.id);
  }

  @Patch(':id/toggle-active')
  @Permissions('users.edit')
  toggleActive(
    @CurrentOrg() org: any,
    @CurrentUser() user: any,
    @Param('id') id: string,
  ) {
    return this.service.toggleActive(org.id, id, user.id);
  }

  @Post(':id/reset-password')
  @Permissions('users.edit')
  resetPassword(
    @CurrentOrg() org: any,
    @Param('id') id: string,
    @Body('password') password: string,
  ) {
    return this.service.resetPassword(org.id, id, password);
  }
}
