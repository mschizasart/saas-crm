/**
 * Class-validator DTOs for the Wave E1 approval workflows.
 *
 * The Nest global `ValidationPipe` (configured in apps/api/src/main.ts)
 * only validates @Body() params that are decorated CLASSES — plain TS
 * interfaces are skipped. These DTOs reject malformed bodies at the HTTP
 * boundary; the service layer adds belt-and-braces cross-tenant guards
 * on every FK accepted from input (processId, approverUserId,
 * approverRoleId).
 */
import {
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsObject,
  IsOptional,
  IsString,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';

export const ENTITY_TYPES = ['invoice', 'opportunity', 'expense', 'custom'] as const;
export type EntityType = (typeof ENTITY_TYPES)[number];

export const APPROVER_TYPES = ['user', 'role', 'manager'] as const;
export type ApproverType = (typeof APPROVER_TYPES)[number];

export const DECISIONS = ['approve', 'reject'] as const;
export type Decision = (typeof DECISIONS)[number];

// ─── Process steps ─────────────────────────────────────────────────

export class CreateStepDto {
  @IsInt()
  @Min(0)
  order!: number;

  @IsString()
  @IsIn(APPROVER_TYPES as unknown as string[])
  approverType!: ApproverType;

  // Required when approverType === 'user'. Cross-tenant validation
  // (user belongs to the same org) happens in the service.
  @IsOptional()
  @IsString()
  @MaxLength(64)
  approverUserId?: string;

  // Required when approverType === 'role'. Cross-tenant validation
  // (role belongs to the same org) happens in the service.
  @IsOptional()
  @IsString()
  @MaxLength(64)
  approverRoleId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  name?: string;
}

// ─── Processes ─────────────────────────────────────────────────────

export class CreateProcessDto {
  @IsString()
  @MaxLength(255)
  name!: string;

  @IsString()
  @IsIn(ENTITY_TYPES as unknown as string[])
  entityType!: EntityType;

  // {field, op, value} — empty object means "always require approval".
  // Engine-side coercion is deferred (this slice does not yet trigger
  // requests from invoice/expense subsystems; the requester subsystem
  // will evaluate this when it wires up).
  @IsOptional()
  @IsObject()
  triggerCondition?: Record<string, unknown>;

  @IsOptional()
  @IsBoolean()
  active?: boolean;

  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => CreateStepDto)
  steps!: CreateStepDto[];
}

export class UpdateProcessDto {
  @IsOptional()
  @IsString()
  @MaxLength(255)
  name?: string;

  @IsOptional()
  @IsString()
  @IsIn(ENTITY_TYPES as unknown as string[])
  entityType?: EntityType;

  @IsOptional()
  @IsObject()
  triggerCondition?: Record<string, unknown>;

  @IsOptional()
  @IsBoolean()
  active?: boolean;

  // When present, REPLACES the existing step set (the service deletes
  // the old steps and inserts the new ones inside a single transaction).
  @IsOptional()
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => CreateStepDto)
  steps?: CreateStepDto[];
}

// ─── Requests ──────────────────────────────────────────────────────

export class CreateRequestDto {
  @IsString()
  @MaxLength(64)
  processId!: string;

  @IsString()
  @MaxLength(64)
  targetType!: string;

  @IsString()
  @MaxLength(64)
  targetId!: string;
}

export class DecisionDto {
  @IsString()
  @IsIn(DECISIONS as unknown as string[])
  decision!: Decision;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  comment?: string;
}
