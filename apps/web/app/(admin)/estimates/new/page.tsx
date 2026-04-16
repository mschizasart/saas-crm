'use client';

import { useState, useEffect, FormEvent, useMemo, useRef, useCallback } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';

interface ClientOption { id: string; company?: string; company_name?: string; name?: string; }
interface LineItem { description: string; quantity: string; unitPrice: string; taxRate: string; }
interface SavedItem { id: string; description: string; rate: number; taxRate: number; unit?: string; longDescription?: string; }

const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001';
const EMPTY_ITEM: LineItem = { description: '', quantity: '1', unitPrice: '0', taxRate: '0' };
const today = () => new Date().toISOString().slice(0, 10);

function getToken(): string | null {
  if (typeof window === 'undefined') return null;
  return localStorage.getItem('access_token');
}

export default function NewEstimatePage() {
  const router = useRouter();
  const [clientId, setClientId] = useState('');
  const [date, setDate] = useState(today());
  const [expiryDate, setExpiryDate] = useState(today());
  const [currency, setCurrency] = useState('USD');
  const [notes, setNotes] = useState('');
  const [terms, setTerms] = useState('');
  const [discount, setDiscount] = useState('0');
  const [items, setItems] = useState<LineItem[]>([{ ...EMPTY_ITEM }]);
  const [clients, setClients] = useState<ClientOption[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saveItemMsg, setSaveItemMsg] = useState<string | null>(null);
  const [dragIdx, setDragIdx] = useState<number | null>(null);

  // Saved items autocomplete state
  const [activeAutocomplete, setActiveAutocomplete] = useState<number | null>(null);
  const [suggestions, setSuggestions] = useState<SavedItem[]>([]);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch(`${API_BASE}/api/v1/clients?limit=100`, { headers: { Authorization: `Bearer ${getToken()}` } });
        if (res.ok) {
          const json = await res.json();
          setClients(json.data ?? []);
        }
      } catch { /* ignore */ }
    })();
  }, []);

  const totals = useMemo(() => {
    let subtotal = 0, taxTotal = 0;
    for (const it of items) {
      const line = (parseFloat(it.quantity) || 0) * (parseFloat(it.unitPrice) || 0);
      subtotal += line;
      taxTotal += (line * (parseFloat(it.taxRate) || 0)) / 100;
    }
    const d = parseFloat(discount) || 0;
    return { subtotal, taxTotal, discount: d, total: Math.max(0, subtotal + taxTotal - d) };
  }, [items, discount]);

  function updateItem(idx: number, key: keyof LineItem, value: string) {
    setItems((prev) => prev.map((it, i) => i === idx ? { ...it, [key]: value } : it));
  }

  const searchSavedItems = useCallback(async (query: string) => {
    if (query.length < 2) {
      setSuggestions([]);
      return;
    }
    try {
      const res = await fetch(`${API_BASE}/api/v1/saved-items?search=${encodeURIComponent(query)}`, {
        headers: { Authorization: `Bearer ${getToken()}` },
      });
      if (res.ok) {
        const data = await res.json();
        setSuggestions(Array.isArray(data) ? data : (data.data ?? []));
      }
    } catch { setSuggestions([]); }
  }, []);

  function handleDescriptionChange(idx: number, value: string) {
    updateItem(idx, 'description', value);
    setActiveAutocomplete(idx);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => searchSavedItems(value), 300);
  }

  function applySavedItem(idx: number, saved: SavedItem) {
    setItems((prev) => prev.map((it, i) =>
      i === idx ? {
        ...it,
        description: saved.description,
        unitPrice: String(saved.rate),
        taxRate: String(saved.taxRate ?? 0),
      } : it
    ));
    setSuggestions([]);
    setActiveAutocomplete(null);
  }

  async function saveAsItem(idx: number) {
    const item = items[idx];
    if (!item.description) return;
    try {
      const res = await fetch(`${API_BASE}/api/v1/saved-items`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${getToken()}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          description: item.description,
          rate: Number(item.unitPrice) || 0,
          taxRate: Number(item.taxRate) || 0,
        }),
      });
      if (res.ok) {
        setSaveItemMsg('Item saved for future use');
        setTimeout(() => setSaveItemMsg(null), 3000);
      }
    } catch { /* ignore */ }
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      const payload = {
        clientId, date, expiryDate, currency, notes, terms,
        discount: Number(discount) || 0,
        items: items.map((it) => ({
          description: it.description,
          quantity: Number(it.quantity) || 0,
          unitPrice: Number(it.unitPrice) || 0,
          taxRate: Number(it.taxRate) || 0,
        })),
      };
      const res = await fetch(`${API_BASE}/api/v1/estimates`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${getToken()}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (!res.ok) throw new Error(`Failed (${res.status})`);
      const created = await res.json();
      router.push(`/estimates/${created.id ?? created.data?.id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="max-w-5xl">
      <div className="mb-4"><Link href="/estimates" className="text-sm text-gray-500 hover:text-primary">← Back</Link></div>
      <h1 className="text-2xl font-bold text-gray-900 mb-6">New Estimate</h1>

      <form onSubmit={handleSubmit} className="space-y-6">
        {error && <div className="px-3 py-2 bg-red-50 border border-red-100 text-sm text-red-600 rounded">{error}</div>}
        {saveItemMsg && <div className="px-3 py-2 bg-green-50 border border-green-100 text-sm text-green-700 rounded">{saveItemMsg}</div>}

        <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-6">
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            <Field label="Client" required className="sm:col-span-2">
              <select required value={clientId} onChange={(e) => setClientId(e.target.value)} className={inputClass}>
                <option value="">-- Select --</option>
                {clients.map((c) => (
                  <option key={c.id} value={c.id}>{c.company ?? c.company_name ?? c.name ?? c.id}</option>
                ))}
              </select>
            </Field>
            <Field label="Currency"><input value={currency} onChange={(e) => setCurrency(e.target.value)} className={inputClass} /></Field>
            <Field label="Discount"><input type="number" step="0.01" value={discount} onChange={(e) => setDiscount(e.target.value)} className={inputClass} /></Field>
            <Field label="Date" required><input required type="date" value={date} onChange={(e) => setDate(e.target.value)} className={inputClass} /></Field>
            <Field label="Expiry Date"><input type="date" value={expiryDate} onChange={(e) => setExpiryDate(e.target.value)} className={inputClass} /></Field>
          </div>
        </div>

        <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-6">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-sm font-semibold text-gray-700">Line Items</h2>
            <button type="button" onClick={() => setItems([...items, { ...EMPTY_ITEM }])} className="text-sm text-primary hover:underline">+ Add item</button>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs text-gray-500 uppercase">
                  <th className="pb-2 pr-2 w-8" />
                  <th className="pb-2 pr-2">Description</th>
                  <th className="pb-2 pr-2 w-24">Qty</th>
                  <th className="pb-2 pr-2 w-32">Unit Price</th>
                  <th className="pb-2 pr-2 w-24">Tax %</th>
                  <th className="pb-2 pr-2 w-28 text-right">Amount</th>
                  <th className="pb-2 w-20" />
                </tr>
              </thead>
              <tbody>
                {items.map((item, idx) => {
                  const amount = (parseFloat(item.quantity) || 0) * (parseFloat(item.unitPrice) || 0);
                  return (
                    <tr
                      key={idx}
                      className={`border-t border-gray-100 ${dragIdx === idx ? 'opacity-50' : ''}`}
                      draggable
                      onDragStart={() => setDragIdx(idx)}
                      onDragOver={(e) => { e.preventDefault(); e.currentTarget.classList.add('border-t-2', 'border-primary'); }}
                      onDragLeave={(e) => { e.currentTarget.classList.remove('border-t-2', 'border-primary'); }}
                      onDrop={(e) => {
                        e.currentTarget.classList.remove('border-t-2', 'border-primary');
                        if (dragIdx === null || dragIdx === idx) return;
                        const reordered = [...items];
                        const [moved] = reordered.splice(dragIdx, 1);
                        reordered.splice(idx, 0, moved);
                        setItems(reordered);
                        setDragIdx(null);
                      }}
                      onDragEnd={() => setDragIdx(null)}
                    >
                      <td className="py-2 pr-1 cursor-grab text-gray-400 select-none" title="Drag to reorder">
                        <span className="text-sm leading-none">&#8942;&#8942;</span>
                      </td>
                      <td className="py-2 pr-2 relative">
                        <input
                          value={item.description}
                          onChange={(e) => handleDescriptionChange(idx, e.target.value)}
                          onBlur={() => setTimeout(() => { if (activeAutocomplete === idx) setActiveAutocomplete(null); }, 200)}
                          onFocus={() => { if (item.description.length >= 2) { setActiveAutocomplete(idx); searchSavedItems(item.description); } }}
                          className={inputClass}
                          placeholder="Type to search saved items..."
                        />
                        {activeAutocomplete === idx && suggestions.length > 0 && (
                          <div className="absolute z-20 left-0 right-2 top-full bg-white border border-gray-200 rounded-lg shadow-lg max-h-48 overflow-y-auto">
                            {suggestions.map((s) => (
                              <button
                                key={s.id}
                                type="button"
                                className="w-full text-left px-3 py-2 text-sm hover:bg-primary/5 border-b border-gray-50 last:border-0"
                                onMouseDown={(e) => { e.preventDefault(); applySavedItem(idx, s); }}
                              >
                                <span className="font-medium text-gray-900">{s.description}</span>
                                <span className="ml-2 text-gray-500">{Number(s.rate).toFixed(2)} | Tax: {Number(s.taxRate)}%</span>
                              </button>
                            ))}
                          </div>
                        )}
                      </td>
                      <td className="py-2 pr-2"><input type="number" step="0.01" value={item.quantity} onChange={(e) => updateItem(idx, 'quantity', e.target.value)} className={inputClass} /></td>
                      <td className="py-2 pr-2"><input type="number" step="0.01" value={item.unitPrice} onChange={(e) => updateItem(idx, 'unitPrice', e.target.value)} className={inputClass} /></td>
                      <td className="py-2 pr-2"><input type="number" step="0.01" value={item.taxRate} onChange={(e) => updateItem(idx, 'taxRate', e.target.value)} className={inputClass} /></td>
                      <td className="py-2 pr-2 text-right tabular-nums">{amount.toFixed(2)}</td>
                      <td className="py-2 flex items-center gap-1">
                        <button
                          type="button"
                          onClick={() => saveAsItem(idx)}
                          className="text-gray-400 hover:text-primary p-1"
                          title="Save as reusable item"
                        >
                          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="w-4 h-4">
                            <path d="M15.988 3.012A2.25 2.25 0 0018 5.25v6.5A2.25 2.25 0 0015.75 14H13.5v-3.379a.75.75 0 00-.22-.53l-2.121-2.122a.75.75 0 00-.53-.22H7.5V5.25A2.25 2.25 0 009.75 3h4.238a2.25 2.25 0 011.5.638l.5.374zM4 7.75A2.25 2.25 0 016.25 5.5h.5v2.25c0 .138.112.25.25.25h3.862l2.138 2.138V14.25A2.25 2.25 0 0110.75 16.5h-4.5A2.25 2.25 0 014 14.25v-6.5z" />
                          </svg>
                        </button>
                        <button type="button" onClick={() => setItems((prev) => prev.length > 1 ? prev.filter((_, i) => i !== idx) : prev)} className="text-gray-400 hover:text-red-500 p-1">x</button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <div className="flex justify-end mt-6">
            <div className="w-64 space-y-1 text-sm">
              <Row label="Subtotal" value={totals.subtotal.toFixed(2)} />
              <Row label="Tax" value={totals.taxTotal.toFixed(2)} />
              <Row label="Discount" value={`-${totals.discount.toFixed(2)}`} />
              <div className="border-t border-gray-200 mt-2 pt-2">
                <Row label="Total" value={`${totals.total.toFixed(2)} ${currency}`} bold />
              </div>
            </div>
          </div>
        </div>

        <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-6 grid grid-cols-1 sm:grid-cols-2 gap-4">
          <Field label="Notes"><textarea rows={4} value={notes} onChange={(e) => setNotes(e.target.value)} className={inputClass} /></Field>
          <Field label="Terms"><textarea rows={4} value={terms} onChange={(e) => setTerms(e.target.value)} className={inputClass} /></Field>
        </div>

        <div className="flex justify-end gap-2">
          <Link href="/estimates" className="px-4 py-2 text-sm font-medium text-gray-600 hover:text-gray-900">Cancel</Link>
          <button type="submit" disabled={saving} className="px-4 py-2 bg-primary text-white text-sm font-medium rounded-lg hover:bg-primary/90 disabled:opacity-50">
            {saving ? 'Saving...' : 'Create Estimate'}
          </button>
        </div>
      </form>
    </div>
  );
}

const inputClass = 'w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary bg-white';

function Field({ label, required, children, className }: { label: string; required?: boolean; children: React.ReactNode; className?: string }) {
  return (
    <div className={className}>
      <label className="block text-xs font-medium text-gray-600 mb-1">
        {label}{required && <span className="text-red-500 ml-0.5">*</span>}
      </label>
      {children}
    </div>
  );
}

function Row({ label, value, bold }: { label: string; value: string; bold?: boolean }) {
  return (
    <div className={`flex justify-between ${bold ? 'font-semibold text-gray-900' : 'text-gray-600'}`}>
      <span>{label}</span><span className="tabular-nums">{value}</span>
    </div>
  );
}
