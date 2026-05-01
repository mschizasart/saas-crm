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
import { IsString, IsNotEmpty, MinLength } from 'class-validator';
import { PlatformService, CreatePlatformAdminDto } from './platform.service';
import { PlatformAdminGuard } from '../../common/guards/platform-admin.guard';
import { Public } from '../../common/decorators/permissions.decorator';

class PlatformCodeOnlyDto {
  @IsString()
  @IsNotEmpty()
  code!: string;
}

class PlatformDisableTwoFaDto {
  @IsString()
  @MinLength(1)
  password!: string;

  @IsString()
  @IsNotEmpty()
  code!: string;
}

class PlatformTwoFaLoginDto {
  @IsString()
  @IsNotEmpty()
  twoFactorToken!: string;

  @IsString()
  @IsNotEmpty()
  code!: string;
}

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

  // ─── Platform admin 2FA ────────────────────────────────────

  @Get('2fa/status')
  @UseGuards(PlatformAdminGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Current platform admin 2FA status (no secret returned)' })
  async statusTwoFa(@Req() req: any) {
    return this.service.getTwoFaStatus(req.platformAdmin.sub);
  }

  @Post('2fa/setup')
  @UseGuards(PlatformAdminGuard)
  @ApiBearerAuth()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Generate a TOTP secret + QR code for the current platform admin' })
  async setupTwoFa(@Req() req: any) {
    return this.service.setupTwoFa(req.platformAdmin.sub);
  }

  @Post('2fa/verify-setup')
  @UseGuards(PlatformAdminGuard)
  @ApiBearerAuth()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Confirm the first TOTP code, enable 2FA, return recovery codes' })
  async verifySetupTwoFa(@Req() req: any, @Body() dto: PlatformCodeOnlyDto) {
    return this.service.verifySetupTwoFa(req.platformAdmin.sub, dto.code);
  }

  @Post('2fa/disable')
  @UseGuards(PlatformAdminGuard)
  @ApiBearerAuth()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Disable 2FA (requires password + current TOTP code)' })
  async disableTwoFa(@Req() req: any, @Body() dto: PlatformDisableTwoFaDto) {
    return this.service.disableTwoFa(req.platformAdmin.sub, dto.password, dto.code);
  }

  @Post('2fa/regenerate-recovery')
  @UseGuards(PlatformAdminGuard)
  @ApiBearerAuth()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Regenerate recovery codes (requires current TOTP code)' })
  async regenerateRecoveryTwoFa(@Req() req: any, @Body() dto: PlatformCodeOnlyDto) {
    return this.service.regenerateRecoveryTwoFa(req.platformAdmin.sub, dto.code);
  }

  @Post('2fa/login')
  @Public()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Complete platform login by providing the TOTP / recovery code' })
  async loginTwoFa(@Body() dto: PlatformTwoFaLoginDto) {
    return this.service.loginTwoFa(dto.twoFactorToken, dto.code);
  }

  // ─── Operator: reset 2FA on a tenant user ──────────────────
  // For when a staff user loses BOTH their authenticator and recovery
  // codes. Intentionally only exposed to platform admins.

  @Post('users/:id/reset-2fa')
  @UseGuards(PlatformAdminGuard)
  @ApiBearerAuth()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Reset 2FA on a tenant user (escape hatch when codes lost)' })
  async resetUserTwoFa(@Param('id') id: string) {
    return this.service.resetUserTwoFa(id);
  }

  @Post('admins/:id/reset-2fa')
  @UseGuards(PlatformAdminGuard)
  @ApiBearerAuth()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Reset 2FA on another platform admin (escape hatch)' })
  async resetAdminTwoFa(@Param('id') id: string, @Req() req: any) {
    return this.service.resetAdminTwoFa(id, req.platformAdmin.sub);
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

  // ─── Plans ─────────────────────────────────────────────────

  @Get('plans')
  @UseGuards(PlatformAdminGuard)
  @ApiBearerAuth()
  async listPlans() {
    return this.service.listPlans();
  }

  @Get('plans/:id')
  @UseGuards(PlatformAdminGuard)
  @ApiBearerAuth()
  async getPlan(@Param('id') id: string) {
    return this.service.getPlan(id);
  }

  @Post('plans')
  @UseGuards(PlatformAdminGuard)
  @ApiBearerAuth()
  async createPlan(@Body() dto: any) {
    return this.service.createPlan(dto);
  }

  @Patch('plans/:id')
  @UseGuards(PlatformAdminGuard)
  @ApiBearerAuth()
  async updatePlan(@Param('id') id: string, @Body() dto: any) {
    return this.service.updatePlan(id, dto);
  }

  @Delete('plans/:id')
  @UseGuards(PlatformAdminGuard)
  @ApiBearerAuth()
  @HttpCode(HttpStatus.NO_CONTENT)
  async deletePlan(@Param('id') id: string) {
    return this.service.deletePlan(id);
  }

  // ─── Billing stats ─────────────────────────────────────────

  @Get('billing/stats')
  @UseGuards(PlatformAdminGuard)
  @ApiBearerAuth()
  async getBillingStats() {
    return this.service.getBillingStats();
  }

  @Get('billing/revenue-by-month')
  @UseGuards(PlatformAdminGuard)
  @ApiBearerAuth()
  async getRevenue(@Query('months') months?: string) {
    return this.service.getRevenueByMonth(months ? Number(months) : 12);
  }

  @Get('billing/orgs-by-plan')
  @UseGuards(PlatformAdminGuard)
  @ApiBearerAuth()
  async getOrgsByPlan() {
    return this.service.getOrgsByPlan();
  }

  // ─── Assign plan ───────────────────────────────────────────

  @Post('organizations/:id/assign-plan')
  @UseGuards(PlatformAdminGuard)
  @ApiBearerAuth()
  async assignPlan(@Param('id') id: string, @Body() body: { planSlug: string }) {
    return this.service.assignPlanToOrg(id, body.planSlug);
  }
}
