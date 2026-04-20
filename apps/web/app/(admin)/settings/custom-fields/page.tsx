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

const FIELD_TYPES = [
  'text',
  'textarea',
  'number',
  'date',
  'select',
  'checkbox',
] as const;

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
      const res = await fetch(
        `${API_BASE}/api/v1/custom-fields?fieldTo=${module}`,
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
                <th className="px-4 py-3">Type</th>
                <th className="px-4 py-3">Required</th>
                <th className="px-4 py-3">Order</th>
                <th className="px-4 py-3 text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan={5} className="px-4 py-8 text-center text-gray-400 dark:text-gray-500">
                    Loading…
                  </td>
                </tr>
              ) : fields.length === 0 ? (
                <tr>
                  <td colSpan={5} className="px-4 py-8 text-center text-gray-400 dark:text-gray-500">
                    No custom fields for {module}
                  </td>
                </tr>
              ) : (
                fields.map((f) => (
                  <tr key={f.id} className="border-b border-gray-100 dark:border-gray-800 last:border-0">
                    <td className="px-4 py-3 font-medium text-gray-900 dark:text-gray-100">{f.name}</td>
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
                ))
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
  const [name, setName] = useState(editing?.name ?? '');
  const [fieldType, setFieldType] = useState(editing?.type ?? 'text');
  const [optionsText, setOptionsText] = useState(
    (editing?.options ?? []).join('\n'),
  );
  const [required, setRequired] = useState(editing?.required ?? false);
  const [showInList, setShowInList] = useState(editing?.showOnTable ?? false);
  const [order, setOrder] = useState(editing?.order ?? 0);
  const [saving, setSaving] = useState(false);

  const save = async () => {
    setSaving(true);
    try {
      const body = {
        fieldTo: module,
        name,
        fieldType,
        options:
          fieldType === 'select'
            ? optionsText.split('\n').map((s) => s.trim()).filter(Boolean)
            : [],
        required,
        showInList,
        order: Number(order),
      };
      const url = editing
        ? `${API_BASE}/api/v1/custom-fields/${editing.id}`
        : `${API_BASE}/api/v1/custom-fields`;
      await fetch(url, {
        method: editing ? 'PATCH' : 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${getToken()}`,
        },
        body: JSON.stringify(body),
      });
      onSaved();
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
      <div className="bg-white dark:bg-gray-900 rounded-xl shadow-lg max-w-md w-full p-6">
        <h2 className="text-lg font-semibold mb-4">
          {editing ? 'Edit' : 'New'} Custom Field
        </h2>
        <div className="space-y-4">
          <div>
            <label className="block text-xs text-gray-600 dark:text-gray-400 mb-1">Name</label>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="w-full px-3 py-2 border border-gray-200 dark:border-gray-700 rounded-lg text-sm"
            />
          </div>
          <div>
            <label className="block text-xs text-gray-600 dark:text-gray-400 mb-1">Type</label>
            <select
              value={fieldType}
              onChange={(e) => setFieldType(e.target.value)}
              className="w-full px-3 py-2 border border-gray-200 dark:border-gray-700 rounded-lg text-sm"
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
                className="w-full px-3 py-2 border border-gray-200 dark:border-gray-700 rounded-lg text-sm"
              />
            </div>
          )}
          <div className="flex items-center gap-4">
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={required}
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
              className="w-full px-3 py-2 border border-gray-200 dark:border-gray-700 rounded-lg text-sm"
            />
          </div>
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
            disabled={saving || !name}
            className="px-4 py-2 text-sm rounded-lg bg-primary text-white hover:bg-primary/90 disabled:opacity-50"
          >
            {saving ? 'Saving…' : 'Save'}
          </button>
        </div>
      </div>
    </div>
  );
}
