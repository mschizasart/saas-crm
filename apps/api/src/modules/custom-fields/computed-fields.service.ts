import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service';

/**
 * Custom Fields v2 — COMPUTED field resolution (READ-ONLY).
 *
 * Resolves the value of `formula`, `lookup`, and `rollup` custom fields on
 * the fly when an entity's custom field values are fetched. Computed fields
 * are NEVER persisted as user input — they are derived on read and returned
 * with `computed: true`.
 *
 * ── SECURITY ────────────────────────────────────────────────────────────
 * Formula evaluation does NOT use eval / new Function / vm / any dynamic JS
 * execution. Expressions are tokenized, validated against a strict grammar
 * (numbers, identifiers, the operators + - * / and parentheses ONLY) and
 * evaluated by a hand-rolled shunting-yard parser + RPN walker. Identifiers
 * can ONLY resolve to a closed set of variables (sibling custom-field values
 * + a per-entity whitelist of the entity's own numeric columns). There is no
 * function-call, property-access, or string-literal syntax — anything that
 * isn't pure arithmetic over known variables is rejected.
 *
 * Lookup/rollup are scoped to the org via PrismaService.withOrganization
 * (RLS) AND an explicit organizationId filter. Only same-org related/child
 * records are ever read.
 */

// ── Whitelisted numeric columns the formula may reference on the OWN entity ──
// Keyed by fieldTo (CustomField.fieldTo). These are read directly off the
// entity row and exposed to the formula as variables. Only safe numeric
// columns are listed — nothing else is reachable from a formula.
const OWN_NUMERIC_COLUMNS: Record<string, string[]> = {
  invoice: ['subTotal', 'discount', 'adjustment', 'total', 'totalTax'],
  estimate: ['subTotal', 'discount', 'adjustment', 'total', 'totalTax'],
  proposal: ['total'],
  lead: ['value', 'score'],
  project: ['fixedRate', 'hourlyRate', 'progress', 'estimatedHours'],
  task: ['hourlyRate', 'estimatedHours'],
  contract: ['value'],
};

// ── Lookup whitelist ──────────────────────────────────────────────────────
// For each entity (fieldTo), the relations a lookup may traverse and, for
// each relation, the related Prisma model + the columns that may be read.
// relType is the polymorphic key matched against CustomFieldValue.relType.
interface LookupRelationDef {
  // Prisma delegate name on the tx client, e.g. 'client'.
  model: string;
  // Foreign-key column on the OWN entity row pointing at the related record.
  fkColumn: string;
  // Columns that may be read off the related record.
  fields: string[];
}
const LOOKUP_RELATIONS: Record<string, Record<string, LookupRelationDef>> = {
  invoice: {
    client: {
      model: 'client',
      fkColumn: 'clientId',
      fields: ['company', 'vat', 'phone', 'website', 'city', 'country', 'registrationNumber'],
    },
  },
  estimate: {
    client: {
      model: 'client',
      fkColumn: 'clientId',
      fields: ['company', 'vat', 'phone', 'website', 'city', 'country'],
    },
  },
  proposal: {
    client: { model: 'client', fkColumn: 'clientId', fields: ['company', 'vat', 'phone'] },
  },
  project: {
    client: { model: 'client', fkColumn: 'clientId', fields: ['company', 'vat', 'phone', 'country'] },
  },
  ticket: {
    client: { model: 'client', fkColumn: 'clientId', fields: ['company', 'vat', 'phone'] },
  },
  contract: {
    client: { model: 'client', fkColumn: 'clientId', fields: ['company', 'vat', 'phone'] },
  },
  task: {
    project: { model: 'project', fkColumn: 'projectId', fields: ['name', 'status', 'progress'] },
  },
};

// ── Rollup whitelist ──────────────────────────────────────────────────────
// For each entity (fieldTo), the child relations a rollup may aggregate over.
interface RollupRelationDef {
  // Prisma delegate name for the CHILD model, e.g. 'invoice'.
  model: string;
  // Column on the CHILD model that points back at the OWN entity.
  parentColumn: string;
  // Numeric columns that may be aggregated (sum/avg/min/max). `count` needs none.
  fields: string[];
}
const ROLLUP_RELATIONS: Record<string, Record<string, RollupRelationDef>> = {
  client: {
    invoices: { model: 'invoice', parentColumn: 'clientId', fields: ['total', 'subTotal', 'totalTax'] },
    estimates: { model: 'estimate', parentColumn: 'clientId', fields: ['total', 'subTotal'] },
    projects: { model: 'project', parentColumn: 'clientId', fields: ['fixedRate', 'progress'] },
    payments: { model: 'payment', parentColumn: 'clientId', fields: ['amount'] },
  },
  project: {
    tasks: { model: 'task', parentColumn: 'projectId', fields: ['estimatedHours'] },
    expenses: { model: 'expense', parentColumn: 'projectId', fields: ['amount'] },
  },
  invoice: {
    payments: { model: 'payment', parentColumn: 'invoiceId', fields: ['amount'] },
    items: { model: 'invoiceItem', parentColumn: 'invoiceId', fields: ['qty', 'rate'] },
  },
};

const ROLLUP_OPS = ['sum', 'count', 'avg', 'min', 'max'] as const;
type RollupOp = (typeof ROLLUP_OPS)[number];

export interface ComputedFieldResult {
  value: string | number | null;
  computed: true;
  fieldKind: 'formula' | 'lookup' | 'rollup';
  error?: string;
}

@Injectable()
export class ComputedFieldsService {
  private readonly logger = new Logger(ComputedFieldsService.name);

  constructor(private prisma: PrismaService) {}

  /**
   * TENANT ISOLATION GATE.
   *
   * Verify the OWN entity (`entityType`/`entityId`) belongs to `orgId` before
   * any value read / computed resolution. `entityId` arrives from the URL and
   * is otherwise unvalidated; a forged cross-org id must never reach a
   * resolver. This single check is the isolation guarantee for rollups over
   * org-less child tables (e.g. invoiceItem): if the parent is proven same-org,
   * its children are too, so scoping the children by the parent FK is safe.
   *
   * Returns true when the entity exists in the caller's org, false otherwise.
   * Unknown/unsupported entity types return false (no resolution possible).
   */
  async ownEntityBelongsToOrg(
    orgId: string,
    entityType: string,
    entityId: string,
  ): Promise<boolean> {
    const delegate = ENTITY_DELEGATES[entityType];
    if (!delegate || !entityId) return false;
    const found = await this.prisma.withOrganization(orgId, async (tx) => {
      return (tx as any)[delegate].findFirst({
        where: { id: entityId, organizationId: orgId },
        select: { id: true },
      });
    });
    return !!found;
  }

  /**
   * Resolve a single computed custom field for an entity instance.
   *
   * @param orgId         tenant org id (RLS scope)
   * @param entityType    CustomField.fieldTo (e.g. "invoice")
   * @param entityId      the entity row id
   * @param customField   the CustomField metadata row (fieldKind + config)
   * @param siblingValues map of OTHER custom field slug -> raw string value
   *                      for the same entity (used as formula variables)
   */
  async resolveComputed(
    orgId: string,
    entityType: string,
    entityId: string,
    customField: any,
    siblingValues: Record<string, string | null>,
  ): Promise<ComputedFieldResult> {
    const kind = customField?.fieldKind;
    try {
      if (kind === 'formula') {
        return {
          computed: true,
          fieldKind: 'formula',
          value: await this.resolveFormula(orgId, entityType, entityId, customField, siblingValues),
        };
      }
      if (kind === 'lookup') {
        return {
          computed: true,
          fieldKind: 'lookup',
          value: await this.resolveLookup(orgId, entityType, entityId, customField),
        };
      }
      if (kind === 'rollup') {
        return {
          computed: true,
          fieldKind: 'rollup',
          value: await this.resolveRollup(orgId, entityType, entityId, customField),
        };
      }
      // Not a computed field — caller should not reach here.
      return { computed: true, fieldKind: 'formula', value: null };
    } catch (err: any) {
      // Computed fields must never break the entity fetch. Surface a null
      // value plus an error string for the UI; log server-side.
      this.logger.warn(
        `Computed field "${customField?.slug}" (${kind}) failed for ${entityType}/${entityId}: ${err?.message}`,
      );
      // Return a GENERIC error to the client — `err.message` may leak Prisma
      // table/column names. The full detail is logged server-side above.
      return {
        computed: true,
        fieldKind: (kind ?? 'formula') as any,
        value: null,
        error: 'computation failed',
      };
    }
  }

  // ── FORMULA ───────────────────────────────────────────────────────────

  private async resolveFormula(
    orgId: string,
    entityType: string,
    entityId: string,
    customField: any,
    siblingValues: Record<string, string | null>,
  ): Promise<number | null> {
    const expr: string = customField?.formulaExpr ?? '';
    if (!expr || !expr.trim()) return null;

    // Build the variable scope: sibling custom-field values (numeric coercion)
    // + the entity's own whitelisted numeric columns. Use a null-prototype
    // object so no inherited property (e.g. "constructor", "toString") can be
    // resolved as a formula variable — belt-and-suspenders on top of the
    // hasOwnProperty guard in evalRpn.
    const scope: Record<string, number> = Object.create(null);
    for (const [slug, raw] of Object.entries(siblingValues)) {
      scope[slug] = toNumber(raw);
    }
    const ownCols = OWN_NUMERIC_COLUMNS[entityType];
    if (ownCols && ownCols.length > 0) {
      const row = await this.loadOwnNumericColumns(orgId, entityType, entityId, ownCols);
      for (const col of ownCols) {
        scope[col] = toNumber(row?.[col]);
      }
    }

    return evaluateFormula(expr, scope);
  }

  /** Load only the whitelisted numeric columns off the OWN entity row. */
  private async loadOwnNumericColumns(
    orgId: string,
    entityType: string,
    entityId: string,
    columns: string[],
  ): Promise<Record<string, any> | null> {
    const delegate = ENTITY_DELEGATES[entityType];
    if (!delegate) return null;
    const select: Record<string, true> = {};
    for (const c of columns) select[c] = true;
    return this.prisma.withOrganization(orgId, async (tx) => {
      return (tx as any)[delegate].findFirst({
        where: { id: entityId, organizationId: orgId },
        select,
      });
    });
  }

  // ── LOOKUP ──────────────────────────────────────────────────────────────

  private async resolveLookup(
    orgId: string,
    entityType: string,
    entityId: string,
    customField: any,
  ): Promise<string | number | null> {
    const cfg = customField?.lookupConfig ?? {};
    const relationName: string = cfg.relation;
    const field: string = cfg.field;
    if (!relationName || !field) {
      throw new Error('lookup config requires { relation, field }');
    }

    const relDef = LOOKUP_RELATIONS[entityType]?.[relationName];
    if (!relDef) {
      throw new Error(`lookup relation "${relationName}" not allowed for ${entityType}`);
    }
    if (!relDef.fields.includes(field)) {
      throw new Error(`lookup field "${field}" not allowed on relation "${relationName}"`);
    }

    const ownDelegate = ENTITY_DELEGATES[entityType];
    if (!ownDelegate) throw new Error(`unknown entity "${entityType}"`);

    return this.prisma.withOrganization(orgId, async (tx) => {
      // Read the FK off the own (same-org) row.
      const own = await (tx as any)[ownDelegate].findFirst({
        where: { id: entityId, organizationId: orgId },
        select: { [relDef.fkColumn]: true },
      });
      const relatedId = own?.[relDef.fkColumn];
      if (!relatedId) return null;

      // Read the configured field off the related (same-org) record.
      const related = await (tx as any)[relDef.model].findFirst({
        where: { id: relatedId, organizationId: orgId },
        select: { [field]: true },
      });
      const val = related?.[field];
      return normalizeScalar(val);
    });
  }

  // ── ROLLUP ────────────────────────────────────────────────────────────

  private async resolveRollup(
    orgId: string,
    entityType: string,
    entityId: string,
    customField: any,
  ): Promise<number | null> {
    const cfg = customField?.rollupConfig ?? {};
    const relationName: string = cfg.relation;
    const op: RollupOp = cfg.op;
    const field: string | undefined = cfg.field;

    if (!relationName) throw new Error('rollup config requires { relation }');
    if (!ROLLUP_OPS.includes(op)) {
      throw new Error(`rollup op "${op}" not allowed`);
    }

    const relDef = ROLLUP_RELATIONS[entityType]?.[relationName];
    if (!relDef) {
      throw new Error(`rollup relation "${relationName}" not allowed for ${entityType}`);
    }

    // count needs no field; sum/avg/min/max require a whitelisted numeric field.
    if (op !== 'count') {
      if (!field) throw new Error(`rollup op "${op}" requires a field`);
      if (!relDef.fields.includes(field)) {
        throw new Error(`rollup field "${field}" not allowed on relation "${relationName}"`);
      }
    }

    return this.prisma.withOrganization(orgId, async (tx) => {
      const delegate = (tx as any)[relDef.model];
      // Same-org filter on the child set. Some child models (e.g. invoiceItem)
      // have no organizationId column; for those we scope solely by the parent
      // FK, which itself can only point at a same-org parent (the parent row
      // was already org-validated and RLS is active).
      const where: Record<string, any> = { [relDef.parentColumn]: entityId };
      if (CHILD_HAS_ORG_COLUMN[relDef.model] !== false) {
        where.organizationId = orgId;
      }

      if (op === 'count') {
        const n = await delegate.count({ where });
        return Number(n);
      }

      const agg = await delegate.aggregate({
        where,
        [`_${op}`]: { [field as string]: true },
      });
      const raw = agg?.[`_${op}`]?.[field as string];
      if (raw === null || raw === undefined) return op === 'avg' ? null : 0;
      return toNumber(raw);
    });
  }
}

/**
 * Metadata describing the computed-field options available for an entity,
 * for the admin field-builder UI. Single source of truth = the whitelists
 * above, so the UI can only ever offer relations/fields the resolver allows.
 */
export function getComputedFieldMeta(entityType: string) {
  const lookups = LOOKUP_RELATIONS[entityType] ?? {};
  const rollups = ROLLUP_RELATIONS[entityType] ?? {};
  return {
    entityType,
    ownNumericColumns: OWN_NUMERIC_COLUMNS[entityType] ?? [],
    lookupRelations: Object.entries(lookups).map(([relation, def]) => ({
      relation,
      fields: def.fields,
    })),
    rollupRelations: Object.entries(rollups).map(([relation, def]) => ({
      relation,
      fields: def.fields,
    })),
    rollupOps: ROLLUP_OPS,
  };
}

// ── Save-time config validation (whitelist) ───────────────────────────────
//
// Validate a lookup/rollup config against the SAME whitelists the resolver
// uses, so an admin can't persist a field that would never resolve. Throws
// a plain Error with a clear message on the first violation; the caller
// (custom-fields.service) wraps it in BadRequestException.

/** Validate a lookup config: relation ∈ whitelist for fieldTo, field allowed. */
export function validateLookupConfig(
  entityType: string,
  cfg: { relation?: string; field?: string },
): void {
  const relation = cfg?.relation;
  const field = cfg?.field;
  if (!relation || !field) {
    throw new Error('Lookup fields require { relation, field }');
  }
  const relDef = LOOKUP_RELATIONS[entityType]?.[relation];
  if (!relDef) {
    throw new Error(`lookup relation "${relation}" not allowed for ${entityType}`);
  }
  if (!relDef.fields.includes(field)) {
    throw new Error(`lookup field "${field}" not allowed on relation "${relation}"`);
  }
}

/** Validate a rollup config: relation ∈ whitelist, op ∈ ops, field allowed. */
export function validateRollupConfig(
  entityType: string,
  cfg: { relation?: string; op?: string; field?: string },
): void {
  const relation = cfg?.relation;
  const op = cfg?.op as RollupOp | undefined;
  const field = cfg?.field;
  if (!relation || !op) {
    throw new Error('Rollup fields require { relation, op }');
  }
  if (!ROLLUP_OPS.includes(op)) {
    throw new Error(`rollup op "${op}" not allowed (allowed: ${ROLLUP_OPS.join(', ')})`);
  }
  const relDef = ROLLUP_RELATIONS[entityType]?.[relation];
  if (!relDef) {
    throw new Error(`rollup relation "${relation}" not allowed for ${entityType}`);
  }
  if (op !== 'count') {
    if (!field) throw new Error(`rollup op "${op}" requires a field`);
    if (!relDef.fields.includes(field)) {
      throw new Error(`rollup field "${field}" not allowed on relation "${relation}"`);
    }
  }
}

// ── Entity delegate map (fieldTo -> Prisma client delegate name) ──────────
const ENTITY_DELEGATES: Record<string, string> = {
  client: 'client',
  invoice: 'invoice',
  estimate: 'estimate',
  proposal: 'proposal',
  lead: 'lead',
  project: 'project',
  task: 'task',
  ticket: 'ticket',
  contract: 'contract',
};

// ── Entity → RBAC resource map (fieldTo -> permission resource prefix) ─────
// `<resource>.view` / `<resource>.edit` gate reading / writing custom-field
// values. Mirrors the existing app conventions: tasks live under projects,
// contracts under clients (see contracts/tasks controllers).
export const ENTITY_RESOURCES: Record<string, string> = {
  client: 'clients',
  invoice: 'invoices',
  estimate: 'estimates',
  proposal: 'proposals',
  lead: 'leads',
  project: 'projects',
  task: 'projects',
  ticket: 'tickets',
  contract: 'clients',
};

/** True when `fieldTo` is a known custom-field entity type. */
export function isKnownEntityType(entityType: string): boolean {
  return Object.prototype.hasOwnProperty.call(ENTITY_DELEGATES, entityType);
}

// Child models that do NOT carry an organizationId column (scoped via parent FK).
const CHILD_HAS_ORG_COLUMN: Record<string, boolean> = {
  invoiceItem: false,
};

// ── Helpers ───────────────────────────────────────────────────────────────

/**
 * Coerce a raw stored value (string from CustomFieldValue, Prisma Decimal,
 * number, etc.) to a number for formula scope.
 * DOCUMENTED RULE: non-numeric / null / undefined / empty -> 0.
 */
function toNumber(raw: unknown): number {
  if (raw === null || raw === undefined) return 0;
  if (typeof raw === 'number') return Number.isFinite(raw) ? raw : 0;
  // Prisma Decimal and other objects expose toString / toNumber.
  if (typeof raw === 'object') {
    const anyRaw = raw as any;
    if (typeof anyRaw.toNumber === 'function') {
      const n = anyRaw.toNumber();
      return Number.isFinite(n) ? n : 0;
    }
    const n = Number(anyRaw.toString());
    return Number.isFinite(n) ? n : 0;
  }
  const n = Number(String(raw).trim());
  return Number.isFinite(n) ? n : 0;
}

/** Normalize a lookup scalar for transport. Decimal -> number, else string/null. */
function normalizeScalar(val: unknown): string | number | null {
  if (val === null || val === undefined) return null;
  if (typeof val === 'number') return val;
  if (typeof val === 'object') {
    const anyVal = val as any;
    if (typeof anyVal.toNumber === 'function') return anyVal.toNumber();
    if (anyVal instanceof Date) return anyVal.toISOString();
    return String(anyVal.toString());
  }
  if (typeof val === 'boolean') return val ? 'true' : 'false';
  return String(val);
}

// ════════════════════════════════════════════════════════════════════════
//  SAFE FORMULA EVALUATOR — hand-rolled shunting-yard parser.
//
//  Grammar (the ONLY thing accepted):
//      expr      := term (('+' | '-') term)*
//      term      := factor (('*' | '/') factor)*
//      factor    := number | identifier | '(' expr ')' | ('+'|'-') factor
//      number    := [0-9]+ ('.' [0-9]+)?
//      identifier:= [A-Za-z_][A-Za-z0-9_]*   (must resolve in `scope`)
//
//  There is NO function call, NO member access, NO string/array literal, NO
//  comparison/logical/bitwise operator, NO assignment. Anything outside the
//  grammar throws. This guarantees an expression can only ever produce an
//  arithmetic combination of known numeric variables — no code execution.
//  NO eval / new Function / vm is used anywhere.
// ════════════════════════════════════════════════════════════════════════

type TokKind = 'num' | 'ident' | 'op' | 'lparen' | 'rparen';
interface Token {
  kind: TokKind;
  value: string;
}

/** Identifier names referenced in an expression (for the UI parse preview). */
export function extractFormulaRefs(expr: string): string[] {
  try {
    const refs = new Set<string>();
    for (const t of tokenizeFormula(expr)) {
      if (t.kind === 'ident') refs.add(t.value);
    }
    return [...refs];
  } catch {
    return [];
  }
}

/**
 * Validate + evaluate a formula expression against a numeric variable scope.
 * Returns a finite number, or null if the result is non-finite (e.g. /0).
 * Throws on any token / grammar / unknown-variable violation.
 */
export function evaluateFormula(expr: string, scope: Record<string, number>): number | null {
  const tokens = tokenizeFormula(expr);
  if (tokens.length === 0) return null;
  const rpn = toRpn(tokens);
  const result = evalRpn(rpn, scope);
  return Number.isFinite(result) ? result : null;
}

const MAX_EXPR_LEN = 500;

function tokenizeFormula(expr: string): Token[] {
  if (typeof expr !== 'string') throw new Error('formula must be a string');
  if (expr.length > MAX_EXPR_LEN) throw new Error('formula too long');

  const tokens: Token[] = [];
  let i = 0;
  const n = expr.length;
  while (i < n) {
    const ch = expr[i];
    // whitespace
    if (ch === ' ' || ch === '\t' || ch === '\n' || ch === '\r') {
      i++;
      continue;
    }
    // number (with optional single decimal point)
    if (ch >= '0' && ch <= '9') {
      let j = i + 1;
      let seenDot = false;
      while (j < n) {
        const c = expr[j];
        if (c >= '0' && c <= '9') {
          j++;
        } else if (c === '.' && !seenDot) {
          seenDot = true;
          j++;
        } else {
          break;
        }
      }
      tokens.push({ kind: 'num', value: expr.slice(i, j) });
      i = j;
      continue;
    }
    // leading-dot decimal e.g. ".5"
    if (ch === '.' && i + 1 < n && expr[i + 1] >= '0' && expr[i + 1] <= '9') {
      let j = i + 1;
      while (j < n && expr[j] >= '0' && expr[j] <= '9') j++;
      tokens.push({ kind: 'num', value: expr.slice(i, j) });
      i = j;
      continue;
    }
    // identifier
    if ((ch >= 'a' && ch <= 'z') || (ch >= 'A' && ch <= 'Z') || ch === '_') {
      let j = i + 1;
      while (j < n) {
        const c = expr[j];
        if ((c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z') || (c >= '0' && c <= '9') || c === '_') {
          j++;
        } else {
          break;
        }
      }
      tokens.push({ kind: 'ident', value: expr.slice(i, j) });
      i = j;
      continue;
    }
    // operators
    if (ch === '+' || ch === '-' || ch === '*' || ch === '/') {
      tokens.push({ kind: 'op', value: ch });
      i++;
      continue;
    }
    if (ch === '(') {
      tokens.push({ kind: 'lparen', value: ch });
      i++;
      continue;
    }
    if (ch === ')') {
      tokens.push({ kind: 'rparen', value: ch });
      i++;
      continue;
    }
    // Anything else (digits aside) is rejected: letters handled above, so a
    // stray char here means an illegal token (e.g. '=', '<', '"', '.', ';').
    throw new Error(`illegal character in formula: "${ch}"`);
  }
  return tokens;
}

const PRECEDENCE: Record<string, number> = { '+': 1, '-': 1, '*': 2, '/': 2 };

/**
 * Shunting-yard: convert the infix token stream to RPN, handling unary
 * +/- by rewriting them as multiplication by a unary marker. We detect a
 * unary operator when a +/- appears at the start or right after another
 * operator / '(' and fold it into the operand during RPN evaluation.
 */
function toRpn(tokens: Token[]): Token[] {
  const output: Token[] = [];
  const ops: Token[] = [];
  let prev: Token | null = null;

  for (const t of tokens) {
    if (t.kind === 'num' || t.kind === 'ident') {
      // two operands in a row (e.g. "a b" or "2 a") is invalid
      if (prev && (prev.kind === 'num' || prev.kind === 'ident' || prev.kind === 'rparen')) {
        throw new Error('unexpected operand in formula');
      }
      output.push(t);
    } else if (t.kind === 'op') {
      const isUnary =
        prev === null || prev.kind === 'op' || prev.kind === 'lparen';
      if (isUnary) {
        if (t.value === '-') {
          // represent unary minus as a marker the RPN walker understands
          ops.push({ kind: 'op', value: 'u-' });
        } else if (t.value === '+') {
          ops.push({ kind: 'op', value: 'u+' });
        } else {
          throw new Error(`unexpected unary operator "${t.value}"`);
        }
      } else {
        while (
          ops.length > 0 &&
          ops[ops.length - 1].kind === 'op' &&
          isLeftAssocHigherOrEqual(ops[ops.length - 1].value, t.value)
        ) {
          output.push(ops.pop() as Token);
        }
        ops.push(t);
      }
    } else if (t.kind === 'lparen') {
      if (prev && (prev.kind === 'num' || prev.kind === 'ident' || prev.kind === 'rparen')) {
        // e.g. "2(3)" — implicit multiplication is NOT supported (rejected)
        throw new Error('unexpected "(" in formula');
      }
      ops.push(t);
    } else if (t.kind === 'rparen') {
      let foundLparen = false;
      while (ops.length > 0) {
        const top = ops.pop() as Token;
        if (top.kind === 'lparen') {
          foundLparen = true;
          break;
        }
        output.push(top);
      }
      if (!foundLparen) throw new Error('mismatched parentheses in formula');
    }
    prev = t;
  }

  while (ops.length > 0) {
    const top = ops.pop() as Token;
    if (top.kind === 'lparen' || top.kind === 'rparen') {
      throw new Error('mismatched parentheses in formula');
    }
    output.push(top);
  }
  return output;
}

function isLeftAssocHigherOrEqual(top: string, cur: string): boolean {
  // Unary markers (u- / u+) have the HIGHEST precedence — they bind tighter
  // than any binary operator. So when a binary operator arrives, an existing
  // unary marker on the stack must always be popped to output first. This
  // makes "-5 + 3" parse as (-5) + 3 = -2, not -(5 + 3).
  if (top === 'u-' || top === 'u+') return true;
  const pt = PRECEDENCE[top];
  const pc = PRECEDENCE[cur];
  if (pt === undefined || pc === undefined) return false;
  return pt >= pc;
}

function evalRpn(rpn: Token[], scope: Record<string, number>): number {
  const stack: number[] = [];
  for (const t of rpn) {
    if (t.kind === 'num') {
      stack.push(parseFloat(t.value));
    } else if (t.kind === 'ident') {
      if (!Object.prototype.hasOwnProperty.call(scope, t.value)) {
        // DOCUMENTED RULE: an unknown / missing variable resolves to 0.
        stack.push(0);
      } else {
        const v = scope[t.value];
        stack.push(typeof v === 'number' && Number.isFinite(v) ? v : 0);
      }
    } else if (t.kind === 'op') {
      if (t.value === 'u-' || t.value === 'u+') {
        const a = stack.pop();
        if (a === undefined) throw new Error('malformed formula');
        stack.push(t.value === 'u-' ? -a : a);
        continue;
      }
      const b = stack.pop();
      const a = stack.pop();
      if (a === undefined || b === undefined) throw new Error('malformed formula');
      switch (t.value) {
        case '+':
          stack.push(a + b);
          break;
        case '-':
          stack.push(a - b);
          break;
        case '*':
          stack.push(a * b);
          break;
        case '/':
          stack.push(b === 0 ? NaN : a / b);
          break;
        default:
          throw new Error(`unknown operator "${t.value}"`);
      }
    } else {
      throw new Error('malformed formula');
    }
  }
  if (stack.length !== 1) throw new Error('malformed formula');
  return stack[0];
}
