'use client';

/**
 * Settings → Custom Objects → [id]  (field schema editor — Wave D3)
 *
 * Manage the field definitions for a single custom object: add fields,
 * edit label / required inline, reorder with up/down arrows, delete
 * with confirm. Field `key` is immutable and field `type` is immutable
 * once records exist (the API enforces both — we only soft-guard them
 * in the UI for clarity).
 */

import { use, useEffect, useState } from 'react';
import Link from 'next/link';
import { ArrowDown, ArrowUp, Plus, Trash2, X } from 'lucide-react';
import { apiFetch } from '@/lib/api';
import {
  SettingsPageLayout,
  SettingsSection,
} from '@/components/layouts/settings-page-layout';
import { typography } from '@/lib/ui-tokens';

type FieldType = 'text' | 'number' | 'date' | 'boolean' | 'select' | 'relation';
const FIELD_TYPES: FieldType[] = ['text', 'number', 'date', 'boolean', 'select', 'relation'];
// Must stay in sync with the API's RELATION_WHITELIST.
const RELATION_TARGETS = ['clients', 'leads', 'opportunities', 'tickets'] as const;

interface Field {
  id: string;
  label: string;
  key: string;
  fieldType: FieldType;
  options: Record<string, any>;
  required: boolean;
  order: number;
}

interface CustomObject {
  id: string;
  name: string;
  slug: string;
  pluralName: string;
  icon: string | null;
  fields: Field[];
  _count?: { records: number };
}

function fieldKeyify(label: string): string {
  return label
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 41);
}

export default function CustomObjectFieldsPage({
  params,
}: {
  // Next.js 15 async params; we use React.use() to unwrap. If the runtime
  // is still on 14 the value is a plain object — `use()` accepts both.
  params: Promise<{ id: string }> | { id: string };
}) {
  const { id } = 'then' in (params as any) ? use(params as Promise<{ id: string }>) : (params as { id: string });

  const [object, setObject] = useState<CustomObject | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showAdd, setShowAdd] = useState(false);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const res = await apiFetch(`/api/v1/custom-objects/${id}`);
      if (!res.ok) throw new Error(`Server responded with ${res.status}`);
      setObject(await res.json());
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { void load(); }, [id]);

  // Bulk reorder happens via the /fields/reorder endpoint so the
  // server can validate every id in one shot. swapOrder rebuilds the
  // {id, order} map after a swap and POSTs it.
  async function move(fieldId: string, direction: -1 | 1) {
    if (!object) return;
    const sorted = [...object.fields].sort((a, b) => a.order - b.order);
    const idx = sorted.findIndex((f) => f.id === fieldId);
    if (idx < 0) return;
    const newIdx = idx + direction;
    if (newIdx < 0 || newIdx >= sorted.length) return;
    [sorted[idx], sorted[newIdx]] = [sorted[newIdx], sorted[idx]];
    const orderMap = sorted.map((f, i) => ({ id: f.id, order: i }));
    try {
      const res = await apiFetch(`/api/v1/custom-objects/${id}/fields/reorder`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ orderMap }),
      });
      if (!res.ok) throw new Error('reorder failed');
      void load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to reorder');
    }
  }

  async function saveInline(field: Field, patch: Partial<Field>) {
    try {
      const res = await apiFetch(`/api/v1/custom-objects/${id}/fields/${field.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(patch),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        throw new Error(j.message || `Failed (${res.status})`);
      }
      void load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update');
    }
  }

  async function deleteField(field: Field) {
    if (!confirm(`Delete "${field.label}"? This will strip the value from every existing record.`)) {
      return;
    }
    try {
      const res = await apiFetch(`/api/v1/custom-objects/${id}/fields/${field.id}`, {
        method: 'DELETE',
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        throw new Error(j.message || `Failed (${res.status})`);
      }
      void load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to delete');
    }
  }

  if (loading) {
    return <div className="p-6 text-sm text-gray-500 dark:text-gray-400">Loading…</div>;
  }
  if (!object) {
    return <div className="p-6 text-sm text-red-600">{error || 'Not found'}</div>;
  }

  const hasRecords = (object._count?.records ?? 0) > 0;
  const fields = [...object.fields].sort((a, b) => a.order - b.order);

  return (
    <SettingsPageLayout
      title={object.name}
      description={`Manage fields for the ${object.pluralName} custom object.`}
    >
      <div className="mb-[-0.5rem]">
        <Link href="/settings/custom-objects" className={`${typography.bodyMuted} hover:text-primary`}>
          ← Custom objects
        </Link>
      </div>

      {error && (
        <div className="px-3 py-2 bg-red-50 border border-red-100 text-sm text-red-700 rounded">{error}</div>
      )}

      <SettingsSection
        title="Fields"
        description={
          hasRecords
            ? `${object._count?.records} record(s) exist — field types are locked, but you can still rename or change required.`
            : 'No records yet — you can change field types freely.'
        }
      >
        <div className="flex items-center justify-end mb-4">
          <button
            onClick={() => setShowAdd(true)}
            className="inline-flex items-center gap-1.5 px-4 py-2 bg-primary text-white text-sm font-medium rounded-lg hover:bg-primary/90"
          >
            <Plus className="w-4 h-4" />
            Add Field
          </button>
        </div>

        {fields.length === 0 ? (
          <p className="text-sm text-gray-500 dark:text-gray-400 py-6 text-center border border-dashed border-gray-200 dark:border-gray-700 rounded-lg">
            No fields yet — add your first one to start collecting data.
          </p>
        ) : (
          <table className="min-w-full text-sm border border-gray-100 dark:border-gray-800 rounded-lg overflow-hidden">
            <thead className="bg-gray-50 dark:bg-gray-900 text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide">
              <tr>
                <th className="px-3 py-2 text-left w-10">Order</th>
                <th className="px-3 py-2 text-left">Label</th>
                <th className="px-3 py-2 text-left">Key</th>
                <th className="px-3 py-2 text-left">Type</th>
                <th className="px-3 py-2 text-center">Required</th>
                <th className="px-3 py-2 text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {fields.map((f, idx) => (
                <FieldRow
                  key={f.id}
                  field={f}
                  isFirst={idx === 0}
                  isLast={idx === fields.length - 1}
                  onMoveUp={() => move(f.id, -1)}
                  onMoveDown={() => move(f.id, 1)}
                  onSave={(patch) => saveInline(f, patch)}
                  onDelete={() => deleteField(f)}
                />
              ))}
            </tbody>
          </table>
        )}
      </SettingsSection>

      {showAdd && (
        <AddFieldModal
          objectId={id}
          existingKeys={fields.map((f) => f.key)}
          onClose={() => setShowAdd(false)}
          onAdded={() => { setShowAdd(false); void load(); }}
        />
      )}
    </SettingsPageLayout>
  );
}

function FieldRow({
  field,
  isFirst,
  isLast,
  onMoveUp,
  onMoveDown,
  onSave,
  onDelete,
}: {
  field: Field;
  isFirst: boolean;
  isLast: boolean;
  onMoveUp: () => void;
  onMoveDown: () => void;
  onSave: (patch: Partial<Field>) => void;
  onDelete: () => void;
}) {
  const [label, setLabel] = useState(field.label);
  const [required, setRequired] = useState(field.required);
  const dirty = label !== field.label || required !== field.required;

  return (
    <tr className="border-t border-gray-100 dark:border-gray-800">
      <td className="px-3 py-2 text-gray-400 dark:text-gray-500">
        <div className="flex flex-col gap-0.5">
          <button onClick={onMoveUp} disabled={isFirst} className="p-0.5 disabled:opacity-30 hover:text-gray-700" aria-label="Move up">
            <ArrowUp className="w-3 h-3" />
          </button>
          <button onClick={onMoveDown} disabled={isLast} className="p-0.5 disabled:opacity-30 hover:text-gray-700" aria-label="Move down">
            <ArrowDown className="w-3 h-3" />
          </button>
        </div>
      </td>
      <td className="px-3 py-2">
        <input
          value={label}
          onChange={(e) => setLabel(e.target.value)}
          className="w-full px-2 py-1 text-sm border border-gray-200 dark:border-gray-700 rounded bg-white dark:bg-gray-900"
        />
      </td>
      <td className="px-3 py-2">
        <code className="text-xs text-gray-500 dark:text-gray-400 bg-gray-50 dark:bg-gray-800 px-1.5 py-0.5 rounded">{field.key}</code>
      </td>
      <td className="px-3 py-2 text-gray-700 dark:text-gray-300">{field.fieldType}</td>
      <td className="px-3 py-2 text-center">
        <input
          type="checkbox"
          checked={required}
          onChange={(e) => setRequired(e.target.checked)}
          className="w-4 h-4 rounded border-gray-300 text-primary"
        />
      </td>
      <td className="px-3 py-2 text-right">
        <div className="inline-flex items-center gap-2">
          {dirty && (
            <button
              onClick={() => onSave({ label, required })}
              className="text-xs text-primary font-medium hover:underline"
            >
              Save
            </button>
          )}
          <button onClick={onDelete} className="text-red-500 hover:text-red-700" aria-label="Delete field">
            <Trash2 className="w-4 h-4" />
          </button>
        </div>
      </td>
    </tr>
  );
}

function AddFieldModal({
  objectId,
  existingKeys,
  onClose,
  onAdded,
}: {
  objectId: string;
  existingKeys: string[];
  onClose: () => void;
  onAdded: () => void;
}) {
  const [label, setLabel] = useState('');
  const [key, setKey] = useState('');
  const [keyTouched, setKeyTouched] = useState(false);
  const [fieldType, setFieldType] = useState<FieldType>('text');
  const [required, setRequired] = useState(false);
  const [choices, setChoices] = useState(''); // select: comma-separated
  const [relatedEntity, setRelatedEntity] = useState<typeof RELATION_TARGETS[number]>('clients');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function onLabelChange(v: string) {
    setLabel(v);
    if (!keyTouched) setKey(fieldKeyify(v));
  }

  const duplicate = existingKeys.includes(key);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      const options: Record<string, any> = {};
      if (fieldType === 'select') {
        options.choices = choices.split(',').map((c) => c.trim()).filter(Boolean);
      }
      if (fieldType === 'relation') {
        options.relatedEntity = relatedEntity;
      }
      const res = await apiFetch(`/api/v1/custom-objects/${objectId}/fields`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ label, key, fieldType, required, options }),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        throw new Error(j.message || `Failed (${res.status})`);
      }
      onAdded();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <form
        onClick={(e) => e.stopPropagation()}
        onSubmit={submit}
        className="bg-white dark:bg-gray-900 rounded-xl shadow-xl w-full max-w-md p-5"
      >
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100">Add Field</h2>
          <button type="button" onClick={onClose} className="p-1 hover:bg-gray-100 dark:hover:bg-gray-800 rounded">
            <X className="w-4 h-4 text-gray-500 dark:text-gray-400" />
          </button>
        </div>

        {error && (
          <div className="mb-3 px-3 py-2 bg-red-50 border border-red-100 text-xs text-red-700 rounded">{error}</div>
        )}

        <div className="space-y-3">
          <div>
            <label className={`${typography.caption} block mb-1`}>Label *</label>
            <input
              value={label}
              onChange={(e) => onLabelChange(e.target.value)}
              required
              placeholder="VIN"
              className="w-full px-3 py-2 text-sm border border-gray-200 dark:border-gray-700 rounded-lg bg-white dark:bg-gray-900"
            />
          </div>
          <div>
            <label className={`${typography.caption} block mb-1`}>Key *</label>
            <input
              value={key}
              onChange={(e) => { setKeyTouched(true); setKey(e.target.value); }}
              required
              placeholder="vin"
              className="w-full px-3 py-2 text-sm border border-gray-200 dark:border-gray-700 rounded-lg bg-white dark:bg-gray-900 font-mono"
            />
            {duplicate && (
              <p className="text-[11px] text-red-600 mt-1">A field with this key already exists.</p>
            )}
          </div>
          <div>
            <label className={`${typography.caption} block mb-1`}>Type *</label>
            <select
              value={fieldType}
              onChange={(e) => setFieldType(e.target.value as FieldType)}
              className="w-full px-3 py-2 text-sm border border-gray-200 dark:border-gray-700 rounded-lg bg-white dark:bg-gray-900"
            >
              {FIELD_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
            </select>
          </div>
          {fieldType === 'select' && (
            <div>
              <label className={`${typography.caption} block mb-1`}>Choices (comma-separated) *</label>
              <input
                value={choices}
                onChange={(e) => setChoices(e.target.value)}
                placeholder="Sedan, SUV, Truck"
                className="w-full px-3 py-2 text-sm border border-gray-200 dark:border-gray-700 rounded-lg bg-white dark:bg-gray-900"
              />
            </div>
          )}
          {fieldType === 'relation' && (
            <div>
              <label className={`${typography.caption} block mb-1`}>Related entity *</label>
              <select
                value={relatedEntity}
                onChange={(e) => setRelatedEntity(e.target.value as typeof RELATION_TARGETS[number])}
                className="w-full px-3 py-2 text-sm border border-gray-200 dark:border-gray-700 rounded-lg bg-white dark:bg-gray-900"
              >
                {RELATION_TARGETS.map((r) => <option key={r} value={r}>{r}</option>)}
              </select>
            </div>
          )}
          <label className="flex items-center gap-2 text-sm text-gray-700 dark:text-gray-300">
            <input
              type="checkbox"
              checked={required}
              onChange={(e) => setRequired(e.target.checked)}
              className="w-4 h-4 rounded border-gray-300 text-primary"
            />
            Required
          </label>
        </div>

        <div className="flex justify-end gap-2 mt-5">
          <button type="button" onClick={onClose} className="px-4 py-2 text-sm border border-gray-200 dark:border-gray-700 rounded-lg hover:bg-gray-50">
            Cancel
          </button>
          <button
            type="submit"
            disabled={saving || duplicate || !key || !label}
            className="px-4 py-2 text-sm bg-primary text-white rounded-lg hover:bg-primary/90 disabled:opacity-50"
          >
            {saving ? 'Adding…' : 'Add field'}
          </button>
        </div>
      </form>
    </div>
  );
}
