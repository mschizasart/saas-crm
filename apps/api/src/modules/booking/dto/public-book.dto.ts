import {
  IsEmail,
  IsISO8601,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
} from 'class-validator';

/** Body for POST /public/booking/:orgSlug/:pageSlug/book */
export class PublicBookDto {
  /** Slot start as a UTC ISO instant (e.g. "2026-07-15T13:00:00.000Z"). */
  @IsISO8601()
  startTime!: string;

  @IsString()
  @MinLength(1)
  @MaxLength(200)
  name!: string;

  @IsEmail()
  @MaxLength(320)
  email!: string;

  @IsOptional()
  @IsString()
  @MaxLength(5000)
  notes?: string;
}
