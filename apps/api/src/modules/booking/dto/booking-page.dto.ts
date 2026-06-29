import {
  IsBoolean,
  IsInt,
  IsObject,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';

/**
 * workingHours shape (validated structurally in the service):
 *   { mon: [{ start: "09:00", end: "17:00" }], tue: [...], ... }
 * A missing or empty weekday key means "closed".
 */
export type WorkingHours = Record<string, { start: string; end: string }[]>;

export class CreateBookingPageDto {
  @IsString()
  @Matches(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, {
    message: 'slug must be lowercase letters/numbers separated by single hyphens',
  })
  @MaxLength(64)
  slug!: string;

  @IsString()
  @MinLength(1)
  @MaxLength(200)
  title!: string;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  description?: string;

  @IsString()
  staffId!: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  durationMinutes?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  bufferMinutes?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  minLeadTimeHours?: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  maxAdvanceDays?: number;

  @IsOptional()
  @IsString()
  @MaxLength(64)
  timezone?: string;

  @IsOptional()
  @IsObject()
  workingHours?: WorkingHours;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  meetingLocation?: string;

  @IsOptional()
  @IsBoolean()
  active?: boolean;
}

export class UpdateBookingPageDto {
  @IsOptional()
  @IsString()
  @Matches(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, {
    message: 'slug must be lowercase letters/numbers separated by single hyphens',
  })
  @MaxLength(64)
  slug?: string;

  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  title?: string;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  description?: string;

  @IsOptional()
  @IsString()
  staffId?: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  durationMinutes?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  bufferMinutes?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  minLeadTimeHours?: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  maxAdvanceDays?: number;

  @IsOptional()
  @IsString()
  @MaxLength(64)
  timezone?: string;

  @IsOptional()
  @IsObject()
  workingHours?: WorkingHours;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  meetingLocation?: string;

  @IsOptional()
  @IsBoolean()
  active?: boolean;
}
