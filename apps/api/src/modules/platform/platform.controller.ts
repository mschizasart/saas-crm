import {
  Controller,
  Post,
  Get,
  Delete,
  Patch,
  Body,
  Param,
  Query,
  UseGuards,
  HttpCode,
  HttpStatus,
  Req,
} from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { PlatformService, CreatePlatformAdminDto } from './platform.service';
import { PlatformAdminGuard } from '../../common/guards/platform-admin.guard';
import { Public } from '../../common/decorators/permissions.decorator';

@ApiTags('Platform Admin')
@Controller({ version: '1', path: 'platform' })
export class PlatformController {
  constructor(private service: PlatformService) {}

  // ─── Auth (public) ─────────────────────────────────────────

  @Post('login')
  @Public()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Platform admin login' })
  async login(@Body() dto: { email: string; password: string }) {
    return this.service.login(dto.email, dto.password);
  }

  // ─── Platform admin management ─────────────────────────────

  @Get('admins')
  @UseGuards(PlatformAdminGuard)
  @ApiBearerAuth()
  async listAdmins() {
    return this.service.listAdmins();
  }

  @Post('admins')
  @UseGuards(PlatformAdminGuard)
  @ApiBearerAuth()
  async createAdmin(@Body() dto: CreatePlatformAdminDto) {
    return this.service.createAdmin(dto);
  }

  @Delete('admins/:id')
  @UseGuards(PlatformAdminGuard)
  @ApiBearerAuth()
  @HttpCode(HttpStatus.NO_CONTENT)
  async deleteAdmin(@Param('id') id: string) {
    return this.service.deleteAdmin(id);
  }

  // ─── Organizations ─────────────────────────────────────────

  @Get('organizations')
  @UseGuards(PlatformAdminGuard)
  @ApiBearerAuth()
  async listOrganizations(
    @Query('search') search?: string,
    @Query('status') status?: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    return this.service.listOrganizations({
      search,
      status,
      page: page ? Number(page) : undefined,
      limit: limit ? Number(limit) : undefined,
    });
  }

  @Get('organizations/:id')
  @UseGuards(PlatformAdminGuard)
  @ApiBearerAuth()
  async getOrganization(@Param('id') id: string) {
    return this.service.getOrganization(id);
  }

  @Post('organizations/:id/suspend')
  @UseGuards(PlatformAdminGuard)
  @ApiBearerAuth()
  async suspendOrg(@Param('id') id: string) {
    return this.service.suspendOrganization(id);
  }

  @Post('organizations/:id/activate')
  @UseGuards(PlatformAdminGuard)
  @ApiBearerAuth()
  async activateOrg(@Param('id') id: string) {
    return this.service.activateOrganization(id);
  }

  @Delete('organizations/:id')
  @UseGuards(PlatformAdminGuard)
  @ApiBearerAuth()
  @HttpCode(HttpStatus.NO_CONTENT)
  async deleteOrg(@Param('id') id: string) {
    return this.service.deleteOrganization(id);
  }

  @Post('organizations/:id/extend-trial')
  @UseGuards(PlatformAdminGuard)
  @ApiBearerAuth()
  async extendTrial(@Param('id') id: string, @Body() body: { days: number }) {
    return this.service.extendTrial(id, body.days);
  }

  @Post('organizations/:id/impersonate')
  @UseGuards(PlatformAdminGuard)
  @ApiBearerAuth()
  async impersonate(@Param('id') id: string) {
    return this.service.impersonateOrgAdmin(id);
  }

  // ─── Stats ─────────────────────────────────────────────────

  @Get('stats')
  @UseGuards(PlatformAdminGuard)
  @ApiBearerAuth()
  async getStats() {
    return this.service.getStats();
  }

  @Get('recent-organizations')
  @UseGuards(PlatformAdminGuard)
  @ApiBearerAuth()
  async getRecent(@Query('limit') limit?: string) {
    return this.service.getRecentOrganizations(limit ? Number(limit) : 10);
  }
}
