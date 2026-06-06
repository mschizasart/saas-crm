/**
 * Class-validator DTOs for the Wave D2 reports & dashboards builder.
 *
 * The Nest global `ValidationPipe` (configured in apps/api/src/main.ts)
 * only validates @Body() params that are decorated CLASSES — plain TS
 * interfaces are skipped. These DTOs replace the previous interfaces so
 * the endpoints actually reject malformed bodies at the HTTP boundary.
 */
import {
  IsArray,
  IsIn,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  Max,
  Min,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';

export const CHART_TYPES = ['table', 'bar', 'line', 'pie'] as const;
export type ChartType = (typeof CHART_TYPES)[number];

export const FILTER_OPS = [
  'eq',
  'ne',
  'in',
  'nin',
  'gt',
  'gte',
  'lt',
  'lte',
  'contains',
  'startsWith',
] as const;

export const AGG_FNS = ['count', 'sum', 'avg', 'min', 'max'] as const;

// ─── Filters / aggregations ───────────────────────────────────────

export class ReportFilterDto {
  @IsString()
  @MaxLength(120)
  field!: string;

  @IsString()
  @IsIn(FILTER_OPS as unknown as string[])
  op!: (typeof FILTER_OPS)[number];

  // `value` may be a string / number / boolean / array; class-validator
  // can't usefully constrain that without losing flexibility. The engine
  // layer (`coerceScalar` in report-engine.ts) performs the real
  // type-and-shape checks and throws BadRequestException on mismatch.
  value!: unknown;
}

export class ReportAggregationDto {
  @IsString()
  @IsIn(AGG_FNS as unknown as string[])
  fn!: (typeof AGG_FNS)[number];

  @IsOptional()
  @IsString()
  @MaxLength(120)
  field?: string;
}

// ─── Reports ──────────────────────────────────────────────────────

export class CreateReportDto {
  @IsString()
  @MaxLength(255)
  name!: string;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  description?: string;

  @IsString()
  @MaxLength(120)
  entityType!: string;

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ReportFilterDto)
  filters?: ReportFilterDto[];

  @IsOptional()
  @IsString()
  @MaxLength(120)
  groupBy?: string | null;

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ReportAggregationDto)
  aggregations?: ReportAggregationDto[];

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  fields?: string[];

  @IsOptional()
  @IsString()
  @IsIn(CHART_TYPES as unknown as string[])
  chartType?: ChartType;
}

export class UpdateReportDto {
  @IsOptional()
  @IsString()
  @MaxLength(255)
  name?: string;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  description?: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  entityType?: string;

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ReportFilterDto)
  filters?: ReportFilterDto[];

  @IsOptional()
  @IsString()
  @MaxLength(120)
  groupBy?: string | null;

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ReportAggregationDto)
  aggregations?: ReportAggregationDto[];

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  fields?: string[];

  @IsOptional()
  @IsString()
  @IsIn(CHART_TYPES as unknown as string[])
  chartType?: ChartType;
}

// ─── Dashboards ───────────────────────────────────────────────────

export class CreateDashboardDto {
  @IsString()
  @MaxLength(255)
  name!: string;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  description?: string;

  @IsOptional()
  @IsArray()
  layout?: unknown[];
}

export class UpdateDashboardDto {
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
  layout?: unknown[];
}

// ─── Widgets ──────────────────────────────────────────────────────

export class WidgetPositionDto {
  @IsInt()
  @Min(0)
  @Max(1000)
  x!: number;

  @IsInt()
  @Min(0)
  @Max(1000)
  y!: number;

  @IsInt()
  @Min(0)
  @Max(1000)
  w!: number;

  @IsInt()
  @Min(0)
  @Max(1000)
  h!: number;
}

export class CreateWidgetDto {
  @IsUUID()
  reportId!: string;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  title?: string;

  @IsOptional()
  @ValidateNested()
  @Type(() => WidgetPositionDto)
  position?: WidgetPositionDto;
}

export class UpdateWidgetDto {
  @IsOptional()
  @IsString()
  @MaxLength(255)
  title?: string;

  @IsOptional()
  @ValidateNested()
  @Type(() => WidgetPositionDto)
  position?: WidgetPositionDto;
}
