import {
  Controller,
  Post,
  Get,
  Body,
  UseGuards,
  Req,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { AuthService } from './auth.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Public } from '../../common/decorators/permissions.decorator';
import {
  LoginDto,
  TwoFaVerifyDto,
  RefreshTokenDto,
  ForgotPasswordDto,
  ResetPasswordDto,
  RegisterOrganizationDto,
  PortalRegisterDto,
  SelectOrgDto,
  SwitchOrgDto,
} from './dto/auth.dto';

@ApiTags('Auth')
@Controller({ version: '1', path: 'auth' })
export class AuthController {
  constructor(private authService: AuthService) {}

  // ─── Staff login ───────────────────────────────────────────

  @Post('login')
  @Public()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Staff login (step 1)' })
  async login(@Body() dto: LoginDto) {
    const user = await this.authService.validateUser(dto.email, dto.password);
    if (!user) {
      return { success: false, message: 'Invalid credentials' };
    }
    return this.authService.login(user);
  }

  /**
   * Legacy step-2 endpoint kept ONLY for users that enrolled under the
   * old `twoFaEnabled` scaffolding. New TOTP enrolments use
   * POST /auth/2fa/login (see twofa.controller.ts) with `twoFactorToken`.
   */
  @Post('2fa/verify')
  @Public()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Legacy: complete 2FA verification (old flow)' })
  async verify2fa(@Body() dto: TwoFaVerifyDto) {
    // Decode tempToken to get userId
    const payload = await this.authService['jwt'].verify(dto.tempToken);
    if (payload.step !== '2fa') {
      return { success: false, message: 'Invalid token' };
    }
    return this.authService.verify2fa(payload.sub, dto.code);
  }

  // ─── Multi-org selection / switching ──────────────────────
  //
  // /select-org completes a login when the user belongs to 2+ orgs.
  // /switch-org swaps the active org mid-session (requires a valid
  // access token). Both return an accessToken+refreshToken pair just
  // like /login does in the single-org case.

  @Post('select-org')
  @Public()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary:
      'Complete a multi-org login by choosing which organization to enter.',
  })
  async selectOrg(@Body() dto: SelectOrgDto) {
    return this.authService.selectOrg(dto.orgSelectionToken, dto.orgId);
  }

  @Post('switch-org')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary:
      'Swap the active organization for the current session. Returns a new token pair.',
  })
  async switchOrg(@CurrentUser() user: any, @Body() dto: SwitchOrgDto) {
    return this.authService.switchOrg(user.id, dto.orgId);
  }

  // ─── Client portal login ───────────────────────────────────

  @Post('portal/login')
  @Public()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Client portal login' })
  async portalLogin(@Body() dto: LoginDto) {
    const user = await this.authService.validateUser(dto.email, dto.password);
    if (!user || user.type !== 'contact') {
      return { success: false, message: 'Invalid credentials' };
    }
    return this.authService.login(user);
  }

  @Post('portal/register')
  @Public()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Register a new portal contact under an organization' })
  async portalRegister(@Body() dto: PortalRegisterDto) {
    return this.authService.registerPortalContact(dto);
  }

  // ─── Token management ──────────────────────────────────────

  @Post('refresh')
  @Public()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Refresh access token' })
  async refresh(@Body() dto: RefreshTokenDto) {
    return this.authService.refreshTokens(dto.refreshToken);
  }

  @Post('logout')
  @UseGuards(JwtAuthGuard)
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Logout and invalidate refresh token' })
  async logout(@Body() dto: RefreshTokenDto) {
    await this.authService.logout(dto.refreshToken);
  }

  // ─── Password reset ────────────────────────────────────────

  @Post('forgot-password')
  @Public()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Request password reset email' })
  async forgotPassword(@Body() dto: ForgotPasswordDto) {
    await this.authService.forgotPassword(dto.email);
    return { message: 'If an account exists, a reset email has been sent.' };
  }

  @Post('reset-password')
  @Public()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Reset password with token' })
  async resetPassword(@Body() dto: ResetPasswordDto) {
    await this.authService.resetPassword(dto.token, dto.password);
    return { message: 'Password reset successfully.' };
  }

  // ─── 2FA Management ────────────────────────────────────────
  // Moved to TwoFactorAuthController (twofa.controller.ts).
  // Endpoints: POST /auth/2fa/setup, /verify-setup, /disable,
  // /regenerate-recovery, /login, GET /auth/2fa/status.

  // ─── OAuth ─────────────────────────────────────────────────

  @Get('google')
  @Public()
  @UseGuards(AuthGuard('google'))
  @ApiOperation({ summary: 'Initiate Google OAuth' })
  async googleAuth() {}

  @Get('google/callback')
  @Public()
  @UseGuards(AuthGuard('google'))
  @ApiOperation({ summary: 'Google OAuth callback' })
  async googleCallback(@Req() req: any) {
    const orgId = req.query?.state;
    return this.authService.handleOAuthLogin(req.user, orgId);
  }

  @Get('microsoft')
  @Public()
  @UseGuards(AuthGuard('microsoft'))
  @ApiOperation({ summary: 'Initiate Microsoft OAuth' })
  async microsoftAuth() {}

  @Get('microsoft/callback')
  @Public()
  @UseGuards(AuthGuard('microsoft'))
  @ApiOperation({ summary: 'Microsoft OAuth callback' })
  async microsoftCallback(@Req() req: any) {
    const orgId = req.query?.state;
    return this.authService.handleOAuthLogin(req.user, orgId);
  }

  // ─── Registration (SaaS signup) ────────────────────────────

  @Post('register')
  @Public()
  @ApiOperation({ summary: 'Register new organization (SaaS signup)' })
  async register(@Body() dto: RegisterOrganizationDto) {
    return this.authService.registerOrganization(dto);
  }

  // ─── Me ────────────────────────────────────────────────────

  @Get('me')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Get current authenticated user' })
  async me(@CurrentUser() user: any) {
    return user;
  }
}
