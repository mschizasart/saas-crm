'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { SettingsPageLayout, SettingsSection } from '@/components/layouts/settings-page-layout';
import { typography } from '@/lib/ui-tokens';

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

  if (loading) return <div className="p-6 text-sm text-gray-500 dark:text-gray-400">Loading...</div>;

  return (
    <SettingsPageLayout title="Predefined Replies" description="Template replies for support tickets -- insert with one click when replying">
      <div className="mb-[-0.5rem]">
        <Link href="/settings" className={`${typography.bodyMuted} hover:text-primary`}>← Settings</Link>
      </div>

      {message && (
        <div className="px-3 py-2 bg-blue-50 border border-blue-100 text-sm text-blue-700 rounded">{message}</div>
      )}

      <SettingsSection title="Manage predefined replies">
        <div className="flex items-center justify-end mb-4">
          <button onClick={startNew} className="px-4 py-2 bg-primary text-white text-sm font-medium rounded-lg hover:bg-primary/90">
            + New Reply
          </button>
        </div>

        {(showNew || editId) && (
          <div className="mb-6 p-4 border border-gray-100 dark:border-gray-800 rounded-lg bg-gray-50/40 dark:bg-gray-900/40">
            <h3 className={`${typography.label} mb-4`}>{editId ? 'Edit Reply' : 'New Reply'}</h3>
            <div className="space-y-4">
              <div>
                <label className={`${typography.caption} block mb-1`}>Name *</label>
                <input
                  value={form.name}
                  onChange={(e) => setForm({ ...form, name: e.target.value })}
                  className="w-full px-3 py-2 text-sm border border-gray-200 dark:border-gray-700 rounded-lg"
                  placeholder="e.g. Password Reset Instructions"
                />
              </div>
              <div>
                <label className={`${typography.caption} block mb-1`}>Reply Body *</label>
                <textarea
                  rows={6}
                  value={form.body}
                  onChange={(e) => setForm({ ...form, body: e.target.value })}
                  className="w-full px-3 py-2 text-sm border border-gray-200 dark:border-gray-700 rounded-lg font-mono"
                  placeholder="Type the reply template here..."
                />
              </div>
            </div>
            <div className="flex gap-2 mt-4">
              <button onClick={save} disabled={saving || !form.name || !form.body} className="px-4 py-2 bg-primary text-white text-sm rounded-lg disabled:opacity-50">
                {saving ? 'Saving...' : editId ? 'Update' : 'Create'}
              </button>
              <button onClick={() => { setShowNew(false); setEditId(null); }} className="px-3 py-2 text-sm text-gray-500 dark:text-gray-400">Cancel</button>
            </div>
          </div>
        )}

        {replies.length === 0 ? (
          <div className="p-8 text-center text-sm text-gray-400 dark:text-gray-500">No predefined replies yet.</div>
        ) : (
          <div className="divide-y divide-gray-100 dark:divide-gray-800 border border-gray-100 dark:border-gray-800 rounded-lg">
            {replies.map((r) => (
              <div key={r.id} className="px-4 py-3 hover:bg-gray-50/50">
                <div className="flex items-center justify-between">
                  <span className="font-medium text-gray-900 dark:text-gray-100">{r.name}</span>
                  <div className="flex gap-2">
                    <button onClick={() => startEdit(r)} className="text-xs text-primary hover:underline">Edit</button>
                    <button onClick={() => deleteReply(r.id)} className="text-xs text-red-500 hover:underline">Delete</button>
                  </div>
                </div>
                <p className={`${typography.caption} mt-1 line-clamp-2`}>{r.body}</p>
              </div>
            ))}
          </div>
        )}
      </SettingsSection>
    </SettingsPageLayout>
  );
}
