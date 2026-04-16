'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';

const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001';

function headers(): HeadersInit {
  const token = typeof window === 'undefined' ? null : localStorage.getItem('access_token');
  return { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
}

interface LeadSource {
  id: string;
  name: string;
  _count?: { leads: number };
}

export default function LeadSourcesPage() {
  const [sources, setSources] = useState<LeadSource[]>([]);
  const [loading, setLoading] = useState(true);
  const [editId, setEditId] = useState<string | null>(null);
  const [showNew, setShowNew] = useState(false);
  const [name, setName] = useState('');
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  async function load() {
    try {
      const res = await fetch(`${API_BASE}/api/v1/leads/admin/sources`, { headers: headers() });
      if (res.ok) setSources(await res.json());
    } catch { /* ignore */ }
    setLoading(false);
  }

  useEffect(() => { load(); }, []);

  function startEdit(s: LeadSource) {
    setEditId(s.id);
    setName(s.name);
    setShowNew(false);
  }

  function startNew() {
    setEditId(null);
    setName('');
    setShowNew(true);
  }

  async function save() {
    setSaving(true);
    setMessage(null);
    try {
      const url = editId
        ? `${API_BASE}/api/v1/leads/admin/sources/${editId}`
        : `${API_BASE}/api/v1/leads/admin/sources`;
      const method = editId ? 'PATCH' : 'POST';
      const res = await fetch(url, { method, headers: headers(), body: JSON.stringify({ name }) });
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

  async function deleteSource(id: string) {
    if (!confirm('Delete this source?')) return;
    try {
      const res = await fetch(`${API_BASE}/api/v1/leads/admin/sources/${id}`, { method: 'DELETE', headers: headers() });
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
          <h1 className="text-2xl font-bold text-gray-900">Lead Sources</h1>
          <p className="text-sm text-gray-500 mt-1">Where your leads come from (e.g. Google, Referral, Cold Call)</p>
        </div>
        <button onClick={startNew} className="px-4 py-2 bg-primary text-white text-sm font-medium rounded-lg hover:bg-primary/90">
          + New Source
        </button>
      </div>

      {message && (
        <div className="mb-4 px-3 py-2 bg-blue-50 border border-blue-100 text-sm text-blue-700 rounded">{message}</div>
      )}

      {(showNew || editId) && (
        <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-6 mb-6">
          <div className="flex gap-4 items-end">
            <div className="flex-1">
              <label className="block text-xs font-medium text-gray-600 mb-1">Name *</label>
              <input value={name} onChange={(e) => setName(e.target.value)} className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg" placeholder="e.g. Google Ads" />
            </div>
            <button onClick={save} disabled={saving || !name} className="px-4 py-2 bg-primary text-white text-sm rounded-lg disabled:opacity-50">
              {saving ? 'Saving...' : editId ? 'Update' : 'Create'}
            </button>
            <button onClick={() => { setShowNew(false); setEditId(null); }} className="px-3 py-2 text-sm text-gray-500">Cancel</button>
          </div>
        </div>
      )}

      <div className="bg-white rounded-xl border border-gray-100 shadow-sm">
        {sources.length === 0 ? (
          <div className="p-8 text-center text-sm text-gray-400">No sources configured yet.</div>
        ) : (
          <div className="divide-y divide-gray-50">
            {sources.map((s) => (
              <div key={s.id} className="flex items-center justify-between px-4 py-3 hover:bg-gray-50/50">
                <div className="flex items-center gap-3">
                  <span className="font-medium text-gray-900">{s.name}</span>
                  <span className="text-xs text-gray-400">{s._count?.leads ?? 0} leads</span>
                </div>
                <div className="flex gap-2">
                  <button onClick={() => startEdit(s)} className="text-xs text-primary hover:underline">Edit</button>
                  <button onClick={() => deleteSource(s.id)} className="text-xs text-red-500 hover:underline">Delete</button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
