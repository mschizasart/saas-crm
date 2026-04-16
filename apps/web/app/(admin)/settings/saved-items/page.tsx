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

interface SavedItem {
  id: string;
  description: string;
  longDescription?: string;
  rate: number;
  taxRate: number;
  unit?: string;
  groupName?: string;
}

export default function SavedItemsPage() {
  const [items, setItems] = useState<SavedItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [editId, setEditId] = useState<string | null>(null);
  const [showNew, setShowNew] = useState(false);
  const [form, setForm] = useState({ description: '', longDescription: '', rate: '0', taxRate: '0', unit: '', groupName: '' });
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  async function loadItems() {
    try {
      const res = await fetch(`${API_BASE}/api/v1/saved-items`, { headers: headers() });
      if (res.ok) {
        const data = await res.json();
        setItems(Array.isArray(data) ? data : (data.data ?? []));
      }
    } catch { /* ignore */ }
    setLoading(false);
  }

  useEffect(() => { loadItems(); }, []);

  function startEdit(item: SavedItem) {
    setEditId(item.id);
    setForm({
      description: item.description,
      longDescription: item.longDescription ?? '',
      rate: String(item.rate),
      taxRate: String(item.taxRate),
      unit: item.unit ?? '',
      groupName: item.groupName ?? '',
    });
    setShowNew(false);
  }

  function startNew() {
    setEditId(null);
    setForm({ description: '', longDescription: '', rate: '0', taxRate: '0', unit: '', groupName: '' });
    setShowNew(true);
  }

  async function saveItem() {
    setSaving(true);
    setMessage(null);
    try {
      const payload = {
        description: form.description,
        longDescription: form.longDescription || undefined,
        rate: Number(form.rate) || 0,
        taxRate: Number(form.taxRate) || 0,
        unit: form.unit || undefined,
        groupName: form.groupName || undefined,
      };

      const url = editId
        ? `${API_BASE}/api/v1/saved-items/${editId}`
        : `${API_BASE}/api/v1/saved-items`;
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
    if (!confirm('Delete this saved item?')) return;
    try {
      await fetch(`${API_BASE}/api/v1/saved-items/${id}`, { method: 'DELETE', headers: headers() });
      await loadItems();
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
          <h1 className="text-2xl font-bold text-gray-900">Saved Items</h1>
          <p className="text-sm text-gray-500 mt-1">Predefined line items for invoices, estimates, and credit notes</p>
        </div>
        <button onClick={startNew} className="px-4 py-2 bg-primary text-white text-sm font-medium rounded-lg hover:bg-primary/90">
          + New Item
        </button>
      </div>

      {message && (
        <div className="mb-4 px-3 py-2 bg-blue-50 border border-blue-100 text-sm text-blue-700 rounded">{message}</div>
      )}

      {(showNew || editId) && (
        <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-6 mb-6">
          <h2 className="text-sm font-semibold text-gray-700 mb-4">{editId ? 'Edit Item' : 'New Item'}</h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="sm:col-span-2">
              <label className="block text-xs font-medium text-gray-600 mb-1">Description *</label>
              <input
                value={form.description}
                onChange={(e) => setForm({ ...form, description: e.target.value })}
                className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg"
                placeholder="e.g. Web Design Service"
              />
            </div>
            <div className="sm:col-span-2">
              <label className="block text-xs font-medium text-gray-600 mb-1">Long Description</label>
              <textarea
                rows={2}
                value={form.longDescription}
                onChange={(e) => setForm({ ...form, longDescription: e.target.value })}
                className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Rate *</label>
              <input
                type="number"
                step="0.01"
                value={form.rate}
                onChange={(e) => setForm({ ...form, rate: e.target.value })}
                className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Tax Rate %</label>
              <input
                type="number"
                step="0.01"
                value={form.taxRate}
                onChange={(e) => setForm({ ...form, taxRate: e.target.value })}
                className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Unit</label>
              <input
                value={form.unit}
                onChange={(e) => setForm({ ...form, unit: e.target.value })}
                className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg"
                placeholder="e.g. hours, items"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Group</label>
              <input
                value={form.groupName}
                onChange={(e) => setForm({ ...form, groupName: e.target.value })}
                className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg"
                placeholder="e.g. Services, Products"
              />
            </div>
          </div>
          <div className="flex gap-2 mt-4">
            <button
              onClick={saveItem}
              disabled={saving || !form.description}
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
            No saved items yet. Click "+ New Item" to create one.
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs text-gray-500 uppercase border-b border-gray-100">
                <th className="px-4 py-3">Description</th>
                <th className="px-4 py-3 w-28">Rate</th>
                <th className="px-4 py-3 w-24">Tax %</th>
                <th className="px-4 py-3 w-24">Unit</th>
                <th className="px-4 py-3 w-28">Group</th>
                <th className="px-4 py-3 w-24" />
              </tr>
            </thead>
            <tbody>
              {items.map((item) => (
                <tr key={item.id} className="border-b border-gray-50 hover:bg-gray-50/50">
                  <td className="px-4 py-3">
                    <div className="font-medium text-gray-900">{item.description}</div>
                    {item.longDescription && (
                      <div className="text-xs text-gray-500 mt-0.5">{item.longDescription}</div>
                    )}
                  </td>
                  <td className="px-4 py-3 tabular-nums">{Number(item.rate).toFixed(2)}</td>
                  <td className="px-4 py-3">{Number(item.taxRate)}%</td>
                  <td className="px-4 py-3 text-gray-500">{item.unit || '-'}</td>
                  <td className="px-4 py-3 text-gray-500">{item.groupName || '-'}</td>
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
