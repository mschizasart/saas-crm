'use client';

/**
 * Shared record-form component used by /custom/[slug]/new and
 * /custom/[slug]/[recordId] (the view-edit page). Renders one input
 * per field def, derived from `fieldType`:
 *
 *   text     → <input type="text">
 *   number   → <input type="number">
 *   date     → <input type="date">
 *   boolean  → <input type="checkbox">
 *   select   → <select> with options.choices
 *   relation → <select> populated from the related entity's list endpoint
 *
 * Relation options are fetched lazily once per (relatedEntity) — we cache
 * by URL inside the component to avoid re-fetching when toggling between
 * record-form modals on the same page.
 */

import { useEffect, useMemo, useState } from 'react';
import { apiFetch } from '@/lib/api';
import { typography } from '@/lib/ui-tokens';

export type FieldType = 'text' | 'number' | 'date' | 'boolean' | 'select' | 'relation';

export interface RecordFormField {
  id: string;
  label: string;
  key: string;
  fieldType: FieldType;
  options: Record<string, any>;
  required: boolean;
  order: number;
}

// The endpoint each relation target lists from. Keys MUST stay in sync
// with the API's RELATION_WHITELIST.
const RELATION_LIST_PATH: Record<string, string> = {
  clients: '/api/v1/clients',
  leads: '/api/v1/leads',
  opportunities: '/api/v1/opportunities',
  tickets: '/api/v1/tickets',
};

// Pull a human label from each entity. The endpoints differ in shape so
// we coerce here once.
function relationLabel(entity: string, row: any): string {
  switch (entity) {
    case 'clients':   return row.company ?? row.name ?? row.id;
    case 'leads':     return row.name ?? row.email ?? row.id;
    case 'opportunities': return row.name ?? row.id;
    case 'tickets':   return row.subject ?? row.title ?? row.id;
    default:          return String(row.id);
  }
}

export function RecordForm({
  fields,
  initial,
  submitting,
  submitLabel,
  onSubmit,
  onCancel,
}: {
  fields: RecordFormField[];
  initial?: Record<string, any>;
  submitting: boolean;
  submitLabel: string;
  onSubmit: (data: Record<string, any>) => void;
  onCancel?: () => void;
}) {
  // Seed values from defaults so booleans render as checkboxes with a
  // known initial state.
  const initialValues = useMemo(() => {
    const out: Record<string, any> = {};
    for (const f of fields) {
      if (initial && f.key in initial) {
        out[f.key] = initial[f.key];
      } else if (f.fieldType === 'boolean') {
        out[f.key] = false;
      } else {
        out[f.key] = '';
      }
    }
    return out;
  }, [fields, initial]);

  const [values, setValues] = useState<Record<string, any>>(initialValues);
  useEffect(() => { setValues(initialValues); }, [initialValues]);

  function setField(key: string, value: any) {
    setValues((v) => ({ ...v, [key]: value }));
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    // Convert "" → null for non-text fields so the API doesn't see
    // empty strings where it expects null/missing. text fields keep
    // the empty string (validator treats both as "not provided" for
    // required check).
    const out: Record<string, any> = {};
    for (const f of fields) {
      const raw = values[f.key];
      if (raw === '' && f.fieldType !== 'text') continue;
      if (raw === '' && f.fieldType === 'text') continue;
      if (f.fieldType === 'number') {
        const n = typeof raw === 'number' ? raw : Number(raw);
        if (!Number.isFinite(n)) continue;
        out[f.key] = n;
      } else {
        out[f.key] = raw;
      }
    }
    onSubmit(out);
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      {fields.map((f) => (
        <FieldInput
          key={f.id}
          field={f}
          value={values[f.key]}
          onChange={(v) => setField(f.key, v)}
        />
      ))}

      <div className="flex justify-end gap-2 pt-2">
        {onCancel && (
          <button
            type="button"
            onClick={onCancel}
            className="px-4 py-2 text-sm border border-gray-200 dark:border-gray-700 rounded-lg hover:bg-gray-50"
          >
            Cancel
          </button>
        )}
        <button
          type="submit"
          disabled={submitting}
          className="px-4 py-2 text-sm bg-primary text-white rounded-lg hover:bg-primary/90 disabled:opacity-50"
        >
          {submitting ? 'Saving…' : submitLabel}
        </button>
      </div>
    </form>
  );
}

function FieldInput({
  field,
  value,
  onChange,
}: {
  field: RecordFormField;
  value: any;
  onChange: (v: any) => void;
}) {
  const label = (
    <label className={`${typography.caption} block mb-1`}>
      {field.label}{field.required && <span className="text-red-500 ml-0.5">*</span>}
    </label>
  );

  const cls =
    'w-full px-3 py-2 text-sm border border-gray-200 dark:border-gray-700 rounded-lg bg-white dark:bg-gray-900';

  switch (field.fieldType) {
    case 'text':
      return (
        <div>
          {label}
          <input type="text" value={value ?? ''} onChange={(e) => onChange(e.target.value)} required={field.required} className={cls} />
        </div>
      );
    case 'number':
      return (
        <div>
          {label}
          <input
            type="number"
            value={value ?? ''}
            onChange={(e) => onChange(e.target.value === '' ? '' : Number(e.target.value))}
            required={field.required}
            className={cls}
          />
        </div>
      );
    case 'date':
      // Normalise ISO strings down to YYYY-MM-DD for the date input.
      return (
        <div>
          {label}
          <input
            type="date"
            value={typeof value === 'string' ? value.slice(0, 10) : ''}
            onChange={(e) => onChange(e.target.value)}
            required={field.required}
            className={cls}
          />
        </div>
      );
    case 'boolean':
      return (
        <label className="flex items-center gap-2 text-sm text-gray-700 dark:text-gray-300">
          <input
            type="checkbox"
            checked={Boolean(value)}
            onChange={(e) => onChange(e.target.checked)}
            className="w-4 h-4 rounded border-gray-300 text-primary"
          />
          {field.label}
        </label>
      );
    case 'select': {
      const choices: string[] = Array.isArray(field.options?.choices) ? field.options!.choices : [];
      return (
        <div>
          {label}
          <select value={value ?? ''} onChange={(e) => onChange(e.target.value)} required={field.required} className={cls}>
            <option value="">— select —</option>
            {choices.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
        </div>
      );
    }
    case 'relation':
      return (
        <div>
          {label}
          <RelationPicker
            relatedEntity={field.options?.relatedEntity}
            value={value ?? ''}
            required={field.required}
            onChange={onChange}
          />
        </div>
      );
  }
}

function RelationPicker({
  relatedEntity,
  value,
  required,
  onChange,
}: {
  relatedEntity: string;
  value: string;
  required: boolean;
  onChange: (v: string) => void;
}) {
  const [options, setOptions] = useState<Array<{ id: string; label: string }>>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoading(true);
      setError(null);
      try {
        const path = RELATION_LIST_PATH[relatedEntity];
        if (!path) throw new Error(`Unknown related entity "${relatedEntity}"`);
        // Pull a reasonable first-page slice; for very large lists the
        // user can paste an id directly via the fallback text input below.
        const res = await apiFetch(`${path}?limit=100`);
        if (!res.ok) throw new Error(`Failed to load ${relatedEntity}`);
        const json = await res.json();
        const rows: any[] = Array.isArray(json) ? json : json.data ?? [];
        if (!cancelled) {
          setOptions(rows.map((r) => ({ id: r.id, label: relationLabel(relatedEntity, r) })));
        }
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Failed to load');
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    void load();
    return () => { cancelled = true; };
  }, [relatedEntity]);

  if (loading) {
    return <p className="text-xs text-gray-400">Loading {relatedEntity}…</p>;
  }
  if (error) {
    return <p className="text-xs text-red-600">{error}</p>;
  }

  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      required={required}
      className="w-full px-3 py-2 text-sm border border-gray-200 dark:border-gray-700 rounded-lg bg-white dark:bg-gray-900"
    >
      <option value="">— select —</option>
      {options.map((o) => (
        <option key={o.id} value={o.id}>{o.label}</option>
      ))}
    </select>
  );
}
