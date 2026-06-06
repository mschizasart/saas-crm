/**
 * Validation helpers for Custom Objects.
 *
 * SECURITY-CRITICAL — these checks are the only line of defence between
 * tenant-supplied identifiers (slugs, field keys, relation targets) and
 * the application's route table, jsonb path expressions, and inter-org
 * data exposure. Every input from a custom-objects endpoint that ends
 * up in a URL, a jsonb path, or an FK lookup is funnelled through here.
 *
 * Anti-patterns guarded against:
 *   - Tenants minting routes that shadow real ones (`/admin`, `/leads`)
 *     → blocked by RESERVED_SLUGS + the slug regex (no path segments).
 *   - Field keys with dots breaking `data->>'key'` path access
 *     → blocked by validateFieldKey (no dots, snake_case only).
 *   - Tenants pointing a `relation` field at an arbitrary table
 *     → blocked by RELATION_WHITELIST in validateFieldDef.
 *   - Unknown / stale jsonb keys persisting on records
 *     → callers MUST strip unknown keys before insert; see
 *       custom-records.service.ts which uses field.key as the allowlist.
 */
import { BadRequestException } from '@nestjs/common';

// ─── Slug rules ────────────────────────────────────────────────────────
//
// Slugs are reserved-word + regex gated. They land in the public URL
// (`/custom/<slug>/records`) so they must not collide with existing top-
// level admin routes (clients, leads, settings, …) or with the platform's
// own paths (admin, platform, api, public).
export const RESERVED_SLUGS = [
  'admin',
  'api',
  'platform',
  'public',
  'settings',
  'clients',
  'leads',
  'invoices',
  'tickets',
  'users',
  'organizations',
  'staff',
  'opportunities',
  'reports',
  'dashboards',
  'custom',
  // Route-segment collisions inside the custom-objects slice itself:
  //   'records' — literal segment in /custom-objects/:slug/records
  //   'new'     — Next.js static segment in /custom/[slug]/new/page.tsx
  //                 (static wins over dynamic → list page 404s)
  //   'fields'  — literal segment in /custom-objects/:id/fields/{reorder,:fieldId}
  'records',
  'new',
  'fields',
];

// 2-41 chars, must start with a letter, lowercase letters/digits/underscore.
// (Length is regex-bounded so even Postgres index keys stay sane.)
const SLUG_RE = /^[a-z][a-z0-9_]{1,40}$/;

/**
 * Validate a custom-object slug. Throws BadRequestException with the exact
 * rule that failed so the UI can surface it directly.
 */
export function validateSlug(slug: unknown): void {
  if (typeof slug !== 'string' || slug.length === 0) {
    throw new BadRequestException('Slug is required.');
  }
  if (!SLUG_RE.test(slug)) {
    throw new BadRequestException(
      'Slug must start with a lowercase letter and contain only ' +
        'lowercase letters, digits, and underscores (2-41 chars).',
    );
  }
  if (RESERVED_SLUGS.includes(slug)) {
    throw new BadRequestException(
      `Slug "${slug}" is reserved and cannot be used.`,
    );
  }
}

// ─── Field-key rules ───────────────────────────────────────────────────
//
// Field keys are used as jsonb path segments (`data->>'key'`). A dot in
// the key would silently change the semantics of that path expression, so
// dots are rejected outright. Same snake_case shape as slugs, but allowed
// to be a single character (shortest valid is e.g. "x").
const FIELD_KEY_RE = /^[a-z][a-z0-9_]{0,40}$/;

export function validateFieldKey(key: unknown): void {
  if (typeof key !== 'string' || key.length === 0) {
    throw new BadRequestException('Field key is required.');
  }
  if (key.includes('.')) {
    throw new BadRequestException(
      'Field key cannot contain dots (breaks jsonb path access).',
    );
  }
  if (!FIELD_KEY_RE.test(key)) {
    throw new BadRequestException(
      'Field key must start with a lowercase letter and contain only ' +
        'lowercase letters, digits, and underscores (1-41 chars).',
    );
  }
}

// ─── Field types & relation whitelist ──────────────────────────────────
export const FIELD_TYPES = [
  'text',
  'number',
  'date',
  'boolean',
  'select',
  'relation',
] as const;
export type FieldType = (typeof FIELD_TYPES)[number];

// A `relation` field's `options.relatedEntity` must be in this whitelist.
// Adding a new entity here is deliberate — it must be implemented in the
// web layer's relation-picker AND in the (light) shape check in
// validateRecordData below.
export const RELATION_WHITELIST = [
  'clients',
  'leads',
  'opportunities',
  'tickets',
] as const;
export type RelationTarget = (typeof RELATION_WHITELIST)[number];

// UUID v4-ish — accepts the standard 8-4-4-4-12 hex shape Postgres
// emits from gen_random_uuid()::text. Case-insensitive.
const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface FieldDef {
  id?: string;
  label: string;
  key: string;
  fieldType: FieldType;
  options?: Record<string, any> | null;
  required?: boolean;
  order?: number;
}

/**
 * Validate a single field definition shape (used on add / update). The
 * caller is expected to have already validated `key` separately.
 */
export function validateFieldDef(def: Partial<FieldDef>): void {
  if (!def.label || typeof def.label !== 'string') {
    throw new BadRequestException('Field label is required.');
  }
  if (!def.fieldType || !FIELD_TYPES.includes(def.fieldType as FieldType)) {
    throw new BadRequestException(
      `Field type must be one of: ${FIELD_TYPES.join(', ')}.`,
    );
  }
  const options = (def.options ?? {}) as Record<string, any>;
  if (def.fieldType === 'select') {
    const choices = options.choices;
    if (!Array.isArray(choices) || choices.length === 0) {
      throw new BadRequestException(
        'Select fields require `options.choices` to be a non-empty array of strings.',
      );
    }
    for (const c of choices) {
      if (typeof c !== 'string' || c.length === 0) {
        throw new BadRequestException(
          'Each select choice must be a non-empty string.',
        );
      }
    }
  }
  if (def.fieldType === 'relation') {
    const related = options.relatedEntity;
    if (
      typeof related !== 'string' ||
      !RELATION_WHITELIST.includes(related as RelationTarget)
    ) {
      throw new BadRequestException(
        `Relation fields require options.relatedEntity to be one of: ${RELATION_WHITELIST.join(
          ', ',
        )}.`,
      );
    }
  }
}

// ─── Record data validation ────────────────────────────────────────────
//
// validateRecordData runs on EVERY record create AND update — the API
// layer is the only validator (the DB column is opaque jsonb). It
// returns the collected errors as a map keyed by field.key so the UI
// can render them next to each input.
export function validateRecordData(
  fields: FieldDef[],
  rawData: Record<string, any>,
): { data: Record<string, any> } {
  // Belt-and-braces backstop: strip unknown keys up-front so this function
  // is self-sufficient even if a caller forgets to pre-strip. stripUnknownKeys
  // is idempotent, so callers that already stripped pay nothing.
  const data = stripUnknownKeys(fields, rawData);
  const errors: Record<string, string> = {};

  for (const field of fields) {
    const raw = data[field.key];
    const missing = raw == null || raw === '';

    if (field.required && missing) {
      errors[field.key] = `${field.label} is required`;
      continue;
    }
    if (missing) continue; // optional + empty → ok, nothing to type-check

    switch (field.fieldType) {
      case 'text':
        if (typeof raw !== 'string') {
          errors[field.key] = `${field.label} must be a string`;
        }
        break;
      case 'number':
        if (typeof raw !== 'number' || !Number.isFinite(raw)) {
          errors[field.key] = `${field.label} must be a finite number`;
        }
        break;
      case 'date': {
        // Accept ISO date / datetime strings. Reject NaN.
        if (typeof raw !== 'string') {
          errors[field.key] = `${field.label} must be an ISO date string`;
          break;
        }
        const d = new Date(raw);
        if (Number.isNaN(d.getTime())) {
          errors[field.key] = `${field.label} is not a valid date`;
        }
        break;
      }
      case 'boolean':
        if (typeof raw !== 'boolean') {
          errors[field.key] = `${field.label} must be true or false`;
        }
        break;
      case 'select': {
        const choices: string[] = Array.isArray(field.options?.choices)
          ? (field.options!.choices as string[])
          : [];
        if (typeof raw !== 'string' || !choices.includes(raw)) {
          errors[field.key] = `${field.label} must be one of: ${choices.join(', ')}`;
        }
        break;
      }
      case 'relation':
        // Shape-only check: a uuid string. The caller is responsible for
        // confirming the referenced row belongs to the same org if it
        // wants stronger guarantees — we deliberately don't hit the DB
        // here to keep validation cheap on bulk imports.
        if (typeof raw !== 'string' || !UUID_RE.test(raw)) {
          errors[field.key] = `${field.label} must be a valid record id`;
        }
        break;
    }
  }

  if (Object.keys(errors).length > 0) {
    throw new BadRequestException({
      message: 'Record validation failed',
      errors,
    });
  }
  return { data };
}

/**
 * Strip any keys from `data` that aren't declared in `fields`. This is
 * the second half of the input-sanitisation pair (validateRecordData is
 * the first): unknown keys must NEVER be persisted to the jsonb column,
 * because they would silently survive even after the matching field is
 * deleted and would not be enumerable in the UI.
 */
export function stripUnknownKeys(
  fields: FieldDef[],
  data: Record<string, any>,
): Record<string, any> {
  const allowed = new Set(fields.map((f) => f.key));
  const out: Record<string, any> = {};
  for (const [k, v] of Object.entries(data ?? {})) {
    if (allowed.has(k)) out[k] = v;
  }
  return out;
}
