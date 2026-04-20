'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { apiFetch } from '@/lib/api';
import { SettingsPageLayout, SettingsSection } from '@/components/layouts/settings-page-layout';
import { typography } from '@/lib/ui-tokens';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface Category {
  id: string;
  name: string;
  color: string | null;
  _count?: { expenses: number };
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const DEFAULT_COLOR = '#6b7280';

const COLOR_SWATCHES = [
  '#ef4444', // red
  '#f97316', // orange
  '#f59e0b', // amber
  '#10b981', // emerald
  '#0ea5e9', // sky
  '#6366f1', // indigo
  '#a855f7', // purple
  '#ec4899', // pink
  '#6b7280', // gray
];

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default function ExpenseCategoriesPage() {
  const [items, setItems] = useState<Category[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [editId, setEditId] = useState<string | null>(null);
  const [showNew, setShowNew] = useState(false);
  const [form, setForm] = useState<{ name: string; color: string }>({
    name: '',
    color: DEFAULT_COLOR,
  });
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const [message, setMessage] = useState<string | null>(null);
  const [rowError, setRowError] = useState<{ id: string; msg: string } | null>(
    null,
  );

  // ---------------------------------------------------------------------------
  // Fetch
  // ---------------------------------------------------------------------------

  async function loadItems() {
    setLoading(true);
    setLoadError(null);
    try {
      const res = await apiFetch('/api/v1/expenses/categories');
      if (!res.ok) throw new Error(`Failed (${res.status})`);
      const data = await res.json();
      setItems(Array.isArray(data) ? data : (data.data ?? []));
    } catch (err) {
      setLoadError(
        err instanceof Error ? err.message : 'Failed to load categories',
      );
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadItems();
  }, []);

  // ---------------------------------------------------------------------------
  // Form helpers
  // ---------------------------------------------------------------------------

  function startEdit(item: Category) {
    setEditId(item.id);
    setShowNew(false);
    setForm({ name: item.name, color: item.color ?? DEFAULT_COLOR });
    setFormError(null);
  }

  function startNew() {
    setEditId(null);
    setShowNew(true);
    setForm({ name: '', color: DEFAULT_COLOR });
    setFormError(null);
  }

  function cancelForm() {
    setEditId(null);
    setShowNew(false);
    setFormError(null);
  }

  async function saveItem() {
    setSaving(true);
    setFormError(null);
    try {
      const payload = { name: form.name.trim(), color: form.color };
      if (!payload.name) {
        throw new Error('Name is required');
      }
      const url = editId
        ? `/api/v1/expenses/categories/${editId}`
        : '/api/v1/expenses/categories';
      const method = editId ? 'PATCH' : 'POST';
      const res = await apiFetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        throw new Error(body?.message ?? `Failed (${res.status})`);
      }
      setMessage(editId ? 'Category updated' : 'Category created');
      cancelForm();
      await loadItems();
    } catch (err) {
      setFormError(err instanceof Error ? err.message : 'Failed to save');
    } finally {
      setSaving(false);
    }
  }

  async function deleteItem(item: Category) {
    if (
      !confirm(
        `Delete category "${item.name}"? This cannot be undone.`,
      )
    ) {
      return;
    }
    setRowError(null);
    try {
      const res = await apiFetch(`/api/v1/expenses/categories/${item.id}`, {
        method: 'DELETE',
      });
      if (res.status === 204 || res.ok) {
        setMessage('Category deleted');
        await loadItems();
        return;
      }
      // Handle 409 (conflict - linked expenses exist) inline
      const body = await res.json().catch(() => null);
      const msg =
        body?.message ??
        (res.status === 409
          ? 'Cannot delete a category with linked expenses'
          : `Failed (${res.status})`);
      setRowError({ id: item.id, msg });
    } catch (err) {
      setRowError({
        id: item.id,
        msg: err instanceof Error ? err.message : 'Failed to delete',
      });
    }
  }

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------

  return (
    <SettingsPageLayout title="Expense Categories" description="Organize expenses by category for easier reporting">
      <div className="mb-[-0.5rem]">
        <Link
          href="/settings"
          className={`${typography.bodyMuted} hover:text-primary`}
        >
          &larr; Settings
        </Link>
      </div>

      {message && (
        <div className="px-3 py-2 bg-blue-50 border border-blue-100 text-sm text-blue-700 rounded">
          {message}
        </div>
      )}

      <SettingsSection title="Manage expense categories">
        <div className="flex items-center justify-end mb-4">
          <button
            onClick={startNew}
            className="px-4 py-2 bg-primary text-white text-sm font-medium rounded-lg hover:bg-primary/90"
          >
            + New Category
          </button>
        </div>

        {(showNew || editId) && (
          <div className="mb-6 p-4 border border-gray-100 dark:border-gray-800 rounded-lg bg-gray-50/40 dark:bg-gray-900/40">
            <h3 className={`${typography.label} mb-4`}>
              {editId ? 'Edit Category' : 'New Category'}
            </h3>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">
                Name *
              </label>
              <input
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                className="w-full px-3 py-2 text-sm border border-gray-200 dark:border-gray-700 rounded-lg"
                placeholder="e.g. Travel"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">
                Color
              </label>
              <div className="flex items-center gap-2">
                <input
                  type="color"
                  value={form.color}
                  onChange={(e) =>
                    setForm({ ...form, color: e.target.value })
                  }
                  className="w-10 h-9 border border-gray-200 dark:border-gray-700 rounded cursor-pointer"
                />
                <div className="flex flex-wrap gap-1.5">
                  {COLOR_SWATCHES.map((c) => (
                    <button
                      type="button"
                      key={c}
                      onClick={() => setForm({ ...form, color: c })}
                      className={[
                        'w-6 h-6 rounded-full border-2 transition',
                        form.color === c
                          ? 'border-gray-900'
                          : 'border-transparent hover:border-gray-300',
                      ].join(' ')}
                      style={{ backgroundColor: c }}
                      aria-label={`Pick ${c}`}
                    />
                  ))}
                </div>
              </div>
            </div>
          </div>

          {formError && (
            <div className="mt-3 px-3 py-2 bg-red-50 border border-red-100 text-xs text-red-600 rounded">
              {formError}
            </div>
          )}

          <div className="flex gap-2 mt-4">
            <button
              onClick={saveItem}
              disabled={saving || !form.name.trim()}
              className="px-4 py-2 bg-primary text-white text-sm font-medium rounded-lg hover:bg-primary/90 disabled:opacity-50"
            >
              {saving ? 'Saving…' : editId ? 'Update' : 'Create'}
            </button>
            <button
              onClick={cancelForm}
              className="px-4 py-2 text-sm font-medium text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-gray-100"
            >
              Cancel
            </button>
          </div>
          </div>
        )}

        {loading ? (
          <div className="p-6 space-y-3">
            {Array.from({ length: 3 }).map((_, i) => (
              <div
                key={i}
                className="h-10 bg-gray-100 dark:bg-gray-800 rounded animate-pulse"
              />
            ))}
          </div>
        ) : loadError ? (
          <div className="p-6 text-sm text-red-600">
            {loadError} —{' '}
            <button className="underline" onClick={loadItems}>
              retry
            </button>
          </div>
        ) : items.length === 0 ? (
          <div className="p-8 text-center text-sm text-gray-400 dark:text-gray-500">
            No categories yet. Click &ldquo;+ New Category&rdquo; to create one.
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs text-gray-500 dark:text-gray-400 uppercase border-b border-gray-100 dark:border-gray-800">
                <th className="px-4 py-3">Name</th>
                <th className="px-4 py-3 w-24">Color</th>
                <th className="px-4 py-3 w-32"># of expenses</th>
                <th className="px-4 py-3 w-32" />
              </tr>
            </thead>
            <tbody>
              {items.map((item) => {
                const rowErrorMsg =
                  rowError?.id === item.id ? rowError.msg : null;
                const count = item._count?.expenses ?? 0;
                return (
                  <tr
                    key={item.id}
                    className="border-b border-gray-50 last:border-0 hover:bg-gray-50/50"
                  >
                    <td className="px-4 py-3 font-medium text-gray-900 dark:text-gray-100">
                      {item.name}
                      {rowErrorMsg && (
                        <div className="mt-1 text-xs text-red-600">
                          {rowErrorMsg}
                        </div>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2">
                        <span
                          className="inline-block w-4 h-4 rounded-full border border-gray-200 dark:border-gray-700"
                          style={{
                            backgroundColor: item.color ?? DEFAULT_COLOR,
                          }}
                        />
                        <span className="text-xs text-gray-500 dark:text-gray-400 font-mono">
                          {item.color ?? '—'}
                        </span>
                      </div>
                    </td>
                    <td className="px-4 py-3 tabular-nums text-gray-600 dark:text-gray-400">
                      {count}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex gap-3">
                        <button
                          onClick={() => startEdit(item)}
                          className="text-xs text-primary hover:underline"
                        >
                          Edit
                        </button>
                        <button
                          onClick={() => deleteItem(item)}
                          className="text-xs text-red-500 hover:underline"
                        >
                          Delete
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </SettingsSection>
    </SettingsPageLayout>
  );
}
