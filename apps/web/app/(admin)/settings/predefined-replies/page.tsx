'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';

const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001';

function headers(): HeadersInit {
  const token = typeof window === 'undefined' ? null : localStorage.getItem('access_token');
  return { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
}

interface PredefinedReply {
  id: string;
  name: string;
  body: string;
}

export default function PredefinedRepliesPage() {
  const [replies, setReplies] = useState<PredefinedReply[]>([]);
  const [loading, setLoading] = useState(true);
  const [editId, setEditId] = useState<string | null>(null);
  const [showNew, setShowNew] = useState(false);
  const [form, setForm] = useState({ name: '', body: '' });
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  async function load() {
    try {
      const res = await fetch(`${API_BASE}/api/v1/predefined-replies`, { headers: headers() });
      if (res.ok) {
        const data = await res.json();
        setReplies(Array.isArray(data) ? data : (data.data ?? []));
      }
    } catch { /* ignore */ }
    setLoading(false);
  }

  useEffect(() => { load(); }, []);

  function startEdit(r: PredefinedReply) {
    setEditId(r.id);
    setForm({ name: r.name, body: r.body });
    setShowNew(false);
  }

  function startNew() {
    setEditId(null);
    setForm({ name: '', body: '' });
    setShowNew(true);
  }

  async function save() {
    setSaving(true);
    setMessage(null);
    try {
      const url = editId
        ? `${API_BASE}/api/v1/predefined-replies/${editId}`
        : `${API_BASE}/api/v1/predefined-replies`;
      const method = editId ? 'PATCH' : 'POST';
      const res = await fetch(url, { method, headers: headers(), body: JSON.stringify(form) });
      if (!res.ok) throw new Error(`Failed (${res.status})`);
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

  async function deleteReply(id: string) {
    if (!confirm('Delete this predefined reply?')) return;
    try {
      await fetch(`${API_BASE}/api/v1/predefined-replies/${id}`, { method: 'DELETE', headers: headers() });
      await load();
    } catch { /* ignore */ }
  }

  if (loading) return <div className="p-6 text-sm text-gray-500">Loading...</div>;

  return (
    <div className="max-w-4xl">
      <div className="mb-4">
        <Link href="/settings" className="text-sm text-gray-500 hover:text-primary">← Settings</Link>
      </div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Predefined Replies</h1>
          <p className="text-sm text-gray-500 mt-1">Template replies for support tickets -- insert with one click when replying</p>
        </div>
        <button onClick={startNew} className="px-4 py-2 bg-primary text-white text-sm font-medium rounded-lg hover:bg-primary/90">
          + New Reply
        </button>
      </div>

      {message && (
        <div className="mb-4 px-3 py-2 bg-blue-50 border border-blue-100 text-sm text-blue-700 rounded">{message}</div>
      )}

      {(showNew || editId) && (
        <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-6 mb-6">
          <h2 className="text-sm font-semibold text-gray-700 mb-4">{editId ? 'Edit Reply' : 'New Reply'}</h2>
          <div className="space-y-4">
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Name *</label>
              <input
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg"
                placeholder="e.g. Password Reset Instructions"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Reply Body *</label>
              <textarea
                rows={6}
                value={form.body}
                onChange={(e) => setForm({ ...form, body: e.target.value })}
                className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg font-mono"
                placeholder="Type the reply template here..."
              />
            </div>
          </div>
          <div className="flex gap-2 mt-4">
            <button onClick={save} disabled={saving || !form.name || !form.body} className="px-4 py-2 bg-primary text-white text-sm rounded-lg disabled:opacity-50">
              {saving ? 'Saving...' : editId ? 'Update' : 'Create'}
            </button>
            <button onClick={() => { setShowNew(false); setEditId(null); }} className="px-3 py-2 text-sm text-gray-500">Cancel</button>
          </div>
        </div>
      )}

      <div className="bg-white rounded-xl border border-gray-100 shadow-sm">
        {replies.length === 0 ? (
          <div className="p-8 text-center text-sm text-gray-400">No predefined replies yet.</div>
        ) : (
          <div className="divide-y divide-gray-50">
            {replies.map((r) => (
              <div key={r.id} className="px-4 py-3 hover:bg-gray-50/50">
                <div className="flex items-center justify-between">
                  <span className="font-medium text-gray-900">{r.name}</span>
                  <div className="flex gap-2">
                    <button onClick={() => startEdit(r)} className="text-xs text-primary hover:underline">Edit</button>
                    <button onClick={() => deleteReply(r.id)} className="text-xs text-red-500 hover:underline">Delete</button>
                  </div>
                </div>
                <p className="text-xs text-gray-500 mt-1 line-clamp-2">{r.body}</p>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
