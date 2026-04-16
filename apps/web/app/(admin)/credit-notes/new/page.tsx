'use client';

import { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';

interface Client {
  id: string;
  company?: string;
  company_name?: string;
}

interface Invoice {
  id: string;
  number: string;
}

interface LineItem {
  description: string;
  quantity: number;
  unitPrice: number;
  taxRate: number;
}

interface SavedItem {
  id: string;
  description: string;
  rate: number;
  taxRate: number;
  unit?: string;
  longDescription?: string;
}

const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001';

function authHeaders(): HeadersInit {
  const token = typeof window === 'undefined' ? null : localStorage.getItem('access_token');
  return { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
}

function blankLine(): LineItem {
  return { description: '', quantity: 1, unitPrice: 0, taxRate: 0 };
}

const CURRENCIES = ['USD', 'EUR', 'GBP', 'CAD', 'AUD', 'JPY'];

export default function NewCreditNotePage() {
  const router = useRouter();
  const [clients, setClients] = useState<Client[]>([]);
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [clientId, setClientId] = useState('');
  const [invoiceId, setInvoiceId] = useState('');
  const [date, setDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [currency, setCurrency] = useState('USD');
  const [notes, setNotes] = useState('');
  const [items, setItems] = useState<LineItem[]>([blankLine()]);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saveItemMsg, setSaveItemMsg] = useState<string | null>(null);
  const [dragIdx, setDragIdx] = useState<number | null>(null);

  // Saved items autocomplete state
  const [activeAutocomplete, setActiveAutocomplete] = useState<number | null>(null);
  const [suggestions, setSuggestions] = useState<SavedItem[]>([]);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    fetch(`${API_BASE}/api/v1/clients?limit=100`, { headers: authHeaders() })
      .then((r) => r.json())
      .then((d) => setClients(d?.data ?? []))
      .catch(() => setClients([]));
  }, []);

  useEffect(() => {
    if (!clientId) {
      setInvoices([]);
      setInvoiceId('');
      return;
    }
    fetch(`${API_BASE}/api/v1/invoices?clientId=${clientId}&limit=100`, { headers: authHeaders() })
      .then((r) => r.json())
      .then((d) => setInvoices(d?.data ?? []))
      .catch(() => setInvoices([]));
  }, [clientId]);

  function updateItem(idx: number, patch: Partial<LineItem>) {
    setItems((prev) => prev.map((it, i) => (i === idx ? { ...it, ...patch } : it)));
  }

  function addItem() {
    setItems((p) => [...p, blankLine()]);
  }

  function removeItem(idx: number) {
    setItems((p) => p.filter((_, i) => i !== idx));
  }

  const totals = useMemo(() => {
    let subtotal = 0;
    let tax = 0;
    items.forEach((it) => {
      const line = Number(it.quantity) * Number(it.unitPrice);
      subtotal += line;
      tax += (line * Number(it.taxRate)) / 100;
    });
    return { subtotal, tax, total: subtotal + tax };
  }, [items]);

  const searchSavedItems = useCallback(async (query: string) => {
    if (query.length < 2) {
      setSuggestions([]);
      return;
    }
    try {
      const [savedRes, productRes] = await Promise.all([
        fetch(`${API_BASE}/api/v1/saved-items?search=${encodeURIComponent(query)}`, {
          headers: authHeaders(),
        }),
        fetch(`${API_BASE}/api/v1/products/search?q=${encodeURIComponent(query)}`, {
          headers: authHeaders(),
        }),
      ]);
      let allItems: SavedItem[] = [];
      if (savedRes.ok) {
        const data = await savedRes.json();
        allItems = Array.isArray(data) ? data : (data.data ?? []);
      }
      if (productRes.ok) {
        const products = await productRes.json();
        const productItems = (Array.isArray(products) ? products : []).map((p: any) => ({
          id: `product_${p.id}`,
          description: p.name,
          rate: Number(p.unitPrice),
          taxRate: Number(p.taxRate ?? 0),
          unit: p.unit,
          longDescription: p.description,
        }));
        allItems = [...allItems, ...productItems];
      }
      setSuggestions(allItems);
    } catch { setSuggestions([]); }
  }, []);

  function handleDescriptionChange(idx: number, value: string) {
    updateItem(idx, { description: value });
    setActiveAutocomplete(idx);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => searchSavedItems(value), 300);
  }

  function applySavedItem(idx: number, saved: SavedItem) {
    updateItem(idx, {
      description: saved.description,
      unitPrice: saved.rate,
      taxRate: saved.taxRate ?? 0,
    });
    setSuggestions([]);
    setActiveAutocomplete(null);
  }

  async function saveAsItem(idx: number) {
    const item = items[idx];
    if (!item.description) return;
    try {
      const res = await fetch(`${API_BASE}/api/v1/saved-items`, {
        method: 'POST',
        headers: authHeaders(),
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

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      const body: Record<string, unknown> = {
        clientId,
        date,
        currency,
        notes,
        items: items.map((it) => ({
          description: it.description,
          quantity: Number(it.quantity),
          unitPrice: Number(it.unitPrice),
          taxRate: Number(it.taxRate),
        })),
      };
      if (invoiceId) body.invoiceId = invoiceId;

      const res = await fetch(`${API_BASE}/api/v1/credit-notes`, {
        method: 'POST',
        headers: authHeaders(),
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        throw new Error(j.message || `Failed with status ${res.status}`);
      }
      const created = await res.json();
      router.push(`/credit-notes/${created.id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="max-w-4xl mx-auto">
      <div className="flex items-center gap-2 mb-6 text-sm text-gray-500">
        <Link href="/credit-notes" className="hover:text-primary">Credit Notes</Link>
        <span>/</span>
        <span className="text-gray-900 font-medium">New</span>
      </div>
      <h1 className="text-2xl font-bold text-gray-900 mb-6">New Credit Note</h1>

      <form onSubmit={submit} className="space-y-6">
        {error && (
          <div className="px-3 py-2 bg-red-50 border border-red-100 text-red-600 text-sm rounded-lg">{error}</div>
        )}
        {saveItemMsg && (
          <div className="px-3 py-2 bg-green-50 border border-green-100 text-green-700 text-sm rounded-lg">{saveItemMsg}</div>
        )}

        <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-6">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-medium text-gray-500 mb-1">Client *</label>
              <select
                required
                value={clientId}
                onChange={(e) => setClientId(e.target.value)}
                className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg bg-white"
              >
                <option value="">-- Select client --</option>
                {clients.map((c) => (
                  <option key={c.id} value={c.id}>{c.company ?? c.company_name}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-500 mb-1">Invoice (optional)</label>
              <select
                value={invoiceId}
                onChange={(e) => setInvoiceId(e.target.value)}
                disabled={!clientId}
                className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg bg-white disabled:bg-gray-50"
              >
                <option value="">-- None --</option>
                {invoices.map((i) => (
                  <option key={i.id} value={i.id}>{i.number}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-500 mb-1">Date</label>
              <input
                type="date"
                value={date}
                onChange={(e) => setDate(e.target.value)}
                className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-500 mb-1">Currency</label>
              <select
                value={currency}
                onChange={(e) => setCurrency(e.target.value)}
                className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg bg-white"
              >
                {CURRENCIES.map((c) => (
                  <option key={c} value={c}>{c}</option>
                ))}
              </select>
            </div>
          </div>
        </div>

        <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-6">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-sm font-semibold text-gray-700">Line Items</h2>
            <button
              type="button"
              onClick={addItem}
              className="text-xs font-medium text-primary hover:underline"
            >
              + Add Item
            </button>
          </div>
          <div className="space-y-3">
            {items.map((it, idx) => (
              <div
                key={idx}
                className={`grid grid-cols-12 gap-2 items-end ${dragIdx === idx ? 'opacity-50' : ''}`}
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
                <div className="col-span-5 relative flex items-end gap-1">
                  <span className="cursor-grab text-gray-400 select-none pb-2" title="Drag to reorder">&#8942;&#8942;</span>
                  <div className="flex-1 relative">
                  <label className="block text-xs font-medium text-gray-500 mb-1">Description</label>
                  <input
                    type="text"
                    value={it.description}
                    onChange={(e) => handleDescriptionChange(idx, e.target.value)}
                    onBlur={() => setTimeout(() => { if (activeAutocomplete === idx) setActiveAutocomplete(null); }, 200)}
                    onFocus={() => { if (it.description.length >= 2) { setActiveAutocomplete(idx); searchSavedItems(it.description); } }}
                    className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg"
                    placeholder="Type to search saved items..."
                  />
                  {activeAutocomplete === idx && suggestions.length > 0 && (
                    <div className="absolute z-20 left-0 right-0 top-full bg-white border border-gray-200 rounded-lg shadow-lg max-h-48 overflow-y-auto">
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
                  </div>
                </div>
                <div className="col-span-2">
                  <label className="block text-xs font-medium text-gray-500 mb-1">Qty</label>
                  <input
                    type="number"
                    step="0.01"
                    value={it.quantity}
                    onChange={(e) => updateItem(idx, { quantity: Number(e.target.value) })}
                    className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg"
                  />
                </div>
                <div className="col-span-2">
                  <label className="block text-xs font-medium text-gray-500 mb-1">Unit Price</label>
                  <input
                    type="number"
                    step="0.01"
                    value={it.unitPrice}
                    onChange={(e) => updateItem(idx, { unitPrice: Number(e.target.value) })}
                    className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg"
                  />
                </div>
                <div className="col-span-2">
                  <label className="block text-xs font-medium text-gray-500 mb-1">Tax %</label>
                  <input
                    type="number"
                    step="0.01"
                    value={it.taxRate}
                    onChange={(e) => updateItem(idx, { taxRate: Number(e.target.value) })}
                    className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg"
                  />
                </div>
                <div className="col-span-1 flex items-center gap-0.5">
                  <button
                    type="button"
                    onClick={() => saveAsItem(idx)}
                    className="p-1 text-gray-400 hover:text-primary"
                    title="Save as reusable item"
                  >
                    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="w-4 h-4">
                      <path d="M15.988 3.012A2.25 2.25 0 0018 5.25v6.5A2.25 2.25 0 0015.75 14H13.5v-3.379a.75.75 0 00-.22-.53l-2.121-2.122a.75.75 0 00-.53-.22H7.5V5.25A2.25 2.25 0 009.75 3h4.238a2.25 2.25 0 011.5.638l.5.374zM4 7.75A2.25 2.25 0 016.25 5.5h.5v2.25c0 .138.112.25.25.25h3.862l2.138 2.138V14.25A2.25 2.25 0 0110.75 16.5h-4.5A2.25 2.25 0 014 14.25v-6.5z" />
                    </svg>
                  </button>
                  <button
                    type="button"
                    onClick={() => removeItem(idx)}
                    disabled={items.length === 1}
                    className="p-1 text-xs text-red-500 hover:bg-red-50 rounded disabled:opacity-30"
                  >
                    x
                  </button>
                </div>
              </div>
            ))}
          </div>

          <div className="mt-6 border-t border-gray-100 pt-4 text-sm space-y-1 max-w-xs ml-auto">
            <div className="flex justify-between">
              <span className="text-gray-500">Subtotal</span>
              <span className="font-medium">{totals.subtotal.toFixed(2)}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-gray-500">Tax</span>
              <span className="font-medium">{totals.tax.toFixed(2)}</span>
            </div>
            <div className="flex justify-between text-base font-semibold border-t border-gray-100 pt-2 mt-2">
              <span>Total</span>
              <span>{totals.total.toFixed(2)} {currency}</span>
            </div>
          </div>
        </div>

        <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-6">
          <label className="block text-xs font-medium text-gray-500 mb-1">Notes</label>
          <textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            rows={3}
            className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg"
          />
        </div>

        <div className="flex gap-3">
          <button
            type="submit"
            disabled={submitting || !clientId}
            className="px-4 py-2 text-sm font-medium bg-primary text-white rounded-lg hover:bg-primary/90 disabled:opacity-50"
          >
            {submitting ? 'Creating...' : 'Create Credit Note'}
          </button>
          <Link href="/credit-notes" className="px-4 py-2 text-sm font-medium border border-gray-200 rounded-lg hover:bg-gray-50">
            Cancel
          </Link>
        </div>
      </form>
    </div>
  );
}
