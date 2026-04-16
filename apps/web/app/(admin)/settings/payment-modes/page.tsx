'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';

const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001';

function getToken(): string | null {
  if (typeof window === 'undefined') return null;
  return localStorage.getItem('access_token');
}

function headers(): HeadersInit {
  return { Authorization: `Bearer ${getToken()}`, 'Content-Type': 'application/json' };
}

interface PaymentMode {
  id: string;
  name: string;
  description?: string | null;
  active: boolean;
  gatewayClass?: string | null;
}

export default function PaymentModesPage() {
  const [items, setItems] = useState<PaymentMode[]>([]);
  const [loading, setLoading] = useState(true);
  const [editId, setEditId] = useState<string | null>(null);
  const [showNew, setShowNew] = useState(false);
  const [form, setForm] = useState({ name: '', description: '', active: true });
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  async function loadItems() {
    try {
      const res = await fetch(`${API_BASE}/api/v1/payments/modes`, { headers: headers() });
      if (res.ok) {
        const data = await res.json();
        setItems(Array.isArray(data) ? data : (data.data ?? []));
      }
    } catch { /* ignore */ }
    setLoading(false);
  }

  useEffect(() => { loadItems(); }, []);

  function startEdit(item: PaymentMode) {
    setEditId(item.id);
    setForm({
      name: item.name,
      description: item.description ?? '',
      active: item.active,
    });
    setShowNew(false);
  }

  function startNew() {
    setEditId(null);
    setForm({ name: '', description: '', active: true });
    setShowNew(true);
  }

  async function saveItem() {
    setSaving(true);
    setMessage(null);
    try {
      const payload: Record<string, any> = {
        name: form.name,
        description: form.description || undefined,
        active: form.active,
      };

      const url = editId
        ? `${API_BASE}/api/v1/payments/modes/${editId}`
        : `${API_BASE}/api/v1/payments/modes`;
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
    if (!confirm('Delete this payment mode?')) return;
    try {
      await fetch(`${API_BASE}/api/v1/payments/modes/${id}`, { method: 'DELETE', headers: headers() });
      await loadItems();
    } catch { /* ignore */ }
  }

  async function toggleActive(item: PaymentMode) {
    try {
      await fetch(`${API_BASE}/api/v1/payments/modes/${item.id}`, {
        method: 'PATCH',
        headers: headers(),
        body: JSON.stringify({ active: !item.active }),
      });
      await loadItems();
    } catch { /* ignore */ }
  }

  if (loading) return <div className="p-6 text-sm text-gray-500">Loading...</div>;

  return (
    <div className="max-w-4xl">
      <div className="mb-4">
        <Link href="/settings" className="text-sm text-gray-500 hover:text-primary">&larr; Settings</Link>
      </div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Payment Modes</h1>
          <p className="text-sm text-gray-500 mt-1">Manage accepted payment methods for invoices</p>
        </div>
        <button onClick={startNew} className="px-4 py-2 bg-primary text-white text-sm font-medium rounded-lg hover:bg-primary/90">
          + New Mode
        </button>
      </div>

      {message && (
        <div className="mb-4 px-3 py-2 bg-blue-50 border border-blue-100 text-sm text-blue-700 rounded">{message}</div>
      )}

      {(showNew || editId) && (
        <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-6 mb-6">
          <h2 className="text-sm font-semibold text-gray-700 mb-4">{editId ? 'Edit Payment Mode' : 'New Payment Mode'}</h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="sm:col-span-2">
              <label className="block text-xs font-medium text-gray-600 mb-1">Name *</label>
              <input
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg"
                placeholder="e.g. Bank Transfer"
              />
            </div>
            <div className="sm:col-span-2">
              <label className="block text-xs font-medium text-gray-600 mb-1">Description</label>
              <textarea
                rows={2}
                value={form.description}
                onChange={(e) => setForm({ ...form, description: e.target.value })}
                className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg"
              />
            </div>
            <div className="flex items-center">
              <label className="inline-flex items-center gap-2 text-sm text-gray-700">
                <input
                  type="checkbox"
                  checked={form.active}
                  onChange={(e) => setForm({ ...form, active: e.target.checked })}
                  className="w-4 h-4 rounded border-gray-300 text-primary focus:ring-primary/30"
                />
                Active
              </label>
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
              className="px-4 py-2 text-sm font-medium text-gray-600 hover:text-gray-900"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      <div className="bg-white rounded-xl border border-gray-100 shadow-sm">
        {items.length === 0 ? (
          <div className="p-8 text-center text-sm text-gray-400">
            No payment modes yet. Click "+ New Mode" to create one.
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs text-gray-500 uppercase border-b border-gray-100">
                <th className="px-4 py-3">Name</th>
                <th className="px-4 py-3">Description</th>
                <th className="px-4 py-3 w-24">Active</th>
                <th className="px-4 py-3 w-24" />
              </tr>
            </thead>
            <tbody>
              {items.map((item) => (
                <tr key={item.id} className="border-b border-gray-50 hover:bg-gray-50/50">
                  <td className="px-4 py-3 font-medium text-gray-900">{item.name}</td>
                  <td className="px-4 py-3 text-gray-500">{item.description || '-'}</td>
                  <td className="px-4 py-3">
                    <button
                      onClick={() => toggleActive(item)}
                      className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${
                        item.active ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-500'
                      }`}
                    >
                      {item.active ? 'Active' : 'Inactive'}
                    </button>
                  </td>
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
        )}
      </div>
    </div>
  );
}
