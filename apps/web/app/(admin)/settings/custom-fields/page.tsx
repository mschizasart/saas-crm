'use client';

import { useEffect, useState, useCallback } from 'react';
import { SettingsPageLayout, SettingsSection } from '@/components/layouts/settings-page-layout';

const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001';
const getToken = () =>
  typeof window === 'undefined' ? null : localStorage.getItem('access_token');

const MODULES = [
  'clients',
  'leads',
  'invoices',
  'tickets',
  'projects',
  'estimates',
  'contracts',
  'staff',
] as const;

// The API stores `fieldTo` in SINGULAR form (matches how entity forms fetch
// custom fields, e.g. fieldTo="client"). Map the plural UI tab to it so that
// computed fields resolve against the same key the entity forms use.
const FIELD_TO_SINGULAR: Record<string, string> = {
  clients: 'client',
  leads: 'lead',
  invoices: 'invoice',
  tickets: 'ticket',
  projects: 'project',
  estimates: 'estimate',
  contracts: 'contract',
  staff: 'staff',
};

const FIELD_TYPES = [
  'text',
  'textarea',
  'number',
  'date',
  'select',
  'checkbox',
] as const;

type FieldKind = 'input' | 'formula' | 'lookup' | 'rollup';
const FIELD_KINDS: { value: FieldKind; label: string }[] = [
  { value: 'input', label: 'Input (user-entered)' },
  { value: 'formula', label: 'Formula (computed)' },
  { value: 'lookup', label: 'Lookup (from related record)' },
  { value: 'rollup', label: 'Rollup (aggregate of children)' },
];
const ROLLUP_OPS = ['sum', 'count', 'avg', 'min', 'max'] as const;

interface ComputedMeta {
  ownNumericColumns: string[];
  formulaVariables: string[];
  inputFields: { slug: string; name: string; type: string }[];
  lookupRelations: { relation: string; fields: string[] }[];
  rollupRelations: { relation: string; fields: string[] }[];
  rollupOps: string[];
}

interface CustomField {
  id: string;
  fieldTo: string;
  name: string;
  slug: string;
  type: string;
  options: string[];
  required: boolean;
  showOnTable: boolean;
  order: number;
  fieldKind?: FieldKind;
  formulaExpr?: string | null;
  lookupConfig?: { relation?: string; field?: string } | null;
  rollupConfig?: { relation?: string; op?: string; field?: string } | null;
}

export default function CustomFieldsPage() {
  const [module, setModule] = useState<string>('clients');
  const [fields, setFields] = useState<CustomField[]>([]);
  const [loading, setLoading] = useState(false);
  const [showModal, setShowModal] = useState(false);
  const [editing, setEditing] = useState<CustomField | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      // The API stores fieldTo in SINGULAR form (matches how entity forms
      // fetch/compute custom fields), so query that key — keeps the builder
      // consistent with the records the fields actually attach to.
      const fieldTo = FIELD_TO_SINGULAR[module] ?? module;
      const res = await fetch(
        `${API_BASE}/api/v1/custom-fields?fieldTo=${fieldTo}`,
        { headers: { Authorization: `Bearer ${getToken()}` } },
      );
      const data = await res.json();
      setFields(Array.isArray(data) ? data : []);
    } finally {
      setLoading(false);
    }
  }, [module]);

  useEffect(() => {
    load();
  }, [load]);

  const remove = async (id: string) => {
    if (!confirm('Delete this field?')) return;
    await fetch(`${API_BASE}/api/v1/custom-fields/${id}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${getToken()}` },
    });
    load();
  };

  return (
    <SettingsPageLayout title="Custom Fields" description="Add extra fields to records for any module">
      <SettingsSection title="Fields" description={`Manage custom fields for ${module}`}>
        <div className="flex items-center justify-between mb-4 gap-4">
          <div className="border-b border-gray-200 dark:border-gray-700 flex gap-2 overflow-x-auto flex-1">
            {MODULES.map((m) => (
              <button
                key={m}
                onClick={() => setModule(m)}
                className={`px-4 py-2 text-sm font-medium capitalize border-b-2 transition-colors ${
                  module === m
                    ? 'border-primary text-primary'
                    : 'border-transparent text-gray-500 hover:text-gray-800'
                }`}
              >
                {m}
              </button>
            ))}
          </div>
          <button
            onClick={() => {
              setEditing(null);
              setShowModal(true);
            }}
            className="bg-primary text-white text-sm font-medium px-4 py-2 rounded-lg hover:bg-primary/90 flex-shrink-0"
          >
            + New Field
          </button>
        </div>

        <div className="overflow-hidden border border-gray-100 dark:border-gray-800 rounded-lg">
          <table className="min-w-full text-sm">
            <thead className="bg-gray-50 dark:bg-gray-900 border-b border-gray-100 dark:border-gray-800">
              <tr className="text-left text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase">
                <th className="px-4 py-3">Name</th>
                <th className="px-4 py-3">Kind</th>
                <th className="px-4 py-3">Type</th>
                <th className="px-4 py-3">Required</th>
                <th className="px-4 py-3">Order</th>
                <th className="px-4 py-3 text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan={6} className="px-4 py-8 text-center text-gray-400 dark:text-gray-500">
                    Loading…
                  </td>
                </tr>
              ) : fields.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-4 py-8 text-center text-gray-400 dark:text-gray-500">
                    No custom fields for {module}
                  </td>
                </tr>
              ) : (
                fields.map((f) => {
                  const kind = (f.fieldKind ?? 'input') as FieldKind;
                  const computed = kind !== 'input';
                  return (
                  <tr key={f.id} className="border-b border-gray-100 dark:border-gray-800 last:border-0">
                    <td className="px-4 py-3 font-medium text-gray-900 dark:text-gray-100">
                      {computed && <span title="Computed (read-only)" className="mr-1">∑</span>}
                      {f.name}
                    </td>
                    <td className="px-4 py-3">
                      <span
                        className={`text-xs px-2 py-0.5 rounded-full ${
                          computed
                            ? 'bg-violet-100 text-violet-700'
                            : 'bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-300'
                        }`}
                      >
                        {kind}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-gray-500 dark:text-gray-400">{f.type}</td>
                    <td className="px-4 py-3">
                      {f.required && (
                        <span className="text-xs bg-red-100 text-red-700 px-2 py-0.5 rounded-full">
                          Required
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-gray-500 dark:text-gray-400">{f.order}</td>
                    <td className="px-4 py-3 text-right">
                      <button
                        onClick={() => {
                          setEditing(f);
                          setShowModal(true);
                        }}
                        className="text-xs text-gray-500 dark:text-gray-400 hover:text-primary mr-3"
                      >
                        Edit
                      </button>
                      <button
                        onClick={() => remove(f.id)}
                        className="text-xs text-red-600 hover:underline"
                      >
                        Delete
                      </button>
                    </td>
                  </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </SettingsSection>

      {showModal && (
        <FieldModal
          module={module}
          editing={editing}
          onClose={() => setShowModal(false)}
          onSaved={() => {
            setShowModal(false);
            load();
          }}
        />
      )}
    </SettingsPageLayout>
  );
}

function FieldModal({
  module,
  editing,
  onClose,
  onSaved,
}: {
  module: string;
  editing: CustomField | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  // Singular fieldTo the API stores/computes against (e.g. "client").
  const fieldTo = FIELD_TO_SINGULAR[module] ?? module;

  const [name, setName] = useState(editing?.name ?? '');
  const [fieldType, setFieldType] = useState(editing?.type ?? 'text');
  const [optionsText, setOptionsText] = useState(
    (editing?.options ?? []).join('\n'),
  );
  const [required, setRequired] = useState(editing?.required ?? false);
  const [showInList, setShowInList] = useState(editing?.showOnTable ?? false);
  const [order, setOrder] = useState(editing?.order ?? 0);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // ── v2 computed field state ──
  const [fieldKind, setFieldKind] = useState<FieldKind>(editing?.fieldKind ?? 'input');
  const [formulaExpr, setFormulaExpr] = useState(editing?.formulaExpr ?? '');
  const [lookupRelation, setLookupRelation] = useState(editing?.lookupConfig?.relation ?? '');
  const [lookupField, setLookupField] = useState(editing?.lookupConfig?.field ?? '');
  const [rollupRelation, setRollupRelation] = useState(editing?.rollupConfig?.relation ?? '');
  const [rollupOp, setRollupOp] = useState(editing?.rollupConfig?.op ?? 'sum');
  const [rollupField, setRollupField] = useState(editing?.rollupConfig?.field ?? '');

  const [meta, setMeta] = useState<ComputedMeta | null>(null);
  // Live formula parse preview: { valid, refs, error }
  const [formulaPreview, setFormulaPreview] = useState<{ valid: boolean; refs: string[]; error?: string } | null>(null);

  // Load computed-field option metadata for this entity.
  useEffect(() => {
    fetch(`${API_BASE}/api/v1/custom-fields/meta/${fieldTo}`, {
      headers: { Authorization: `Bearer ${getToken()}` },
    })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => setMeta(d))
      .catch(() => setMeta(null));
  }, [fieldTo]);

  // Debounced formula parse preview (server-side, parse only — no eval).
  useEffect(() => {
    if (fieldKind !== 'formula' || !formulaExpr.trim()) {
      setFormulaPreview(null);
      return;
    }
    const t = setTimeout(() => {
      fetch(`${API_BASE}/api/v1/custom-fields/formula/preview`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${getToken()}`,
        },
        body: JSON.stringify({ expr: formulaExpr }),
      })
        .then((r) => (r.ok ? r.json() : null))
        .then((d) => setFormulaPreview(d))
        .catch(() => setFormulaPreview(null));
    }, 350);
    return () => clearTimeout(t);
  }, [fieldKind, formulaExpr]);

  const lookupRelDef = meta?.lookupRelations.find((r) => r.relation === lookupRelation);
  const rollupRelDef = meta?.rollupRelations.find((r) => r.relation === rollupRelation);

  const save = async () => {
    setSaving(true);
    setError(null);
    try {
      const body: Record<string, unknown> = {
        fieldTo,
        name,
        fieldType,
        options:
          fieldType === 'select'
            ? optionsText.split('\n').map((s) => s.trim()).filter(Boolean)
            : [],
        required,
        showInList,
        order: Number(order),
        fieldKind,
      };
      if (fieldKind === 'formula') {
        body.formulaExpr = formulaExpr;
      } else if (fieldKind === 'lookup') {
        body.lookupConfig = { relation: lookupRelation, field: lookupField };
      } else if (fieldKind === 'rollup') {
        body.rollupConfig = {
          relation: rollupRelation,
          op: rollupOp,
          ...(rollupOp !== 'count' ? { field: rollupField } : {}),
        };
      }
      const url = editing
        ? `${API_BASE}/api/v1/custom-fields/${editing.id}`
        : `${API_BASE}/api/v1/custom-fields`;
      const res = await fetch(url, {
        method: editing ? 'PATCH' : 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${getToken()}`,
        },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const d = await res.json().catch(() => null);
        setError(d?.message ?? 'Failed to save field');
        return;
      }
      onSaved();
    } finally {
      setSaving(false);
    }
  };

  const inputCls =
    'w-full px-3 py-2 border border-gray-200 dark:border-gray-700 rounded-lg text-sm';

  // Disable Save when a computed field is missing required config.
  const computedInvalid =
    (fieldKind === 'formula' && (!formulaExpr.trim() || formulaPreview?.valid === false)) ||
    (fieldKind === 'lookup' && (!lookupRelation || !lookupField)) ||
    (fieldKind === 'rollup' &&
      (!rollupRelation || (rollupOp !== 'count' && !rollupField)));

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
      <div className="bg-white dark:bg-gray-900 rounded-xl shadow-lg max-w-md w-full p-6 max-h-[90vh] overflow-y-auto">
        <h2 className="text-lg font-semibold mb-4">
          {editing ? 'Edit' : 'New'} Custom Field
        </h2>
        <div className="space-y-4">
          <div>
            <label className="block text-xs text-gray-600 dark:text-gray-400 mb-1">Name</label>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              className={inputCls}
            />
          </div>

          {/* ── Field kind selector ── */}
          <div>
            <label className="block text-xs text-gray-600 dark:text-gray-400 mb-1">Field kind</label>
            <select
              value={fieldKind}
              onChange={(e) => setFieldKind(e.target.value as FieldKind)}
              className={inputCls}
            >
              {FIELD_KINDS.map((k) => (
                <option key={k.value} value={k.value}>
                  {k.label}
                </option>
              ))}
            </select>
            {fieldKind !== 'input' && (
              <p className="text-xs text-violet-600 mt-1">
                Computed fields are read-only — values are calculated on read, never editable on the record.
              </p>
            )}
          </div>

          {/* Display type only matters for input fields */}
          {fieldKind === 'input' && (
            <>
              <div>
                <label className="block text-xs text-gray-600 dark:text-gray-400 mb-1">Type</label>
                <select
                  value={fieldType}
                  onChange={(e) => setFieldType(e.target.value)}
                  className={inputCls}
                >
                  {FIELD_TYPES.map((t) => (
                    <option key={t} value={t}>
                      {t}
                    </option>
                  ))}
                </select>
              </div>
              {fieldType === 'select' && (
                <div>
                  <label className="block text-xs text-gray-600 dark:text-gray-400 mb-1">
                    Options (one per line)
                  </label>
                  <textarea
                    value={optionsText}
                    onChange={(e) => setOptionsText(e.target.value)}
                    rows={4}
                    className={inputCls}
                  />
                </div>
              )}
            </>
          )}

          {/* ── Formula config ── */}
          {fieldKind === 'formula' && (
            <div className="space-y-2">
              <div>
                <label className="block text-xs text-gray-600 dark:text-gray-400 mb-1">
                  Expression (arithmetic: + - * / and parentheses only)
                </label>
                <input
                  value={formulaExpr}
                  onChange={(e) => setFormulaExpr(e.target.value)}
                  placeholder="e.g. quantity * unitPrice"
                  className={`${inputCls} font-mono`}
                />
              </div>
              {meta && (
                <p className="text-xs text-gray-500">
                  Available keys:{' '}
                  {meta.formulaVariables.length === 0 ? (
                    <span className="italic">none yet</span>
                  ) : (
                    meta.formulaVariables.map((k) => (
                      <code
                        key={k}
                        className="bg-gray-100 dark:bg-gray-800 px-1 rounded mr-1"
                      >
                        {k}
                      </code>
                    ))
                  )}
                </p>
              )}
              {formulaPreview && (
                <p className={`text-xs ${formulaPreview.valid ? 'text-green-600' : 'text-red-600'}`}>
                  {formulaPreview.valid
                    ? `This references: ${formulaPreview.refs.length ? formulaPreview.refs.join(', ') : '(constants only)'}`
                    : `Invalid: ${formulaPreview.error}`}
                </p>
              )}
            </div>
          )}

          {/* ── Lookup config ── */}
          {fieldKind === 'lookup' && (
            <div className="space-y-2">
              <div>
                <label className="block text-xs text-gray-600 dark:text-gray-400 mb-1">Relation</label>
                <select
                  value={lookupRelation}
                  onChange={(e) => {
                    setLookupRelation(e.target.value);
                    setLookupField('');
                  }}
                  className={inputCls}
                >
                  <option value="">-- Select relation --</option>
                  {(meta?.lookupRelations ?? []).map((r) => (
                    <option key={r.relation} value={r.relation}>
                      {r.relation}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-xs text-gray-600 dark:text-gray-400 mb-1">Field</label>
                <select
                  value={lookupField}
                  onChange={(e) => setLookupField(e.target.value)}
                  className={inputCls}
                  disabled={!lookupRelDef}
                >
                  <option value="">-- Select field --</option>
                  {(lookupRelDef?.fields ?? []).map((f) => (
                    <option key={f} value={f}>
                      {f}
                    </option>
                  ))}
                </select>
              </div>
              {(meta?.lookupRelations ?? []).length === 0 && (
                <p className="text-xs text-gray-500 italic">No lookup relations available for this entity.</p>
              )}
            </div>
          )}

          {/* ── Rollup config ── */}
          {fieldKind === 'rollup' && (
            <div className="space-y-2">
              <div>
                <label className="block text-xs text-gray-600 dark:text-gray-400 mb-1">Child relation</label>
                <select
                  value={rollupRelation}
                  onChange={(e) => {
                    setRollupRelation(e.target.value);
                    setRollupField('');
                  }}
                  className={inputCls}
                >
                  <option value="">-- Select relation --</option>
                  {(meta?.rollupRelations ?? []).map((r) => (
                    <option key={r.relation} value={r.relation}>
                      {r.relation}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-xs text-gray-600 dark:text-gray-400 mb-1">Operation</label>
                <select
                  value={rollupOp}
                  onChange={(e) => setRollupOp(e.target.value)}
                  className={inputCls}
                >
                  {(meta?.rollupOps ?? ROLLUP_OPS).map((o) => (
                    <option key={o} value={o}>
                      {o}
                    </option>
                  ))}
                </select>
              </div>
              {rollupOp !== 'count' && (
                <div>
                  <label className="block text-xs text-gray-600 dark:text-gray-400 mb-1">Field</label>
                  <select
                    value={rollupField}
                    onChange={(e) => setRollupField(e.target.value)}
                    className={inputCls}
                    disabled={!rollupRelDef}
                  >
                    <option value="">-- Select field --</option>
                    {(rollupRelDef?.fields ?? []).map((f) => (
                      <option key={f} value={f}>
                        {f}
                      </option>
                    ))}
                  </select>
                </div>
              )}
              {(meta?.rollupRelations ?? []).length === 0 && (
                <p className="text-xs text-gray-500 italic">No rollup relations available for this entity.</p>
              )}
            </div>
          )}

          <div className="flex items-center gap-4">
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={required}
                disabled={fieldKind !== 'input'}
                onChange={(e) => setRequired(e.target.checked)}
              />
              Required
            </label>
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={showInList}
                onChange={(e) => setShowInList(e.target.checked)}
              />
              Show in list
            </label>
          </div>
          <div>
            <label className="block text-xs text-gray-600 dark:text-gray-400 mb-1">Order</label>
            <input
              type="number"
              value={order}
              onChange={(e) => setOrder(Number(e.target.value))}
              className={inputCls}
            />
          </div>
          {error && <p className="text-xs text-red-600">{error}</p>}
        </div>
        <div className="mt-6 flex justify-end gap-2">
          <button
            onClick={onClose}
            className="px-4 py-2 text-sm rounded-lg border border-gray-200 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-800"
          >
            Cancel
          </button>
          <button
            onClick={save}
            disabled={saving || !name || computedInvalid}
            className="px-4 py-2 text-sm rounded-lg bg-primary text-white hover:bg-primary/90 disabled:opacity-50"
          >
            {saving ? 'Saving…' : 'Save'}
          </button>
        </div>
      </div>
    </div>
  );
}
