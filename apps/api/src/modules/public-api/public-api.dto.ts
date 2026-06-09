import {
  IsString,
  IsArray,
  IsOptional,
  IsBoolean,
  IsUrl,
  IsISO8601,
  IsIn,
  ArrayUnique,
  ArrayMaxSize,
  MaxLength,
  Matches,
} from 'class-validator';
import { ALLOWED_EVENTS } from './webhook-events';

// ─── API Key DTOs ───────────────────────────────────────────────

export class CreateApiKeyDto {
  @IsString()
  @MaxLength(120)
  name!: string;

  /**
   * Per-resource scopes (e.g. 'clients.read', 'invoices.write').
   * Format-only validation here — the api-key.strategy.ts enforces
   * actual gating per request. Capped at 64 entries so a runaway
   * caller can't blow up the row.
   */
  @IsOptional()
  @IsArray()
  @ArrayUnique()
  @ArrayMaxSize(64)
  @IsString({ each: true })
  @Matches(/^[a-z0-9_-]+\.[a-z0-9_-]+$/i, {
    each: true,
    message: 'Each scope must be of the form "<resource>.<action>"',
  })
  scopes?: string[];

  @IsOptional()
  @IsISO8601()
  expiresAt?: string;
}

// ─── Webhook DTOs ───────────────────────────────────────────────

export class CreateWebhookDto {
  /**
   * Must be HTTPS — we sign the payload with a tenant-rotating secret
   * but transport encryption is still the load-bearing piece, and we
   * refuse to deliver to plaintext endpoints.
   */
  @IsUrl({ protocols: ['https'], require_protocol: true })
  url!: string;

  /**
   * Subscribed event names — every entry must appear in ALLOWED_EVENTS
   * (see webhook-events.ts). Validated additionally at the service
   * layer so the constraint can't be bypassed by tweaking the DTO.
   */
  @IsArray()
  @ArrayUnique()
  @ArrayMaxSize(ALLOWED_EVENTS.length)
  @IsString({ each: true })
  @IsIn(ALLOWED_EVENTS as readonly string[], {
    each: true,
    message: 'Each event must be one of: ' + ALLOWED_EVENTS.join(', '),
  })
  events!: string[];

  @IsOptional()
  @IsBoolean()
  active?: boolean;
}

export class UpdateWebhookDto {
  @IsOptional()
  @IsUrl({ protocols: ['https'], require_protocol: true })
  url?: string;

  @IsOptional()
  @IsArray()
  @ArrayUnique()
  @ArrayMaxSize(ALLOWED_EVENTS.length)
  @IsString({ each: true })
  @IsIn(ALLOWED_EVENTS as readonly string[], {
    each: true,
    message: 'Each event must be one of: ' + ALLOWED_EVENTS.join(', '),
  })
  events?: string[];

  @IsOptional()
  @IsBoolean()
  active?: boolean;
}
