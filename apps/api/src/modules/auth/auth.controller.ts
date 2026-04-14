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
  SetupTwoFaDto,
  RegisterOrganizationDto,
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

  @Post('2fa/verify')
  @Public()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Complete 2FA verification (step 2)' })
  async verify2fa(@Body() dto: TwoFaVerifyDto) {
    // Decode tempToken to get userId
    const payload = await this.authService['jwt'].verify(dto.tempToken);
    if (payload.step !== '2fa') {
      return { success: false, message: 'Invalid token' };
    }
    return this.authService.verify2fa(payload.sub, dto.code);
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

  @Get('2fa/setup')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Generate 2FA secret and QR code' })
  async setup2fa(@CurrentUser() user: any) {
    return this.authService.generate2faSecret(user.id);
  }

  @Post('2fa/enable')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Enable 2FA after verifying setup code' })
  async enable2fa(@CurrentUser() user: any, @Body() dto: SetupTwoFaDto) {
    await this.authService.enable2fa(user.id, dto.code);
    return { message: '2FA enabled successfully.' };
  }

  @Post('2fa/disable')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Disable 2FA' })
  async disable2fa(@CurrentUser() user: any) {
    await this.authService.disable2fa(user.id);
    return { message: '2FA disabled.' };
  }

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
