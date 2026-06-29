/**
 * Shared types + static metadata for Validation Rules (Salesforce-style admin
 * config). Kept separate from the page/modal so both the list view and the
 * builder modal agree on operators, field labels, and the entity tab set.
 *
 * IMPORTANT: operator `value` strings must match the backend EXACTLY — they are
 * sent verbatim in the conditions[] payload.
 */

export type EntityKey = 'lead' | 'client';

export const ENTITY_TABS: { key: EntityKey; label: string }[] = [
  { key: 'lead', label: 'Leads' },
  { key: 'client', label: 'Clients' },
];

export interface ValidationCondition {
  field: string;
  operator: string;
  value?: unknown;
}

export interface ValidationRule {
  id: string;
  fieldTo: string;
  name: string;
  description?: string;
  conditionLogic: 'AND' | 'OR';
  conditions: ValidationCondition[];
  errorMessage: string;
  active: boolean;
  order: number;
  createdAt: string;
}

/** Operators exposed in the UI. value === backend operator string. */
export const OPERATORS: { value: string; label: string; noValue?: boolean }[] = [
  { value: 'equals', label: 'equals' },
  { value: 'not_equals', label: 'not equals' },
  { value: 'contains', label: 'contains' },
  { value: 'not_contains', label: 'does not contain' },
  { value: 'starts_with', label: 'starts with' },
  { value: 'ends_with', label: 'ends with' },
  { value: 'greater_than', label: 'greater than' },
  { value: 'less_than', label: 'less than' },
  { value: 'greater_or_equal', label: 'greater or equal' },
  { value: 'less_or_equal', label: 'less or equal' },
  { value: 'is_empty', label: 'is empty', noValue: true },
  { value: 'is_not_empty', label: 'is not empty', noValue: true },
  { value: 'in', label: 'in (comma-separated)' },
  { value: 'not_in', label: 'not in (comma-separated)' },
];

export const OPERATOR_LABELS: Record<string, string> = Object.fromEntries(
  OPERATORS.map((o) => [o.value, o.label]),
);

/** Operators that take no value input. */
export const NO_VALUE_OPERATORS = new Set(
  OPERATORS.filter((o) => o.noValue).map((o) => o.value),
);

/** Native (built-in) fields per entity, offered in the field dropdown. */
export const NATIVE_FIELDS: Record<EntityKey, { value: string; label: string }[]> = {
  lead: [
    { value: 'name', label: 'Name' },
    { value: 'email', label: 'Email' },
    { value: 'phone', label: 'Phone' },
    { value: 'company', label: 'Company' },
    { value: 'status', label: 'Status' },
    { value: 'value', label: 'Value' },
    { value: 'source', label: 'Source' },
    { value: 'city', label: 'City' },
    { value: 'country', label: 'Country' },
  ],
  client: [
    { value: 'company', label: 'Company' },
    { value: 'email', label: 'Email' },
    { value: 'phone', label: 'Phone' },
    { value: 'city', label: 'City' },
    { value: 'country', label: 'Country' },
    { value: 'vat', label: 'VAT' },
    { value: 'website', label: 'Website' },
  ],
};

/**
 * Resolves a stored condition field key to a display label. Custom fields are
 * stored as `cf:<slug>` — without the live custom-field list we fall back to a
 * readable form of the slug.
 */
export function fieldLabel(field: string, entity: EntityKey): string {
  if (field.startsWith('cf:')) return field.slice(3);
  const native = NATIVE_FIELDS[entity].find((f) => f.value === field);
  return native ? native.label : field;
}
