/**
 * Class-validator DTOs for Wave H1 — Field Service (work orders + dispatch).
 *
 * The Nest global `ValidationPipe` (apps/api/src/main.ts) only validates
 * @Body() / @Query() params that are decorated CLASSES — plain interfaces
 * are skipped. These DTOs reject malformed payloads at the HTTP boundary;
 * the service layer adds cross-tenant guards on every FK accepted from
 * input (clientId, opportunityId, technicianId, productId).
 *
 * Numeric `@Query` params come in as strings from URL parsing — the
 * `@Type(() => Number)` shims convert before validation runs.
 */
import {
  IsArray,
  IsDateString,
  IsIn,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';

// ─── Shared ──────────────────────────────────────────────────────

/**
 * One line on a work order. Lines are either 'service' (labor / time) or
 * 'part' (materials). `productId` is optional — ad-hoc lines without a
 * catalog product are allowed (free-form descriptions for one-off charges).
 *
 * `lineTotal` is NEVER trusted from the client — it's recomputed
 * server-side as `quantity * unitPrice`.
 */
export class WorkOrderLineItemDto {
  @IsIn(['service', 'part'])
  type!: 'service' | 'part';

  @IsOptional()
  @IsUUID()
  productId?: string;

  @IsString()
  @MaxLength(1000)
  description!: string;

  @IsNumber({ allowInfinity: false, allowNaN: false, maxDecimalPlaces: 2 })
  @Min(0)
  quantity!: number;

  @IsNumber({ allowInfinity: false, allowNaN: false, maxDecimalPlaces: 2 })
  @Min(0)
  unitPrice!: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  order?: number;
}

// ─── Create / Update ─────────────────────────────────────────────

export class CreateWorkOrderDto {
  @IsUUID()
  clientId!: string;

  @IsOptional()
  @IsUUID()
  opportunityId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  locationAddress?: string;

  @IsOptional()
  @IsDateString()
  scheduledStart?: string;

  @IsOptional()
  @IsDateString()
  scheduledEnd?: string;

  @IsOptional()
  @IsUUID()
  technicianId?: string;

  @IsOptional()
  @IsIn(['low', 'normal', 'high', 'urgent'])
  priority?: 'low' | 'normal' | 'high' | 'urgent';

  @IsOptional()
  @IsString()
  @MaxLength(5000)
  description?: string;

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => WorkOrderLineItemDto)
  lineItems?: WorkOrderLineItemDto[];
}

/**
 * Generic PUT update. Refuses ANY status field — status changes must use
 * the dedicated schedule / start / complete / cancel endpoints so the
 * status_history row is written atomically.
 *
 * `status` is intentionally NOT declared here so a stray request field
 * is stripped by `forbidNonWhitelisted: true` on the global
 * ValidationPipe (apps/api/src/main.ts). Belt-and-braces: the service
 * also refuses any explicit `status` field in the dto.
 */
export class UpdateWorkOrderDto {
  @IsOptional()
  @IsUUID()
  clientId?: string;

  @IsOptional()
  @IsUUID()
  opportunityId?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  locationAddress?: string;

  @IsOptional()
  @IsDateString()
  scheduledStart?: string;

  @IsOptional()
  @IsDateString()
  scheduledEnd?: string;

  @IsOptional()
  @IsUUID()
  technicianId?: string | null;

  @IsOptional()
  @IsIn(['low', 'normal', 'high', 'urgent'])
  priority?: 'low' | 'normal' | 'high' | 'urgent';

  @IsOptional()
  @IsString()
  @MaxLength(5000)
  description?: string;

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => WorkOrderLineItemDto)
  lineItems?: WorkOrderLineItemDto[];
}

// ─── Lifecycle DTOs ──────────────────────────────────────────────

export class ScheduleDto {
  @IsUUID()
  technicianId!: string;

  @IsDateString()
  scheduledStart!: string;

  @IsDateString()
  scheduledEnd!: string;
}

export class StatusTransitionDto {
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  notes?: string;
}

/**
 * Complete-work-order payload. The technician can optionally REPLACE the
 * line items with the actual materials used + labor performed on-site.
 * If `finalLineItems` is omitted, the existing lines stay as-is.
 */
export class CompleteWorkOrderDto extends StatusTransitionDto {
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => WorkOrderLineItemDto)
  finalLineItems?: WorkOrderLineItemDto[];
}

// ─── List / Query DTOs ──────────────────────────────────────────

const WORK_ORDER_STATUSES = [
  'draft',
  'scheduled',
  'in_progress',
  'completed',
  'cancelled',
] as const;

export class ListWorkOrdersQueryDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number;

  @IsOptional()
  @IsIn(WORK_ORDER_STATUSES as unknown as string[])
  status?: string;

  @IsOptional()
  @IsUUID()
  technicianId?: string;

  @IsOptional()
  @IsUUID()
  clientId?: string;

  @IsOptional()
  @IsDateString()
  startAfter?: string;

  @IsOptional()
  @IsDateString()
  startBefore?: string;
}

// ─── Dispatch DTOs ──────────────────────────────────────────────

export class DispatchBoardQueryDto {
  @IsDateString()
  from!: string;

  @IsDateString()
  to!: string;

  @IsOptional()
  @IsUUID()
  technicianId?: string;
}

export class TechnicianScheduleQueryDto {
  @IsDateString()
  from!: string;

  @IsDateString()
  to!: string;
}

export class AvailabilityQueryDto {
  @IsDateString()
  from!: string;

  @IsDateString()
  to!: string;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  durationMinutes!: number;
}
