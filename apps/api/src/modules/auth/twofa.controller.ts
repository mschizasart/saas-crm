import {
  Controller,
  Post,
  Get,
  Body,
  HttpCode,
  HttpStatus,
  UseGuards,
} from '@nestjs/common';
import { IsString, IsNotEmpty, MinLength } from 'class-validator';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Public } from '../../common/decorators/permissions.decorator';
import { TwoFactorAuthService } from './twofa.service';

class CodeOnlyDto {
  @IsString()
  @IsNotEmpty()
  code!: string;
}

class DisableTwoFaDto {
  @IsString()
  @MinLength(1)
  password!: string;

  @IsString()
  @IsNotEmpty()
  code!: string;
}

class TwoFaLoginDto {
  @IsString()
  @IsNotEmpty()
  twoFactorToken!: string;

  @IsString()
  @IsNotEmpty()
  code!: string;
}

@ApiTags('Auth — 2FA (staff)')
@Controller({ version: '1', path: 'auth/2fa' })
export class TwoFactorAuthController {
  constructor(private twofa: TwoFactorAuthService) {}

  // ─── Status (no secret returned) ─────────────────────────────────

  @Get('status')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Get current 2FA status (enabled flag + enrolledAt)' })
  async status(@CurrentUser() user: any) {
    return this.twofa.getStatus(user.id);
  }

  // ─── Setup / management ──────────────────────────────────────────

  @Post('setup')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Generate a fresh TOTP secret + QR code' })
  async setup(@CurrentUser() user: any) {
    return this.twofa.setup(user.id);
  }

  @Post('verify-setup')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary:
      'Confirm the first TOTP code and enable 2FA. Returns the one-time recovery codes.',
  })
  async verifySetup(@CurrentUser() user: any, @Body() dto: CodeOnlyDto) {
    return this.twofa.verifySetup(user.id, dto.code);
  }

  @Post('disable')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Disable 2FA (requires password + current TOTP code)' })
  async disable(@CurrentUser() user: any, @Body() dto: DisableTwoFaDto) {
    return this.twofa.disable(user.id, dto.password, dto.code);
  }

  @Post('regenerate-recovery')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Regenerate recovery codes (requires current TOTP code)' })
  async regenerate(@CurrentUser() user: any, @Body() dto: CodeOnlyDto) {
    return this.twofa.regenerateRecoveryCodes(user.id, dto.code);
  }

  // ─── Login step 2 ────────────────────────────────────────────────

  @Post('login')
  @Public()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary:
      'Complete login by providing the TOTP code (or recovery code) for a user who has 2FA enabled.',
  })
  async login(@Body() dto: TwoFaLoginDto) {
    return this.twofa.loginWithCode(dto.twoFactorToken, dto.code);
  }
}
