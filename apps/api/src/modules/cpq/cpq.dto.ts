/**
 * Class-validator DTOs for the Wave F2 CPQ module (product bundles + quotes).
 *
 * The Nest global `ValidationPipe` (configured in apps/api/src/main.ts) only
 * validates @Body() params that are decorated CLASSES — plain TS interfaces
 * are skipped, which the Wave D code-review explicitly flagged as MAJOR. These
 * DTOs reject malformed bodies at the HTTP boundary; the service layer adds
 * belt-and-braces cross-tenant guards on every FK accepted from input
 * (clientId, opportunityId, productId, bundleId).
 */
import {
  ArrayMinSize,
  IsArray,
  IsDateString,
  IsEmail,
  IsIn,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
  ValidateIf,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';

// ─── Product-bundle DTOs ────────────────────────────────────────

export class BundleItemDto {
  @IsUUID()
  productId!: string;

  @IsInt()
  @Min(1)
  quantity!: number;

  @IsOptional()
  @IsNumber({ allowInfinity: false, allowNaN: false })
  @Min(0)
  @Max(100)
  discountPercent?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  order?: number;
}

export class CreateBundleDto {
  @IsString()
  @MaxLength(255)
  name!: string;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  description?: string;

  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => BundleItemDto)
  items!: BundleItemDto[];
}

export class UpdateBundleDto {
  @IsOptional()
  @IsString()
  @MaxLength(255)
  name?: string;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  description?: string;

  @IsOptional()
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => BundleItemDto)
  items?: BundleItemDto[];
}

// ─── Quote DTOs ─────────────────────────────────────────────────

/**
 * One line on a Quote.
 *
 * Exactly ONE of productId / bundleId must be set (XOR). The
 * `@ValidateIf` rules below enforce "the OTHER field must be present
 * when this one is absent" — together they reject {neither} and
 * {both}. The service runs the same XOR check + cross-tenant
 * validates whichever id is present.
 */
export class QuoteLineItemDto {
  // Required iff bundleId is absent. UUID format also enforced.
  @ValidateIf((o: QuoteLineItemDto) => !o.bundleId)
  @IsUUID()
  productId?: string;

  // Required iff productId is absent.
  @ValidateIf((o: QuoteLineItemDto) => !o.productId)
  @IsUUID()
  bundleId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  description?: string;

  @IsInt()
  @Min(1)
  quantity!: number;

  @IsOptional()
  @IsNumber({ allowInfinity: false, allowNaN: false })
  @Min(0)
  unitPrice?: number;

  @IsOptional()
  @IsNumber({ allowInfinity: false, allowNaN: false })
  @Min(0)
  @Max(100)
  discountPercent?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  order?: number;
}

export class CreateQuoteDto {
  @IsUUID()
  clientId!: string;

  @IsOptional()
  @IsUUID()
  opportunityId?: string;

  @IsDateString()
  validUntil!: string;

  @IsOptional()
  @IsNumber({ allowInfinity: false, allowNaN: false })
  @Min(0)
  @Max(100)
  discountPercent?: number;

  @IsOptional()
  @IsString()
  @MaxLength(8)
  currency?: string;

  @IsOptional()
  @IsString()
  @MaxLength(5000)
  notes?: string;

  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => QuoteLineItemDto)
  lineItems!: QuoteLineItemDto[];
}

export class UpdateQuoteDto {
  @IsOptional()
  @IsUUID()
  clientId?: string;

  @IsOptional()
  @IsUUID()
  opportunityId?: string | null;

  @IsOptional()
  @IsDateString()
  validUntil?: string;

  @IsOptional()
  @IsNumber({ allowInfinity: false, allowNaN: false })
  @Min(0)
  @Max(100)
  discountPercent?: number;

  @IsOptional()
  @IsString()
  @MaxLength(8)
  currency?: string;

  @IsOptional()
  @IsString()
  @MaxLength(5000)
  notes?: string;

  // Replacing the line items wholesale. If omitted, lines are left as-is.
  @IsOptional()
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => QuoteLineItemDto)
  lineItems?: QuoteLineItemDto[];
}

export class SendQuoteDto {
  @IsOptional()
  @IsEmail()
  recipientEmail?: string;
}

export class ListQuotesQueryDto {
  @IsOptional()
  @IsIn(['draft', 'sent', 'accepted', 'rejected', 'expired'])
  status?: string;

  @IsOptional()
  @IsUUID()
  clientId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  search?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(200)
  limit?: number;
}
