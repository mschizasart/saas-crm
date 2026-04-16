'use client';
import { useEffect, useState } from 'react';

const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001';

interface CustomField {
  id: string;
  name: string;
  slug: string;
  fieldType: string;
  type: string;
  options: string[];
  required: boolean;
  active?: boolean;
}

interface CustomFieldsFormProps {
  fieldTo: string;
  entityId?: string;
  values: Record<string, string>;
  onChange: (values: Record<string, string>) => void;
}

export function CustomFieldsForm({ fieldTo, entityId, values, onChange }: CustomFieldsFormProps) {
  const [fields, setFields] = useState<CustomField[]>([]);

  useEffect(() => {
    const token = localStorage.getItem('access_token');
    if (!token) return;
    fetch(`${API_BASE}/api/v1/custom-fields?fieldTo=${fieldTo}`, {
      headers: { Authorization: `Bearer ${token}` },
    })
      .then(r => r.json())
      .then(data => {
        const list = Array.isArray(data) ? data : data.data ?? [];
        setFields(list.filter((f: any) => f.active !== false));
      })
      .catch(() => {});

    if (entityId) {
      fetch(`${API_BASE}/api/v1/custom-fields/values/${fieldTo}/${entityId}`, {
        headers: { Authorization: `Bearer ${token}` },
      })
        .then(r => r.json())
        .then(data => {
          const loaded: Record<string, string> = {};
          const items = Array.isArray(data) ? data : data.data ?? [];
          items.forEach((v: any) => {
            loaded[v.field?.slug ?? v.fieldId] = v.value ?? '';
          });
          onChange({ ...values, ...loaded });
        })
        .catch(() => {});
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fieldTo, entityId]);

  if (fields.length === 0) return null;

  function update(slug: string, val: string) {
    onChange({ ...values, [slug]: val });
  }

  const ft = (f: CustomField) => f.fieldType || f.type;

  const inputClass = 'w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary bg-white';

  return (
    <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-6">
      <h3 className="text-sm font-semibold text-gray-700 mb-4">Custom Fields</h3>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        {fields.map(f => (
          <div key={f.id}>
            <label className="block text-xs font-medium text-gray-600 mb-1">
              {f.name}{f.required && <span className="text-red-500 ml-0.5">*</span>}
            </label>
            {ft(f) === 'text' && (
              <input type="text" value={values[f.slug] ?? ''} onChange={e => update(f.slug, e.target.value)} required={f.required} className={inputClass} />
            )}
            {ft(f) === 'textarea' && (
              <textarea rows={3} value={values[f.slug] ?? ''} onChange={e => update(f.slug, e.target.value)} required={f.required} className={inputClass} />
            )}
            {ft(f) === 'number' && (
              <input type="number" value={values[f.slug] ?? ''} onChange={e => update(f.slug, e.target.value)} required={f.required} className={inputClass} />
            )}
            {ft(f) === 'date' && (
              <input type="date" value={values[f.slug] ?? ''} onChange={e => update(f.slug, e.target.value)} required={f.required} className={inputClass} />
            )}
            {(ft(f) === 'url' || ft(f) === 'email') && (
              <input type={ft(f)} value={values[f.slug] ?? ''} onChange={e => update(f.slug, e.target.value)} required={f.required} className={inputClass} />
            )}
            {ft(f) === 'select' && (
              <select value={values[f.slug] ?? ''} onChange={e => update(f.slug, e.target.value)} required={f.required} className={inputClass}>
                <option value="">-- Select --</option>
                {(f.options ?? []).map(o => <option key={o} value={o}>{o}</option>)}
              </select>
            )}
            {ft(f) === 'checkbox' && (
              <label className="flex items-center gap-2">
                <input type="checkbox" checked={values[f.slug] === 'true'} onChange={e => update(f.slug, e.target.checked ? 'true' : 'false')} />
                <span className="text-sm text-gray-700">{f.name}</span>
              </label>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
