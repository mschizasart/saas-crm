import {
  IsString,
  IsOptional,
  IsNumber,
  IsDateString,
  Matches,
  Min,
  IsPositive,
} from 'class-validator';
import { Type } from 'class-transformer';

/** ISO 4217 currency code: three uppercase letters (USD, EUR, JPY, …). */
const CURRENCY_CODE_RE = /^[A-Z]{3}$/;

export class ConvertQueryDto {
  @IsString()
  @Matches(CURRENCY_CODE_RE, {
    message: 'from must be a 3-letter ISO 4217 currency code (e.g. USD)',
  })
  from!: string;

  @IsString()
  @Matches(CURRENCY_CODE_RE, {
    message: 'to must be a 3-letter ISO 4217 currency code (e.g. EUR)',
  })
  to!: string;

  // Optional — if omitted the controller will default to 1 so the
  // endpoint can be used as a pure "get me the rate" call too.
  @IsOptional()
  @Type(() => Number)
  @IsNumber({ allowInfinity: false, allowNaN: false })
  @Min(0)
  amount?: number;

  @IsOptional()
  @IsDateString()
  asOfDate?: string;
}

export class CreateRateDto {
  @IsString()
  @Matches(CURRENCY_CODE_RE, {
    message: 'from must be a 3-letter ISO 4217 currency code',
  })
  from!: string;

  @IsString()
  @Matches(CURRENCY_CODE_RE, {
    message: 'to must be a 3-letter ISO 4217 currency code',
  })
  to!: string;

  // Postgres NUMERIC(20,10) — anything > 0 is acceptable. @IsPositive
  // already rejects 0 and negatives at the DTO layer.
  @IsNumber({ allowInfinity: false, allowNaN: false })
  @IsPositive()
  rate!: number;

  @IsDateString()
  date!: string;

  // NOTE: `source` is intentionally NOT accepted from the API. Manual
  // rates are always stored with source='manual'. Only the ECB
  // refresh path writes source='ecb' rows — letting clients claim
  // 'ecb' could occupy the (org, from, to, date, 'ecb') UNIQUE slot
  // and silently block the daily cron.
}

export class ListRatesQueryDto {
  @IsOptional()
  @IsString()
  @Matches(CURRENCY_CODE_RE)
  from?: string;

  @IsOptional()
  @IsString()
  @Matches(CURRENCY_CODE_RE)
  to?: string;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  page?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  limit?: number;
}
