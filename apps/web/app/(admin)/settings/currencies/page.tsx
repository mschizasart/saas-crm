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

interface Currency {
  id: string;
  name: string;
  symbol: string;
  symbolPlacement: string;
  decimalSeparator: string;
  thousandSeparator: string;
  decimalPlaces: number;
  isDefault: boolean;
  exchangeRate: number;
}

export default function CurrenciesPage() {
  const [items, setItems] = useState<Currency[]>([]);
  const [loading, setLoading] = useState(true);
  const [editId, setEditId] = useState<string | null>(null);
  const [showNew, setShowNew] = useState(false);
  const [form, setForm] = useState({
    name: '', symbol: '', symbolPlacement: 'before',
    decimalSeparator: '.', thousandSeparator: ',',
    decimalPlaces: '2', isDefault: false, exchangeRate: '1',
  });
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  async function loadItems() {
    try {
      const res = await fetch(`${API_BASE}/api/v1/organizations/currencies`, { headers: headers() });
      if (res.ok) {
        const data = await res.json();
        setItems(Array.isArray(data) ? data : (data.data ?? []));
      }
    } catch { /* ignore */ }
    setLoading(false);
  }

  useEffect(() => { loadItems(); }, []);

  function startEdit(item: Currency) {
    setEditId(item.id);
    setForm({
      name: item.name,
      symbol: item.symbol,
      symbolPlacement: item.symbolPlacement,
      decimalSeparator: item.decimalSeparator,
      thousandSeparator: item.thousandSeparator,
      decimalPlaces: String(item.decimalPlaces),
      isDefault: item.isDefault,
      exchangeRate: String(item.exchangeRate),
    });
    setShowNew(false);
  }

  function startNew() {
    setEditId(null);
    setForm({
      name: '', symbol: '', symbolPlacement: 'before',
      decimalSeparator: '.', thousandSeparator: ',',
      decimalPlaces: '2', isDefault: false, exchangeRate: '1',
    });
    setShowNew(true);
  }

  async function saveItem() {
    setSaving(true);
    setMessage(null);
    try {
      const payload = {
        name: form.name,
        symbol: form.symbol,
        symbolPlacement: form.symbolPlacement,
        decimalSeparator: form.decimalSeparator,
        thousandSeparator: form.thousandSeparator,
        decimalPlaces: Number(form.decimalPlaces) || 2,
        isDefault: form.isDefault,
        exchangeRate: Number(form.exchangeRate) || 1,
      };

      const url = editId
        ? `${API_BASE}/api/v1/organizations/currencies/${editId}`
        : `${API_BASE}/api/v1/organizations/currencies`;
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
    if (!confirm('Delete this currency?')) return;
    try {
      await fetch(`${API_BASE}/api/v1/organizations/currencies/${id}`, { method: 'DELETE', headers: headers() });
      await loadItems();
    } catch { /* ignore */ }
  }

  if (loading) return <div className="p-6 text-sm text-gray-500 dark:text-gray-400">Loading...</div>;

  return (
    <SettingsPageLayout title="Currencies" description="Configure currencies for invoices, estimates, and expenses">
      <div className="mb-[-0.5rem]">
        <Link href="/settings" className={`${typography.bodyMuted} hover:text-primary`}>&larr; Settings</Link>
      </div>

      {message && (
        <div className="px-3 py-2 bg-blue-50 border border-blue-100 text-sm text-blue-700 rounded">{message}</div>
      )}

      <SettingsSection
        title="Manage currencies"
        description="Add, edit, or remove the currencies available for billing"
      >
        <div className="flex items-center justify-end mb-4">
          <button onClick={startNew} className="px-4 py-2 bg-primary text-white text-sm font-medium rounded-lg hover:bg-primary/90">
            + New Currency
          </button>
        </div>

        {(showNew || editId) && (
          <div className="mb-6 p-4 border border-gray-100 dark:border-gray-800 rounded-lg bg-gray-50/40 dark:bg-gray-900/40">
            <h3 className={`${typography.label} mb-4`}>{editId ? 'Edit Currency' : 'New Currency'}</h3>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">Name *</label>
              <input
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                className="w-full px-3 py-2 text-sm border border-gray-200 dark:border-gray-700 rounded-lg"
                placeholder="e.g. US Dollar"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">Symbol *</label>
              <input
                value={form.symbol}
                onChange={(e) => setForm({ ...form, symbol: e.target.value })}
                className="w-full px-3 py-2 text-sm border border-gray-200 dark:border-gray-700 rounded-lg"
                placeholder="e.g. $"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">Symbol Placement</label>
              <select
                value={form.symbolPlacement}
                onChange={(e) => setForm({ ...form, symbolPlacement: e.target.value })}
                className="w-full px-3 py-2 text-sm border border-gray-200 dark:border-gray-700 rounded-lg bg-white dark:bg-gray-900"
              >
                <option value="before">Before amount</option>
                <option value="after">After amount</option>
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">Decimal Places</label>
              <input
                type="number"
                min="0"
                max="6"
                value={form.decimalPlaces}
                onChange={(e) => setForm({ ...form, decimalPlaces: e.target.value })}
                className="w-full px-3 py-2 text-sm border border-gray-200 dark:border-gray-700 rounded-lg"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">Decimal Separator</label>
              <input
                value={form.decimalSeparator}
                onChange={(e) => setForm({ ...form, decimalSeparator: e.target.value })}
                className="w-full px-3 py-2 text-sm border border-gray-200 dark:border-gray-700 rounded-lg"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">Thousand Separator</label>
              <input
                value={form.thousandSeparator}
                onChange={(e) => setForm({ ...form, thousandSeparator: e.target.value })}
                className="w-full px-3 py-2 text-sm border border-gray-200 dark:border-gray-700 rounded-lg"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">Exchange Rate</label>
              <input
                type="number"
                step="0.000001"
                value={form.exchangeRate}
                onChange={(e) => setForm({ ...form, exchangeRate: e.target.value })}
                className="w-full px-3 py-2 text-sm border border-gray-200 dark:border-gray-700 rounded-lg"
              />
            </div>
            <div className="flex items-center">
              <label className="inline-flex items-center gap-2 text-sm text-gray-700 dark:text-gray-300 mt-5">
                <input
                  type="checkbox"
                  checked={form.isDefault}
                  onChange={(e) => setForm({ ...form, isDefault: e.target.checked })}
                  className="w-4 h-4 rounded border-gray-300 text-primary focus:ring-primary/30"
                />
                Default currency
              </label>
            </div>
          </div>
          <div className="flex gap-2 mt-4">
            <button
              onClick={saveItem}
              disabled={saving || !form.name || !form.symbol}
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
            No currencies yet. Click "+ New Currency" to create one.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs text-gray-500 dark:text-gray-400 uppercase border-b border-gray-100 dark:border-gray-800">
                  <th className="px-4 py-3">Name</th>
                  <th className="px-4 py-3 w-20">Symbol</th>
                  <th className="px-4 py-3 w-28">Exchange Rate</th>
                  <th className="px-4 py-3 w-24">Default</th>
                  <th className="px-4 py-3 w-24" />
                </tr>
              </thead>
              <tbody>
                {items.map((item) => (
                  <tr key={item.id} className="border-b border-gray-50 hover:bg-gray-50/50">
                    <td className="px-4 py-3 font-medium text-gray-900 dark:text-gray-100">{item.name}</td>
                    <td className="px-4 py-3 text-gray-500 dark:text-gray-400">{item.symbol}</td>
                    <td className="px-4 py-3 tabular-nums">{Number(item.exchangeRate)}</td>
                    <td className="px-4 py-3">
                      {item.isDefault && (
                        <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-blue-100 text-blue-700">
                          Default
                        </span>
                      )}
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
          </div>
        )}
      </SettingsSection>
    </SettingsPageLayout>
  );
}
