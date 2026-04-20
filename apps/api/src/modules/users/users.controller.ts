import {
  Controller,
  UseGuards,
  Get,
  Post,
  Put,
  Patch,
  Delete,
  Param,
  Body,
  Query,
  HttpCode,
  HttpStatus,
  HttpException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import {
  UsersService,
  CreateUserDto,
  UpdateUserDto,
  UpdateProfileDto,
} from './users.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RbacGuard } from '../../common/guards/rbac.guard';
import { Permissions, Public } from '../../common/decorators/permissions.decorator';
import { CurrentOrg } from '../../common/decorators/current-org.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';

interface PermissionOverrideInput {
  permission: string;
  grant: boolean;
}

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

  @Post('me/email-change')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Request an email change (sends confirmation link to new address)' })
  async requestEmailChange(
    @CurrentUser() user: any,
    @Body() body: { newEmail: string },
  ) {
    try {
      return await this.service.requestEmailChange(user.id, body.newEmail);
    } catch (err: any) {
      if (err instanceof HttpException) throw err;
      throw new ServiceUnavailableException(
        'Email change not yet enabled — database migration required',
      );
    }
  }

  @Post('confirm-email')
  @Public()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Confirm a pending email change using the emailed token' })
  async confirmEmailChange(@Body() body: { token: string }) {
    try {
      return await this.service.confirmEmailChange(body.token);
    } catch (err: any) {
      if (err instanceof HttpException) throw err;
      throw new ServiceUnavailableException(
        'Email change not yet enabled — database migration required',
      );
    }
  }

  @Get('me/sessions')
  getSessions(@CurrentUser() user: any) {
    return this.service.getSessions(user.id);
  }

  @Delete('me/sessions')
  revokeAllSessions(@CurrentUser() user: any) {
    return this.service.revokeAllSessions(user.id);
  }

  // Canonical permission catalogue must come before `/:id` so it isn't
  // captured as an id parameter.
  @Get('permissions/catalog')
  @Permissions('users.view')
  @ApiOperation({ summary: 'List every permission string known to the app' })
  getPermissionsCatalog() {
    return this.service.getPermissionsCatalog();
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

  // ─── Permission overrides (per-user) ──────────────────────────────────────

  @Get(':id/permissions')
  @Permissions('users.view')
  @ApiOperation({
    summary: 'Return role permissions, per-user overrides, and effective set',
  })
  async getUserPermissions(
    @CurrentOrg() org: any,
    @Param('id') id: string,
  ) {
    try {
      return await this.service.getEffectivePermissions(org.id, id);
    } catch (err: any) {
      if (err instanceof HttpException) throw err;
      throw new ServiceUnavailableException(
        'Permission overrides not yet enabled — database migration required',
      );
    }
  }

  @Put(':id/permissions/overrides')
  @Permissions('users.edit')
  @ApiOperation({
    summary: 'Replace the full set of per-user permission overrides',
  })
  async setUserPermissionOverrides(
    @CurrentOrg() org: any,
    @Param('id') id: string,
    @Body() body: { overrides: PermissionOverrideInput[] },
  ) {
    try {
      return await this.service.replacePermissionOverrides(
        org.id,
        id,
        body.overrides ?? [],
      );
    } catch (err: any) {
      if (err instanceof HttpException) throw err;
      throw new ServiceUnavailableException(
        'Permission overrides not yet enabled — database migration required',
      );
    }
  }

}
