import { IsEmail, IsString, MinLength, IsOptional, IsUUID } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class LoginDto {
  @ApiProperty({ example: 'admin@acme.com' })
  @IsEmail()
  email: string;

  @ApiProperty({ example: 'secret123' })
  @IsString()
  @MinLength(6)
  password: string;
}

export class TwoFaVerifyDto {
  @ApiProperty({ description: '6-digit TOTP code' })
  @IsString()
  code: string;

  @ApiProperty({ description: 'Temporary token returned from login step 1' })
  @IsString()
  tempToken: string;
}

export class RefreshTokenDto {
  @ApiProperty()
  @IsString()
  refreshToken: string;
}

export class ForgotPasswordDto {
  @ApiProperty()
  @IsEmail()
  email: string;
}

export class ResetPasswordDto {
  @ApiProperty()
  @IsString()
  token: string;

  @ApiProperty()
  @IsString()
  @MinLength(8)
  password: string;
}

export class SetupTwoFaDto {
  @ApiProperty({ description: '6-digit TOTP code to confirm setup' })
  @IsString()
  code: string;
}

export class RegisterOrganizationDto {
  @ApiProperty({ example: 'Acme Inc.' })
  @IsString()
  organizationName: string;

  @ApiProperty({ example: 'acme' })
  @IsString()
  slug: string;

  @ApiProperty()
  @IsString()
  firstName: string;

  @ApiProperty()
  @IsString()
  lastName: string;

  @ApiProperty()
  @IsEmail()
  email: string;

  @ApiProperty()
  @IsString()
  @MinLength(8)
  password: string;

  @ApiProperty({ required: false, example: 'EUR' })
  @IsOptional()
  @IsString()
  currency?: string;
}

/**
 * Multi-org login step 3: the client posts the short-lived selection
 * token returned by /login (or /auth/2fa/login when the user has 2FA)
 * together with the orgId they want to enter.
 */
export class SelectOrgDto {
  @ApiProperty({ description: 'Short-lived org-selection JWT from /login' })
  @IsString()
  orgSelectionToken: string;

  @ApiProperty({ description: 'Selected organization id' })
  @IsUUID('4')
  orgId: string;
}

/**
 * Mid-session org swap: caller is already authenticated, wants to
 * re-mint a token pair anchored at a different org they belong to.
 */
export class SwitchOrgDto {
  @ApiProperty({ description: 'Target organization id (must be a membership)' })
  @IsUUID('4')
  orgId: string;
}

export class PortalRegisterDto {
  @ApiProperty({ example: 'acme' })
  @IsString()
  organizationSlug: string;

  @ApiProperty()
  @IsEmail()
  email: string;

  @ApiProperty()
  @IsString()
  @MinLength(8)
  password: string;

  @ApiProperty()
  @IsString()
  firstName: string;

  @ApiProperty()
  @IsString()
  lastName: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  phone?: string;
}
