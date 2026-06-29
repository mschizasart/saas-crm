/**
 * Pure condition evaluator for Validation Rules (Salesforce-style).
 *
 * Semantics: `evaluateRule(rule, record)` returns TRUE when the rule's
 * condition MATCHES the record — i.e. the record VIOLATES the rule and the
 * save must be BLOCKED. A rule with no conditions never violates (returns
 * false) so an empty/misconfigured rule can't lock every save.
 *
 * Field resolution:
 *   - A bare `field` reads `record[field]`.
 *   - A `cf:<slug>` field reads from the record's `__customFields` map
 *     (slug -> value) that the caller injects. This lets rules reference
 *     custom fields by slug without the evaluator knowing how CF values are
 *     stored.
 *
 * No eval()/Function() — every operator is an explicit, unit-testable branch.
 */

export interface RuleCondition {
  field: string;
  operator: string;
  value?: any;
}

export interface EvaluableRule {
  conditionLogic?: string | null; // 'AND' | 'OR'
  conditions?: RuleCondition[] | unknown; // JSON column — defensively typed
}

/** Record under evaluation; `__customFields` carries slug -> value for cf refs. */
export type EvaluableRecord = Record<string, any> & {
  __customFields?: Record<string, any> | null;
};

const CF_PREFIX = 'cf:';

/** Resolve a condition `field` against the record (own column or cf:<slug>). */
function resolveFieldValue(record: EvaluableRecord, field: string): any {
  if (typeof field !== 'string' || field.length === 0) return undefined;
  if (field.startsWith(CF_PREFIX)) {
    const slug = field.slice(CF_PREFIX.length);
    const cf = record.__customFields;
    return cf ? cf[slug] : undefined;
  }
  return record[field];
}

/** null / undefined / '' are "empty". 0 and false are NOT empty. */
function isEmpty(v: any): boolean {
  return v === null || v === undefined || v === '';
}

/** Normalise a comma-list or array into a lowercased string[] for in/not_in. */
function toList(value: any): string[] {
  const raw = Array.isArray(value)
    ? value
    : String(value ?? '').split(',');
  return raw
    .map((v) => String(v).trim().toLowerCase())
    .filter((v) => v.length > 0);
}

/** Evaluate a single condition. TRUE = this clause matches. */
export function evaluateCondition(
  cond: RuleCondition,
  record: EvaluableRecord,
): boolean {
  if (!cond || typeof cond.operator !== 'string') return false;

  const actual = resolveFieldValue(record, cond.field);
  const expected = cond.value;

  switch (cond.operator) {
    // ── existence ──────────────────────────────────────────────
    case 'is_empty':
      return isEmpty(actual);
    case 'is_not_empty':
      return !isEmpty(actual);

    // ── string equality / membership ───────────────────────────
    case 'equals':
      return String(actual ?? '').toLowerCase() === String(expected ?? '').toLowerCase();
    case 'not_equals':
      return String(actual ?? '').toLowerCase() !== String(expected ?? '').toLowerCase();
    case 'contains':
      return String(actual ?? '').toLowerCase().includes(String(expected ?? '').toLowerCase());
    case 'not_contains':
      return !String(actual ?? '').toLowerCase().includes(String(expected ?? '').toLowerCase());
    case 'starts_with':
      return String(actual ?? '').toLowerCase().startsWith(String(expected ?? '').toLowerCase());
    case 'ends_with':
      return String(actual ?? '').toLowerCase().endsWith(String(expected ?? '').toLowerCase());

    // ── numeric comparison ──
    // NaN-safe AND null/empty-safe: a missing field (null/undefined/'') is
    // NOT coerced to 0, so e.g. a "budget < 100" rule never matches a record
    // with no budget set. Number(null)/Number('') would otherwise be 0.
    case 'greater_than': {
      if (actual == null || actual === '') return false;
      const a = Number(actual);
      const b = Number(expected);
      return Number.isFinite(a) && Number.isFinite(b) && a > b;
    }
    case 'less_than': {
      if (actual == null || actual === '') return false;
      const a = Number(actual);
      const b = Number(expected);
      return Number.isFinite(a) && Number.isFinite(b) && a < b;
    }
    case 'greater_or_equal': {
      if (actual == null || actual === '') return false;
      const a = Number(actual);
      const b = Number(expected);
      return Number.isFinite(a) && Number.isFinite(b) && a >= b;
    }
    case 'less_or_equal': {
      if (actual == null || actual === '') return false;
      const a = Number(actual);
      const b = Number(expected);
      return Number.isFinite(a) && Number.isFinite(b) && a <= b;
    }

    // ── list membership (value = comma-list or array) ──────────
    case 'in':
      return toList(expected).includes(String(actual ?? '').toLowerCase());
    case 'not_in':
      return !toList(expected).includes(String(actual ?? '').toLowerCase());

    default:
      // Unknown operator never matches → never blocks a save.
      return false;
  }
}

/** Supported operator identifiers (also exported for DTO validation / UI). */
export const VALIDATION_OPERATORS = [
  'equals',
  'not_equals',
  'contains',
  'not_contains',
  'starts_with',
  'ends_with',
  'greater_than',
  'less_than',
  'greater_or_equal',
  'less_or_equal',
  'is_empty',
  'is_not_empty',
  'in',
  'not_in',
] as const;

export type ValidationOperator = (typeof VALIDATION_OPERATORS)[number];

/**
 * Evaluate a whole rule against a record.
 *
 * @returns TRUE when the rule is VIOLATED (condition matches → block the save).
 *
 * - An empty / missing conditions array never violates (returns false).
 * - AND (default): every condition must match to violate.
 * - OR: any condition matching violates.
 */
export function evaluateRule(
  rule: EvaluableRule,
  record: EvaluableRecord,
): boolean {
  const conditions = Array.isArray(rule?.conditions)
    ? (rule.conditions as RuleCondition[])
    : [];
  if (conditions.length === 0) return false;

  const logic = String(rule.conditionLogic ?? 'AND').toUpperCase();

  if (logic === 'OR') {
    return conditions.some((c) => evaluateCondition(c, record));
  }
  // Default to AND for any other / missing logic value.
  return conditions.every((c) => evaluateCondition(c, record));
}
