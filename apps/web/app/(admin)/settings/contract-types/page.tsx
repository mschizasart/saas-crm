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

interface ContractType {
  id: string;
  name: string;
  _count?: { contracts: number };
}

export default function ContractTypesPage() {
  const [items, setItems] = useState<ContractType[]>([]);
  const [loading, setLoading] = useState(true);
  const [showNew, setShowNew] = useState(false);
  const [newName, setNewName] = useState('');
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  async function loadItems() {
    try {
      const res = await fetch(`${API_BASE}/api/v1/contracts/types`, { headers: headers() });
      if (res.ok) {
        const data = await res.json();
        setItems(Array.isArray(data) ? data : (data.data ?? []));
      }
    } catch { /* ignore */ }
    setLoading(false);
  }

  useEffect(() => { loadItems(); }, []);

  async function createItem() {
    if (!newName.trim()) return;
    setSaving(true);
    setMessage(null);
    try {
      const res = await fetch(`${API_BASE}/api/v1/contracts/types`, {
        method: 'POST',
        headers: headers(),
        body: JSON.stringify({ name: newName.trim() }),
      });
      if (!res.ok) throw new Error(`Failed (${res.status})`);
      setMessage('Created');
      setNewName('');
      setShowNew(false);
      await loadItems();
    } catch (err) {
      setMessage(err instanceof Error ? err.message : 'Failed');
    } finally {
      setSaving(false);
    }
  }

  async function deleteItem(id: string) {
    if (!confirm('Delete this contract type?')) return;
    try {
      await fetch(`${API_BASE}/api/v1/contracts/types/${id}`, { method: 'DELETE', headers: headers() });
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
          <h1 className="text-2xl font-bold text-gray-900">Contract Types</h1>
          <p className="text-sm text-gray-500 mt-1">Categorize contracts by type</p>
        </div>
        <button onClick={() => { setShowNew(true); setNewName(''); }} className="px-4 py-2 bg-primary text-white text-sm font-medium rounded-lg hover:bg-primary/90">
          + New Type
        </button>
      </div>

      {message && (
        <div className="mb-4 px-3 py-2 bg-blue-50 border border-blue-100 text-sm text-blue-700 rounded">{message}</div>
      )}

      {showNew && (
        <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-6 mb-6">
          <h2 className="text-sm font-semibold text-gray-700 mb-4">New Contract Type</h2>
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Name *</label>
            <input
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg"
              placeholder="e.g. Service Agreement"
              onKeyDown={(e) => e.key === 'Enter' && createItem()}
            />
          </div>
          <div className="flex gap-2 mt-4">
            <button
              onClick={createItem}
              disabled={saving || !newName.trim()}
              className="px-4 py-2 bg-primary text-white text-sm font-medium rounded-lg hover:bg-primary/90 disabled:opacity-50"
            >
              {saving ? 'Saving...' : 'Create'}
            </button>
            <button
              onClick={() => setShowNew(false)}
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
            No contract types yet. Click "+ New Type" to create one.
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs text-gray-500 uppercase border-b border-gray-100">
                <th className="px-4 py-3">Name</th>
                <th className="px-4 py-3 w-28">Contracts</th>
                <th className="px-4 py-3 w-24" />
              </tr>
            </thead>
            <tbody>
              {items.map((item) => (
                <tr key={item.id} className="border-b border-gray-50 hover:bg-gray-50/50">
                  <td className="px-4 py-3 font-medium text-gray-900">{item.name}</td>
                  <td className="px-4 py-3 text-gray-500">{item._count?.contracts ?? 0}</td>
                  <td className="px-4 py-3">
                    <button onClick={() => deleteItem(item.id)} className="text-xs text-red-500 hover:underline">Delete</button>
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
