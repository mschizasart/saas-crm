import { IsEmail, IsString, MinLength, IsOptional } from 'class-validator';
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
}
