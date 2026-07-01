import {
  IsEmail,
  IsIn,
  IsISO8601,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
} from 'class-validator';

/** POST /addin/context — resolve CRM context for an email's sender. */
export class AddinContextDto {
  @IsEmail()
  senderEmail!: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  subject?: string;

  @IsOptional()
  @IsString()
  @MaxLength(998)
  messageId?: string;
}

/** POST /addin/log-email — write an email Activity to the timeline. */
export class AddinLogEmailDto {
  @IsOptional()
  @IsIn(['client', 'lead', 'contact'])
  relatedToType?: 'client' | 'lead' | 'contact';

  @IsOptional()
  @IsString()
  @MaxLength(64)
  relatedToId?: string;

  @IsOptional()
  @IsEmail()
  senderEmail?: string;

  @IsString()
  @MinLength(1)
  @MaxLength(500)
  subject!: string;

  @IsOptional()
  @IsString()
  @MaxLength(100000)
  body?: string;

  @IsOptional()
  @IsIn(['inbound', 'outbound'])
  direction?: 'inbound' | 'outbound';

  @IsOptional()
  @IsISO8601()
  occurredAt?: string;
}

/** POST /addin/create-lead — create a lead from the add-in. */
export class AddinCreateLeadDto {
  @IsString()
  @MinLength(1)
  @MaxLength(255)
  name!: string;

  @IsOptional()
  @IsEmail()
  email?: string;

  @IsOptional()
  @IsString()
  @MaxLength(50)
  phone?: string;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  company?: string;
}

/** POST /addin/create-contact — create a portal contact under a client. */
export class AddinCreateContactDto {
  @IsString()
  @MinLength(1)
  @MaxLength(64)
  clientId!: string;

  @IsEmail()
  email!: string;

  @IsString()
  @MinLength(1)
  @MaxLength(255)
  firstName!: string;

  @IsString()
  @MinLength(1)
  @MaxLength(255)
  lastName!: string;

  @IsOptional()
  @IsString()
  @MaxLength(50)
  phone?: string;
}
