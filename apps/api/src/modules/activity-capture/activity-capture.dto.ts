import { IsBoolean, IsInt, IsOptional, Max, Min } from 'class-validator';
import { Type } from 'class-transformer';

/**
 * Tenant-facing settings for the capture pipeline (Wave H2).
 *
 * All three flags are optional so the same DTO covers "toggle just
 * one" — class-validator does not strip undefined keys; the service
 * only writes the provided fields.
 */
export class UpdateSettingsDto {
  @IsOptional()
  @IsBoolean()
  emailCaptureEnabled?: boolean;

  @IsOptional()
  @IsBoolean()
  smsCaptureEnabled?: boolean;

  @IsOptional()
  @IsBoolean()
  captureInternalEmails?: boolean;
}

/**
 * Admin-triggered backfill window. Capped at 365 days because a
 * runaway 5-year sweep would scan tens of thousands of OutboundMessage
 * rows. The service caps at 10000 rows regardless.
 */
export class BackfillQueryDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(365)
  sinceDays?: number;
}
