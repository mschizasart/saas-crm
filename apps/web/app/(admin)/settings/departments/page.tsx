'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { SettingsPageLayout, SettingsSection } from '@/components/layouts/settings-page-layout';
import { typography } from '@/lib/ui-tokens';

const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001';

function getToken(): string | null {
  if (typeof window === 'undefined') return null;
  return localStorage.getItem('access_token');
}

function headers(): HeadersInit {
  return { Authorization: `Bearer ${getToken()}`, 'Content-Type': 'application/json' };
}

interface Department {
  id: string;
  name: string;
  email?: string | null;
  slaResponseHours?: number | null;
  slaResolutionHours?: number | null;
  _count?: { tickets: number };
}

export default function DepartmentsPage() {
  const [items, setItems] = useState<Department[]>([]);
  const [loading, setLoading] = useState(true);
  const [editId, setEditId] = useState<string | null>(null);
  const [showNew, setShowNew] = useState(false);
  const [form, setForm] = useState({ name: '', email: '', slaResponseHours: '', slaResolutionHours: '' });
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  async function loadItems() {
    try {
      const res = await fetch(`${API_BASE}/api/v1/tickets/departments`, { headers: headers() });
      if (res.ok) {
        const data = await res.json();
        setItems(Array.isArray(data) ? data : (data.data ?? []));
      }
    } catch { /* ignore */ }
    setLoading(false);
  }

  useEffect(() => { loadItems(); }, []);

  function startEdit(item: Department) {
    setEditId(item.id);
    setForm({
      name: item.name,
      email: item.email ?? '',
      slaResponseHours: item.slaResponseHours != null ? String(item.slaResponseHours) : '',
      slaResolutionHours: item.slaResolutionHours != null ? String(item.slaResolutionHours) : '',
    });
    setShowNew(false);
  }

  function startNew() {
    setEditId(null);
    setForm({ name: '', email: '', slaResponseHours: '', slaResolutionHours: '' });
    setShowNew(true);
  }

  async function saveItem() {
    setSaving(true);
    setMessage(null);
    try {
      const payload: Record<string, any> = {
        name: form.name,
        email: form.email || undefined,
        slaResponseHours: form.slaResponseHours ? Number(form.slaResponseHours) : null,
        slaResolutionHours: form.slaResolutionHours ? Number(form.slaResolutionHours) : null,
      };

      const url = editId
        ? `${API_BASE}/api/v1/tickets/departments/${editId}`
        : `${API_BASE}/api/v1/tickets/departments`;
      const method = editId ? 'PATCH' : 'POST';

      const res = await fetch(url, { method, headers: headers(), body: JSON.stringify(payload) });
      if (!res.ok) throw new Error(`Failed (${res.status})`);
      setMessage(editId ? 'Updated' : 'Created');
      setShowNew(false);
      setEditId(null);
      await loadItems();
    } catch (err) {
      setMessage(err instanceof Error ? err.message : 'Failed');
    } finally {
      setSaving(false);
    }
  }

  async function deleteItem(id: string) {
    if (!confirm('Delete this department? Tickets will be unlinked.')) return;
    try {
      await fetch(`${API_BASE}/api/v1/tickets/departments/${id}`, { method: 'DELETE', headers: headers() });
      await loadItems();
    } catch { /* ignore */ }
  }

  if (loading) return <div className="p-6 text-sm text-gray-500 dark:text-gray-400">Loading...</div>;

  return (
    <SettingsPageLayout title="Departments" description="Manage ticket departments for support routing">
      <div className="mb-[-0.5rem]">
        <Link href="/settings" className={`${typography.bodyMuted} hover:text-primary`}>&larr; Settings</Link>
      </div>

      {message && (
        <div className="px-3 py-2 bg-blue-50 border border-blue-100 text-sm text-blue-700 rounded">{message}</div>
      )}

      <SettingsSection
        title="Manage departments"
        description="Create, edit, or remove departments used for ticket routing"
      >
        <div className="flex items-center justify-end mb-4">
          <button onClick={startNew} className="px-4 py-2 bg-primary text-white text-sm font-medium rounded-lg hover:bg-primary/90">
            + New Department
          </button>
        </div>

        {(showNew || editId) && (
          <div className="mb-6 p-4 border border-gray-100 dark:border-gray-800 rounded-lg bg-gray-50/40 dark:bg-gray-900/40">
            <h3 className={`${typography.label} mb-4`}>{editId ? 'Edit Department' : 'New Department'}</h3>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className={`${typography.caption} block mb-1`}>Name *</label>
                <input
                  value={form.name}
                  onChange={(e) => setForm({ ...form, name: e.target.value })}
                  className="w-full px-3 py-2 text-sm border border-gray-200 dark:border-gray-700 rounded-lg"
                  placeholder="e.g. Technical Support"
                />
              </div>
              <div>
                <label className={`${typography.caption} block mb-1`}>Email</label>
                <input
                  type="email"
                  value={form.email}
                  onChange={(e) => setForm({ ...form, email: e.target.value })}
                  className="w-full px-3 py-2 text-sm border border-gray-200 dark:border-gray-700 rounded-lg"
                  placeholder="e.g. support@company.com"
                />
              </div>
              <div>
                <label className={`${typography.caption} block mb-1`}>Response SLA (hours)</label>
                <input
                  type="number"
                  min="0"
                  value={form.slaResponseHours}
                  onChange={(e) => setForm({ ...form, slaResponseHours: e.target.value })}
                  className="w-full px-3 py-2 text-sm border border-gray-200 dark:border-gray-700 rounded-lg"
                  placeholder="e.g. 4"
                />
              </div>
              <div>
                <label className={`${typography.caption} block mb-1`}>Resolution SLA (hours)</label>
                <input
                  type="number"
                  min="0"
                  value={form.slaResolutionHours}
                  onChange={(e) => setForm({ ...form, slaResolutionHours: e.target.value })}
                  className="w-full px-3 py-2 text-sm border border-gray-200 dark:border-gray-700 rounded-lg"
                  placeholder="e.g. 24"
                />
              </div>
            </div>
            <div className="flex gap-2 mt-4">
              <button
                onClick={saveItem}
                disabled={saving || !form.name}
                className="px-4 py-2 bg-primary text-white text-sm font-medium rounded-lg hover:bg-primary/90 disabled:opacity-50"
              >
                {saving ? 'Saving...' : editId ? 'Update' : 'Create'}
              </button>
              <button
                onClick={() => { setShowNew(false); setEditId(null); }}
                className="px-4 py-2 text-sm font-medium text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-gray-100"
              >
                Cancel
              </button>
            </div>
          </div>
        )}

        {items.length === 0 ? (
          <div className="p-8 text-center text-sm text-gray-400 dark:text-gray-500">
            No departments yet. Click "+ New Department" to create one.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs text-gray-500 dark:text-gray-400 uppercase border-b border-gray-100 dark:border-gray-800">
                  <th className="px-4 py-3">Name</th>
                  <th className="px-4 py-3">Email</th>
                  <th className="px-4 py-3 w-28">Response SLA</th>
                  <th className="px-4 py-3 w-28">Resolution SLA</th>
                  <th className="px-4 py-3 w-24">Tickets</th>
                  <th className="px-4 py-3 w-24" />
                </tr>
              </thead>
              <tbody>
                {items.map((item) => (
                  <tr key={item.id} className="border-b border-gray-50 hover:bg-gray-50/50">
                    <td className="px-4 py-3 font-medium text-gray-900 dark:text-gray-100">{item.name}</td>
                    <td className="px-4 py-3 text-gray-500 dark:text-gray-400">{item.email || '-'}</td>
                    <td className="px-4 py-3 text-gray-500 dark:text-gray-400">{item.slaResponseHours ? `${item.slaResponseHours}h` : '-'}</td>
                    <td className="px-4 py-3 text-gray-500 dark:text-gray-400">{item.slaResolutionHours ? `${item.slaResolutionHours}h` : '-'}</td>
                    <td className="px-4 py-3 text-gray-500 dark:text-gray-400">{item._count?.tickets ?? 0}</td>
                    <td className="px-4 py-3">
                      <div className="flex gap-2">
                        <button onClick={() => startEdit(item)} className="text-xs text-primary hover:underline">Edit</button>
                        <button onClick={() => deleteItem(item.id)} className="text-xs text-red-500 hover:underline">Delete</button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </SettingsSection>
    </SettingsPageLayout>
  );
}
