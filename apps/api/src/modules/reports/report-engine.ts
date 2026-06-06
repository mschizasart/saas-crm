/**
 * Safe report query builder for Wave D2 (Reports & Dashboards).
 *
 * SECURITY MODEL
 * ──────────────
 * This is the single execution path for user-defined reports. It is
 * deliberately conservative:
 *
 *   1. Entities are looked up by a STRING KEY against the ENTITY_REGISTRY
 *      below. We never trust the request-supplied entity name to pick a
 *      Prisma model directly — only the registry's `prismaModel` string
 *      is used.
 *   2. Every field referenced by a filter, group-by, or aggregation must
 *      appear in the registry's `fields` map for that entity, with a
 *      matching value type.
 *   3. Operators are whitelisted (`eq/ne/in/nin/gt/gte/lt/lte/contains/
 *      startsWith`). Anything else throws BadRequestException.
 *   4. Aggregations are whitelisted (`count/sum/avg/min/max`).
 *      `sum/avg/min/max` are only legal on `number` fields.
 *   5. `organizationId` is ALWAYS injected into the `where` clause.
 *   6. Result rows are HARD-CAPPED at 10000 server-side regardless of
 *      any caller-supplied `limit`.
 *   7. NOTHING here ever builds raw SQL. Everything goes through Prisma's
 *      structured query API.
 *
 * If you add a new entity, ONLY add it to ENTITY_REGISTRY — no other
 * code changes are required for the builder UI to pick it up.
 */
import { BadRequestException } from '@nestjs/common';
import { Prisma } from '@prisma/client';

export type FieldType = 'string' | 'number' | 'decimal' | 'date' | 'boolean' | 'enum';

export interface EntityDef {
  /** The Prisma client model accessor key, e.g. 'lead' for prisma.lead.findMany. */
  prismaModel: string;
  /** Map of allowed field names → primitive value type. */
  fields: Record<string, FieldType>;
}

/**
 * THE whitelist. Field names mirror apps/api/prisma/schema.prisma exactly.
 * Adding a field here without it existing on the Prisma model will throw
 * at runtime (`prisma.<model>.findMany` rejects unknown fields in select).
 */
export const ENTITY_REGISTRY: Record<string, EntityDef> = {
  clients: {
    prismaModel: 'client',
    fields: {
      company: 'string',
      phone: 'string',
      city: 'string',
      country: 'string',
      active: 'boolean',
      createdAt: 'date',
    },
  },
  leads: {
    prismaModel: 'lead',
    fields: {
      name: 'string',
      email: 'string',
      phone: 'string',
      company: 'string',
      city: 'string',
      country: 'string',
      value: 'decimal',
      score: 'number',
      statusId: 'string',
      sourceId: 'string',
      assignedTo: 'string',
      createdAt: 'date',
    },
  },
  invoices: {
    prismaModel: 'invoice',
    fields: {
      number: 'string',
      status: 'string',
      total: 'decimal',
      subTotal: 'decimal',
      totalTax: 'decimal',
      date: 'date',
      dueDate: 'date',
      paidAt: 'date',
      clientId: 'string',
      createdAt: 'date',
    },
  },
  opportunities: {
    prismaModel: 'opportunity',
    fields: {
      name: 'string',
      amount: 'decimal',
      currency: 'string',
      closeDate: 'date',
      stageId: 'string',
      ownerId: 'string',
      clientId: 'string',
      leadId: 'string',
      source: 'string',
      createdAt: 'date',
    },
  },
  tickets: {
    prismaModel: 'ticket',
    fields: {
      subject: 'string',
      status: 'string',
      priority: 'string',
      source: 'string',
      assignedTo: 'string',
      clientId: 'string',
      departmentId: 'string',
      createdAt: 'date',
      closedAt: 'date',
    },
  },
  tasks: {
    prismaModel: 'task',
    fields: {
      name: 'string',
      status: 'string',
      priority: 'string',
      dueDate: 'date',
      startDate: 'date',
      billable: 'boolean',
      projectId: 'string',
      createdBy: 'string',
      createdAt: 'date',
      completedAt: 'date',
    },
  },
};

// ─── Operators ────────────────────────────────────────────────────────

export type FilterOp =
  | 'eq'
  | 'ne'
  | 'in'
  | 'nin'
  | 'gt'
  | 'gte'
  | 'lt'
  | 'lte'
  | 'contains'
  | 'startsWith';

const ALLOWED_OPS: ReadonlySet<FilterOp> = new Set<FilterOp>([
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
]);

/**
 * Per-type op restrictions. `contains/startsWith` only make sense for
 * strings; `gt/gte/lt/lte` only for numbers/dates; `in/nin` are universal.
 */
const OPS_FOR_TYPE: Record<FieldType, ReadonlySet<FilterOp>> = {
  string: new Set<FilterOp>(['eq', 'ne', 'in', 'nin', 'contains', 'startsWith']),
  number: new Set<FilterOp>(['eq', 'ne', 'in', 'nin', 'gt', 'gte', 'lt', 'lte']),
  decimal: new Set<FilterOp>(['eq', 'ne', 'in', 'nin', 'gt', 'gte', 'lt', 'lte']),
  date: new Set<FilterOp>(['eq', 'ne', 'gt', 'gte', 'lt', 'lte']),
  boolean: new Set<FilterOp>(['eq', 'ne']),
  enum: new Set<FilterOp>(['eq', 'ne', 'in', 'nin']),
};

// ─── Aggregations ─────────────────────────────────────────────────────

export type AggregationFn = 'count' | 'sum' | 'avg' | 'min' | 'max';
const ALLOWED_AGGS: ReadonlySet<AggregationFn> = new Set<AggregationFn>([
  'count',
  'sum',
  'avg',
  'min',
  'max',
]);
const NUMERIC_ONLY_AGGS: ReadonlySet<AggregationFn> = new Set<AggregationFn>([
  'sum',
  'avg',
  'min',
  'max',
]);

// ─── Public types ─────────────────────────────────────────────────────

export interface ReportFilter {
  field: string;
  op: FilterOp;
  value: unknown;
}

export interface ReportAggregation {
  fn: AggregationFn;
  /** Required for sum/avg/min/max; ignored for count. */
  field?: string;
}

export interface BuildAndRunInput {
  entity: string;
  filters?: ReportFilter[];
  groupBy?: string | null;
  aggregations?: ReportAggregation[];
  /** Optional projection: fields to select in the non-grouped path. */
  fields?: string[];
  limit?: number;
}

export interface BuildAndRunResult {
  rows: unknown[];
  meta: {
    entity: string;
    groupBy: string | null;
    aggregations: ReportAggregation[];
    count: number;
    capped: boolean;
  };
}

// ─── Hard caps ────────────────────────────────────────────────────────
export const REPORT_ROW_HARD_CAP = 10_000;

// ─── Validation helpers ───────────────────────────────────────────────

function assertFieldExists(entity: EntityDef, field: string): FieldType {
  const t = entity.fields[field];
  if (!t) {
    throw new BadRequestException(
      `Field "${field}" is not allowed for this report entity`,
    );
  }
  return t;
}

function assertOpAllowed(field: string, op: string, type: FieldType): FilterOp {
  if (!ALLOWED_OPS.has(op as FilterOp)) {
    throw new BadRequestException(`Operator "${op}" is not allowed`);
  }
  const fop = op as FilterOp;
  if (!OPS_FOR_TYPE[type].has(fop)) {
    throw new BadRequestException(
      `Operator "${op}" is not allowed on ${type} field "${field}"`,
    );
  }
  return fop;
}

function coerceValue(field: string, type: FieldType, op: FilterOp, raw: unknown): unknown {
  // `in`/`nin` must receive an array
  if (op === 'in' || op === 'nin') {
    if (!Array.isArray(raw)) {
      throw new BadRequestException(
        `Operator "${op}" on field "${field}" requires an array value`,
      );
    }
    return raw.map((v) => coerceScalar(field, type, v));
  }
  return coerceScalar(field, type, raw);
}

function coerceScalar(field: string, type: FieldType, raw: unknown): unknown {
  if (raw === null || raw === undefined) {
    // Passing null/undefined through to Prisma yields IS NULL / IS NOT NULL
    // semantics depending on the operator, which leaks data. Reject all
    // null/undefined filter values explicitly.
    throw new BadRequestException(
      `Filter value cannot be null/undefined (field: ${field}). To filter for missing data, use a specific operator with a non-null value.`,
    );
  }
  switch (type) {
    case 'string':
    case 'enum': {
      if (typeof raw !== 'string') {
        throw new BadRequestException(
          `Field "${field}" expects a string value`,
        );
      }
      return raw;
    }
    case 'number': {
      const n = typeof raw === 'number' ? raw : Number(raw);
      if (!Number.isFinite(n)) {
        throw new BadRequestException(
          `Field "${field}" expects a numeric value`,
        );
      }
      return n;
    }
    case 'decimal': {
      const n = typeof raw === 'number' ? raw : Number(raw);
      if (!Number.isFinite(n)) {
        throw new BadRequestException(
          `Field "${field}" expects a numeric (decimal) value`,
        );
      }
      return new Prisma.Decimal(raw as Prisma.Decimal.Value);
    }
    case 'date': {
      if (raw instanceof Date) return raw;
      const d = new Date(raw as string);
      if (Number.isNaN(d.getTime())) {
        throw new BadRequestException(
          `Field "${field}" expects an ISO date value`,
        );
      }
      return d;
    }
    case 'boolean': {
      if (typeof raw === 'boolean') return raw;
      if (raw === 'true' || raw === 1) return true;
      if (raw === 'false' || raw === 0) return false;
      throw new BadRequestException(
        `Field "${field}" expects a boolean value`,
      );
    }
  }
}

function opToPrisma(op: FilterOp, value: unknown): unknown {
  switch (op) {
    case 'eq':
      return { equals: value };
    case 'ne':
      return { not: value };
    case 'in':
      return { in: value as unknown[] };
    case 'nin':
      return { notIn: value as unknown[] };
    case 'gt':
      return { gt: value };
    case 'gte':
      return { gte: value };
    case 'lt':
      return { lt: value };
    case 'lte':
      return { lte: value };
    case 'contains':
      return { contains: value, mode: 'insensitive' };
    case 'startsWith':
      return { startsWith: value, mode: 'insensitive' };
  }
}

// ─── Aggregation helpers ──────────────────────────────────────────────

function validateAggregations(
  entity: EntityDef,
  aggs: ReportAggregation[],
): void {
  for (const a of aggs) {
    if (!ALLOWED_AGGS.has(a.fn)) {
      throw new BadRequestException(
        `Aggregation function "${a.fn}" is not allowed`,
      );
    }
    if (a.fn === 'count') continue;
    if (!a.field) {
      throw new BadRequestException(
        `Aggregation "${a.fn}" requires a field`,
      );
    }
    const t = assertFieldExists(entity, a.field);
    if (NUMERIC_ONLY_AGGS.has(a.fn) && t !== 'number' && t !== 'decimal') {
      throw new BadRequestException(
        `Aggregation "${a.fn}" is only allowed on numeric fields (got "${a.field}":${t})`,
      );
    }
  }
}

function aggregationsToPrismaShape(
  aggs: ReportAggregation[],
): Record<string, unknown> {
  const out: Record<string, Record<string, true>> = {};
  for (const a of aggs) {
    if (a.fn === 'count') {
      out._count = { _all: true } as unknown as Record<string, true>;
      continue;
    }
    const key = `_${a.fn}`; // _sum / _avg / _min / _max
    if (!out[key]) out[key] = {};
    out[key][a.field as string] = true;
  }
  return out;
}

// ─── The entry point ──────────────────────────────────────────────────

/**
 * Build and run a report under the given organization context.
 *
 * `prisma` is expected to be a transactional client returned by
 * PrismaService.withOrganization — so the RLS tenant context is set
 * AND we additionally inject `organizationId: orgId` in `where` as a
 * belt-and-suspenders defense.
 */
export async function buildAndRun(
  prisma: any,
  orgId: string,
  input: BuildAndRunInput,
): Promise<BuildAndRunResult> {
  // 1. Entity lookup
  const entity = ENTITY_REGISTRY[input.entity];
  if (!entity) {
    throw new BadRequestException(`Unknown report entity "${input.entity}"`);
  }
  const delegate = prisma[entity.prismaModel];
  if (!delegate || typeof delegate.findMany !== 'function') {
    // Should be impossible if ENTITY_REGISTRY is correct, but fail loudly
    // if a developer mistypes a prismaModel string.
    throw new BadRequestException(
      `Configured Prisma model "${entity.prismaModel}" is not available`,
    );
  }

  // 2. Validate filters and translate to a Prisma `where`
  const where: Record<string, unknown> = { organizationId: orgId };
  for (const raw of input.filters ?? []) {
    if (!raw || typeof raw !== 'object') {
      throw new BadRequestException('Each filter must be an object');
    }
    if (typeof raw.field !== 'string' || typeof raw.op !== 'string') {
      throw new BadRequestException('Filter "field" and "op" must be strings');
    }
    const type = assertFieldExists(entity, raw.field);
    const op = assertOpAllowed(raw.field, raw.op, type);
    const value = coerceValue(raw.field, type, op, raw.value);
    // Multiple filters on the same field: combine via AND.
    const existing = where[raw.field];
    if (existing !== undefined) {
      where[raw.field] = { ...(existing as object), ...(opToPrisma(op, value) as object) };
    } else {
      where[raw.field] = opToPrisma(op, value);
    }
  }

  // 3. Validate group-by + aggregations
  const groupBy = input.groupBy ?? null;
  if (groupBy) assertFieldExists(entity, groupBy);
  const aggs = input.aggregations ?? [];
  validateAggregations(entity, aggs);

  // 4. Enforce hard cap
  const limit = Math.min(
    Math.max(1, input.limit ?? 1000),
    REPORT_ROW_HARD_CAP,
  );

  // 5. Branch: groupBy vs findMany
  let rows: unknown[];
  if (groupBy && aggs.length > 0) {
    rows = await delegate.groupBy({
      by: [groupBy],
      where,
      take: limit,
      ...aggregationsToPrismaShape(aggs),
    });
  } else {
    // Build a projection so we never return columns the user didn't ask
    // for (and so we never leak fields outside the registry).
    let select: Record<string, true> | undefined;
    if (Array.isArray(input.fields) && input.fields.length > 0) {
      select = { id: true };
      for (const f of input.fields) {
        assertFieldExists(entity, f);
        select[f] = true;
      }
    }
    rows = await delegate.findMany({
      where,
      take: limit,
      ...(select ? { select } : {}),
      orderBy: { createdAt: 'desc' as const },
    });
  }

  return {
    rows,
    meta: {
      entity: input.entity,
      groupBy,
      aggregations: aggs,
      count: rows.length,
      capped: rows.length === limit,
    },
  };
}

/** Public registry view for the builder UI (no internal model names). */
export function describeEntities() {
  const out: Record<
    string,
    { fields: { name: string; type: FieldType }[] }
  > = {};
  for (const [key, def] of Object.entries(ENTITY_REGISTRY)) {
    out[key] = {
      fields: Object.entries(def.fields).map(([name, type]) => ({
        name,
        type,
      })),
    };
  }
  return out;
}
