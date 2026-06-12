import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';

/**
 * Wave H3 — Bulk API DTOs.
 *
 * The per-entity create / update DTOs already live next to each
 * entity's service (`CreateClientDto`, `CreateLeadDto`, …). Those
 * are plain TS interfaces, NOT class-validator classes — so we can't
 * cleanly `@ValidateNested @Type(() => CreateClientDto)` on them.
 *
 * For the public bulk API we instead accept `Record<string, any>`
 * rows here and run targeted validation inside `BulkService`
 * (presence of `name` / `company`, `id` for updates, etc.) and
 * delegate field-level invariants to each entity service's own
 * create / update path. This is the same "trust the entity service"
 * contract used by csv-import (clients/leads), so the bulk DTO is
 * deliberately permissive on the row shape and strict on the
 * envelope (size cap, type discriminator, UUID lists).
 *
 * Row cap is 1000 per request — enforced here so a runaway client
 * gets a 400 before we even allocate the BulkOperation audit row.
 */

const ENTITY_TYPES = ['client', 'lead', 'opportunity', 'task'] as const;
export type BulkEntityType = (typeof ENTITY_TYPES)[number];

// ─── Create / Update / Delete envelopes ──────────────────────────

export class BulkCreateDto {
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(1000)
  rows!: Record<string, any>[];
}

/**
 * Update rows MUST carry an `id`. We accept anything else as a
 * partial body and let the per-entity update enforce its own field
 * invariants.
 */
export class BulkUpdateRow {
  @IsUUID()
  id!: string;
}

export class BulkUpdateDto {
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(1000)
  @ValidateNested({ each: true })
  @Type(() => BulkUpdateRow)
  rows!: Array<BulkUpdateRow & Record<string, any>>;
}

export class BulkDeleteDto {
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(1000)
  @IsUUID('all', { each: true })
  ids!: string[];
}

// ─── CSV import query params ─────────────────────────────────────

export class CsvImportQueryDto {
  @IsIn(ENTITY_TYPES as unknown as string[])
  entityType!: BulkEntityType;

  /**
   * Defaults to true — CSVs without a header are the exception.
   * Accepted as `?hasHeader=false` (string) from the query string.
   */
  @IsOptional()
  @IsBoolean()
  @Type(() => Boolean)
  hasHeader?: boolean;
}

// ─── Past-runs list query ────────────────────────────────────────

export class BulkOperationsListQueryDto {
  @IsOptional()
  @IsIn(ENTITY_TYPES as unknown as string[])
  entity_type?: BulkEntityType;
}

// ─── Internal — used by BulkService.return shape ─────────────────

export interface BulkResultSuccess {
  index: number;
  id: string;
}

export interface BulkResultFailure {
  index: number;
  error: string;
}

export interface BulkResult {
  /** ID of the audit row created in `bulk_operations`. */
  operationId: string;
  total: number;
  succeeded: BulkResultSuccess[];
  failed: BulkResultFailure[];
}

export const BULK_ENTITY_TYPES = ENTITY_TYPES;
export const BULK_ROW_CAP = 1000;
/** Cap on per-row errors persisted in `bulk_operations.errors_json`. */
export const BULK_ERRORS_SAMPLE_SIZE = 50;
