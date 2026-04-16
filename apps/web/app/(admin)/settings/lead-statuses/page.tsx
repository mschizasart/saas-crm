'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';

const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001';

function headers(): HeadersInit {
  const token = typeof window === 'undefined' ? null : localStorage.getItem('access_token');
  return { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
}

interface LeadStatus {
  id: string;
  name: string;
  color: string;
  position: number;
  isDefault: boolean;
  _count?: { leads: number };
}

export default function LeadStatusesPage() {
  const [statuses, setStatuses] = useState<LeadStatus[]>([]);
  const [loading, setLoading] = useState(true);
  const [editId, setEditId] = useState<string | null>(null);
  const [showNew, setShowNew] = useState(false);
  const [form, setForm] = useState({ name: '', color: '#6b7280', isDefault: false });
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  async function load() {
    try {
      const res = await fetch(`${API_BASE}/api/v1/leads/admin/statuses`, { headers: headers() });
      if (res.ok) setStatuses(await res.json());
    } catch { /* ignore */ }
    setLoading(false);
  }

  useEffect(() => { load(); }, []);

  function startEdit(s: LeadStatus) {
    setEditId(s.id);
    setForm({ name: s.name, color: s.color, isDefault: s.isDefault });
    setShowNew(false);
  }

  function startNew() {
    setEditId(null);
    setForm({ name: '', color: '#6b7280', isDefault: false });
    setShowNew(true);
  }

  async function save() {
    setSaving(true);
    setMessage(null);
    try {
      const url = editId
        ? `${API_BASE}/api/v1/leads/admin/statuses/${editId}`
        : `${API_BASE}/api/v1/leads/admin/statuses`;
      const method = editId ? 'PATCH' : 'POST';
      const res = await fetch(url, { method, headers: headers(), body: JSON.stringify(form) });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        throw new Error(j.message || `Failed (${res.status})`);
      }
      setMessage(editId ? 'Updated' : 'Created');
      setShowNew(false);
      setEditId(null);
      await load();
    } catch (err) {
      setMessage(err instanceof Error ? err.message : 'Failed');
    } finally {
      setSaving(false);
    }
  }

  async function deleteStatus(id: string) {
    if (!confirm('Delete this status?')) return;
    try {
      const res = await fetch(`${API_BASE}/api/v1/leads/admin/statuses/${id}`, { method: 'DELETE', headers: headers() });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        setMessage(j.message || 'Failed to delete');
        return;
      }
      await load();
    } catch { /* ignore */ }
  }

  if (loading) return <div className="p-6 text-sm text-gray-500">Loading...</div>;

  return (
    <div className="max-w-3xl">
      <div className="mb-4">
        <Link href="/settings" className="text-sm text-gray-500 hover:text-primary">← Settings</Link>
      </div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Lead Statuses</h1>
          <p className="text-sm text-gray-500 mt-1">Manage the statuses available for leads in the pipeline</p>
        </div>
        <button onClick={startNew} className="px-4 py-2 bg-primary text-white text-sm font-medium rounded-lg hover:bg-primary/90">
          + New Status
        </button>
      </div>

      {message && (
        <div className="mb-4 px-3 py-2 bg-blue-50 border border-blue-100 text-sm text-blue-700 rounded">{message}</div>
      )}

      {(showNew || editId) && (
        <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-6 mb-6">
          <h2 className="text-sm font-semibold text-gray-700 mb-4">{editId ? 'Edit Status' : 'New Status'}</h2>
          <div className="flex gap-4 items-end">
            <div className="flex-1">
              <label className="block text-xs font-medium text-gray-600 mb-1">Name *</label>
              <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg" />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Color</label>
              <input type="color" value={form.color} onChange={(e) => setForm({ ...form, color: e.target.value })} className="h-10 w-16 rounded border border-gray-200" />
            </div>
            <label className="flex items-center gap-1 text-sm">
              <input type="checkbox" checked={form.isDefault} onChange={(e) => setForm({ ...form, isDefault: e.target.checked })} />
              Default
            </label>
            <button onClick={save} disabled={saving || !form.name} className="px-4 py-2 bg-primary text-white text-sm rounded-lg disabled:opacity-50">
              {saving ? 'Saving...' : editId ? 'Update' : 'Create'}
            </button>
            <button onClick={() => { setShowNew(false); setEditId(null); }} className="px-3 py-2 text-sm text-gray-500">Cancel</button>
          </div>
        </div>
      )}

      <div className="bg-white rounded-xl border border-gray-100 shadow-sm">
        {statuses.length === 0 ? (
          <div className="p-8 text-center text-sm text-gray-400">No statuses configured yet.</div>
        ) : (
          <div className="divide-y divide-gray-50">
            {statuses.map((s) => (
              <div key={s.id} className="flex items-center justify-between px-4 py-3 hover:bg-gray-50/50">
                <div className="flex items-center gap-3">
                  <div className="w-4 h-4 rounded-full border border-gray-200" style={{ backgroundColor: s.color }} />
                  <span className="font-medium text-gray-900">{s.name}</span>
                  {s.isDefault && <span className="text-xs bg-gray-100 text-gray-500 px-2 py-0.5 rounded">Default</span>}
                  <span className="text-xs text-gray-400">{s._count?.leads ?? 0} leads</span>
                </div>
                <div className="flex gap-2">
                  <button onClick={() => startEdit(s)} className="text-xs text-primary hover:underline">Edit</button>
                  <button onClick={() => deleteStatus(s.id)} className="text-xs text-red-500 hover:underline">Delete</button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
