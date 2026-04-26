import {
  IsArray,
  IsBoolean,
  IsEmail,
  IsIn,
  IsOptional,
  IsString,
  IsUrl,
  MaxLength,
  MinLength,
  ValidateNested,
  ArrayMaxSize,
  Matches,
} from 'class-validator';
import { Type } from 'class-transformer';

export const FIELD_TYPES = [
  'text',
  'email',
  'phone',
  'textarea',
  'select',
] as const;

export type FieldType = (typeof FIELD_TYPES)[number];

export class LeadFormFieldDto {
  @IsString()
  @MinLength(1)
  @MaxLength(64)
  // Keep keys safe as JSON object keys / form input names.
  @Matches(/^[a-zA-Z][a-zA-Z0-9_]*$/u, {
    message:
      'field key must start with a letter and contain only letters, digits, underscore',
  })
  key!: string;

  @IsString()
  @MinLength(1)
  @MaxLength(120)
  label!: string;

  @IsIn(FIELD_TYPES)
  type!: FieldType;

  @IsOptional()
  @IsBoolean()
  required?: boolean;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(50)
  @IsString({ each: true })
  options?: string[];
}

export class CreateLeadFormDto {
  @IsString()
  @MinLength(1)
  @MaxLength(80)
  @Matches(/^[a-z0-9][a-z0-9-]*$/u, {
    message: 'slug must be lowercase letters, digits and hyphens',
  })
  slug!: string;

  @IsString()
  @MinLength(1)
  @MaxLength(120)
  name!: string;

  @IsString()
  @MinLength(1)
  @MaxLength(160)
  title!: string;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  description?: string;

  @IsArray()
  @ArrayMaxSize(50)
  @ValidateNested({ each: true })
  @Type(() => LeadFormFieldDto)
  fields!: LeadFormFieldDto[];

  @IsOptional()
  @IsUrl({ require_tld: false })
  @MaxLength(500)
  redirectUrl?: string;

  @IsOptional()
  @IsBoolean()
  captchaEnabled?: boolean;

  @IsOptional()
  @IsEmail()
  @MaxLength(160)
  notifyEmail?: string;

  @IsOptional()
  @IsString()
  @MaxLength(64)
  assignToUserId?: string;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}

export class UpdateLeadFormDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(80)
  @Matches(/^[a-z0-9][a-z0-9-]*$/u, {
    message: 'slug must be lowercase letters, digits and hyphens',
  })
  slug?: string;

  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(120)
  name?: string;

  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(160)
  title?: string;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  description?: string;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(50)
  @ValidateNested({ each: true })
  @Type(() => LeadFormFieldDto)
  fields?: LeadFormFieldDto[];

  @IsOptional()
  @IsUrl({ require_tld: false })
  @MaxLength(500)
  redirectUrl?: string;

  @IsOptional()
  @IsBoolean()
  captchaEnabled?: boolean;

  @IsOptional()
  @IsEmail()
  @MaxLength(160)
  notifyEmail?: string;

  @IsOptional()
  @IsString()
  @MaxLength(64)
  assignToUserId?: string;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}

/**
 * Public submission payload: open-ended key/value map. We can't use
 * class-validator to tightly type this because the shape is dynamic —
 * validated against the form's stored `fields` definition instead.
 */
export class SubmitLeadFormDto {
  [key: string]: unknown;

  // Honeypot — must be empty or missing. If the bot fills it, we drop the
  // submission silently (still 200 to not leak the check).
  @IsOptional()
  @IsString()
  @MaxLength(500)
  website?: string;
}
