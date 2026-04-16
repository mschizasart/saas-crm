'use client';

import { useState, useEffect, FormEvent, useMemo, useRef, useCallback } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { CustomFieldsForm } from '../../../../components/custom-fields-form';

interface ConvertedTotal {
  amount: number;
  currency: string;
  rate: number;
}

interface ClientOption {
  id: string;
  company?: string;
  company_name?: string;
  name?: string;
}

interface LineItem {
  description: string;
  quantity: string;
  unitPrice: string;
  taxRate: string;
}

interface SavedItem {
  id: string;
  description: string;
  rate: number;
  taxRate: number;
  unit?: string;
  longDescription?: string;
}

interface InvoiceForm {
  clientId: string;
  date: string;
  dueDate: string;
  currency: string;
  notes: string;
  terms: string;
  discount: string;
  items: LineItem[];
}

const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001';

const EMPTY_ITEM: LineItem = { description: '', quantity: '1', unitPrice: '0', taxRate: '0' };

const today = () => new Date().toISOString().slice(0, 10);

const EMPTY: InvoiceForm = {
  clientId: '',
  date: today(),
  dueDate: today(),
  currency: 'USD',
  notes: '',
  terms: '',
  discount: '0',
  items: [{ ...EMPTY_ITEM }],
};

function getToken(): string | null {
  if (typeof window === 'undefined') return null;
  return localStorage.getItem('access_token');
}

export default function NewInvoicePage() {
  const router = useRouter();
  const [form, setForm] = useState<InvoiceForm>(EMPTY);
  const [clients, setClients] = useState<ClientOption[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saveItemMsg, setSaveItemMsg] = useState<string | null>(null);
  const [dragIdx, setDragIdx] = useState<number | null>(null);
  const [customFieldValues, setCustomFieldValues] = useState<Record<string, string>>({});

  // Currency conversion state
  const [baseCurrency, setBaseCurrency] = useState<string | null>(null);
  const [convertedTotal, setConvertedTotal] = useState<ConvertedTotal | null>(null);

  // Saved items autocomplete state
  const [activeAutocomplete, setActiveAutocomplete] = useState<number | null>(null);
  const [suggestions, setSuggestions] = useState<SavedItem[]>([]);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch(`${API_BASE}/api/v1/clients?limit=100`, {
          headers: { Authorization: `Bearer ${getToken()}` },
        });
        if (res.ok) {
          const json = await res.json();
          setClients(json.data ?? []);
        }
      } catch {
        // ignore
      }
    })();
  }, []);

  const totals = useMemo(() => {
    let subtotal = 0;
    let taxTotal = 0;
    for (const item of form.items) {
      const qty = parseFloat(item.quantity) || 0;
      const price = parseFloat(item.unitPrice) || 0;
      const rate = parseFloat(item.taxRate) || 0;
      const line = qty * price;
      subtotal += line;
      taxTotal += (line * rate) / 100;
    }
    const discount = parseFloat(form.discount) || 0;
    const total = Math.max(0, subtotal + taxTotal - discount);
    return { subtotal, taxTotal, discount, total };
  }, [form.items, form.discount]);

  // Fetch base currency on mount
  useEffect(() => {
    (async () => {
      try {
        const res = await fetch(`${API_BASE}/api/v1/currencies/base`, {
          headers: { Authorization: `Bearer ${getToken()}` },
        });
        if (res.ok) {
          const json = await res.json();
          setBaseCurrency(json.code ?? null);
        }
      } catch { /* ignore */ }
    })();
  }, []);

  // Convert total when currency or total changes
  useEffect(() => {
    if (!baseCurrency || !form.currency || form.currency === baseCurrency) {
      setConvertedTotal(null);
      return;
    }
    const timer = setTimeout(async () => {
      try {
        const res = await fetch(
          `${API_BASE}/api/v1/currencies/convert?amount=${totals.total}&from=${form.currency}&to=${baseCurrency}`,
          { headers: { Authorization: `Bearer ${getToken()}` } },
        );
        if (res.ok) {
          const json = await res.json();
          if (json.converted !== json.amount) {
            setConvertedTotal({
              amount: json.converted,
              currency: baseCurrency,
              rate: json.rate,
            });
          } else {
            setConvertedTotal(null);
          }
        }
      } catch { setConvertedTotal(null); }
    }, 500);
    return () => clearTimeout(timer);
  }, [form.currency, baseCurrency, totals.total]);

  function updateItem(idx: number, key: keyof LineItem, value: string) {
    setForm((prev) => ({
      ...prev,
      items: prev.items.map((it, i) => (i === idx ? { ...it, [key]: value } : it)),
    }));
  }

  function addItem() {
    setForm((prev) => ({ ...prev, items: [...prev.items, { ...EMPTY_ITEM }] }));
  }

  function removeItem(idx: number) {
    setForm((prev) => ({
      ...prev,
      items: prev.items.length > 1 ? prev.items.filter((_, i) => i !== idx) : prev.items,
    }));
  }

  const searchSavedItems = useCallback(async (query: string) => {
    if (query.length < 2) {
      setSuggestions([]);
      return;
    }
    try {
      const [savedRes, productRes] = await Promise.all([
        fetch(`${API_BASE}/api/v1/saved-items?search=${encodeURIComponent(query)}`, {
          headers: { Authorization: `Bearer ${getToken()}` },
        }),
        fetch(`${API_BASE}/api/v1/products/search?q=${encodeURIComponent(query)}`, {
          headers: { Authorization: `Bearer ${getToken()}` },
        }),
      ]);
      let items: SavedItem[] = [];
      if (savedRes.ok) {
        const data = await savedRes.json();
        items = Array.isArray(data) ? data : (data.data ?? []);
      }
      // Merge products as SavedItem-like objects
      if (productRes.ok) {
        const products = await productRes.json();
        const productItems = (Array.isArray(products) ? products : []).map((p: any) => ({
          id: `product_${p.id}`,
          description: p.name,
          rate: Number(p.unitPrice),
          taxRate: Number(p.taxRate ?? 0),
          unit: p.unit,
          longDescription: p.description,
          _productId: p.id,
          _trackInventory: p.trackInventory,
        }));
        items = [...items, ...productItems];
      }
      setSuggestions(items);
    } catch { setSuggestions([]); }
  }, []);

  function handleDescriptionChange(idx: number, value: string) {
    updateItem(idx, 'description', value);
    setActiveAutocomplete(idx);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => searchSavedItems(value), 300);
  }

  function applySavedItem(idx: number, saved: any) {
    setForm((prev) => ({
      ...prev,
      items: prev.items.map((it, i) =>
        i === idx ? {
          ...it,
          description: saved.description,
          unitPrice: String(saved.rate),
          taxRate: String(saved.taxRate ?? 0),
        } : it
      ),
    }));
    // If it's a product with inventory tracking, decrement stock by 1
    if (saved._productId && saved._trackInventory) {
      fetch(`${API_BASE}/api/v1/products/${saved._productId}/stock`, {
        method: 'PATCH',
        headers: { Authorization: `Bearer ${getToken()}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ quantity: -1, reason: 'Added to invoice' }),
      }).catch(() => { /* ignore stock errors */ });
    }
    setSuggestions([]);
    setActiveAutocomplete(null);
  }

  async function saveAsItem(idx: number) {
    const item = form.items[idx];
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
        clientId: form.clientId,
        date: form.date,
        dueDate: form.dueDate,
        currency: form.currency,
        notes: form.notes,
        terms: form.terms,
        discount: Number(form.discount) || 0,
        items: form.items.map((it) => ({
          description: it.description,
          quantity: Number(it.quantity) || 0,
          unitPrice: Number(it.unitPrice) || 0,
          taxRate: Number(it.taxRate) || 0,
        })),
      };
      const res = await fetch(`${API_BASE}/api/v1/invoices`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${getToken()}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (!res.ok) throw new Error(`Failed (${res.status})`);
      const created = await res.json();
      const createdId = created.id ?? created.data?.id;
      if (Object.keys(customFieldValues).length > 0 && createdId) {
        await fetch(`${API_BASE}/api/v1/custom-fields/values/invoice/${createdId}`, {
          method: 'PUT',
          headers: { Authorization: `Bearer ${getToken()}`, 'Content-Type': 'application/json' },
          body: JSON.stringify(customFieldValues),
        });
      }
      router.push(`/invoices/${createdId}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create invoice');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="max-w-5xl">
      <div className="mb-4">
        <Link href="/invoices" className="text-sm text-gray-500 hover:text-primary">← Back to invoices</Link>
      </div>
      <h1 className="text-2xl font-bold text-gray-900 mb-6">New Invoice</h1>

      <form onSubmit={handleSubmit} className="space-y-6">
        {error && <div className="px-3 py-2 bg-red-50 border border-red-100 text-sm text-red-600 rounded">{error}</div>}
        {saveItemMsg && <div className="px-3 py-2 bg-green-50 border border-green-100 text-sm text-green-700 rounded">{saveItemMsg}</div>}

        <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-6">
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            <Field label="Client" required className="sm:col-span-2">
              <select required value={form.clientId} onChange={(e) => setForm({ ...form, clientId: e.target.value })} className={inputClass}>
                <option value="">-- Select --</option>
                {clients.map((c) => (
                  <option key={c.id} value={c.id}>{c.company ?? c.company_name ?? c.name ?? c.id}</option>
                ))}
              </select>
            </Field>
            <Field label="Currency">
              <input value={form.currency} onChange={(e) => setForm({ ...form, currency: e.target.value })} className={inputClass} />
            </Field>
            <Field label="Discount">
              <input type="number" step="0.01" value={form.discount} onChange={(e) => setForm({ ...form, discount: e.target.value })} className={inputClass} />
            </Field>
            <Field label="Date" required>
              <input required type="date" value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })} className={inputClass} />
            </Field>
            <Field label="Due Date" required>
              <input required type="date" value={form.dueDate} onChange={(e) => setForm({ ...form, dueDate: e.target.value })} className={inputClass} />
            </Field>
          </div>
        </div>

        {/* Line items */}
        <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-6">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-sm font-semibold text-gray-700">Line Items</h2>
            <button type="button" onClick={addItem} className="text-sm text-primary hover:underline">+ Add item</button>
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
                {form.items.map((item, idx) => {
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
                        setForm((prev) => {
                          const reordered = [...prev.items];
                          const [moved] = reordered.splice(dragIdx, 1);
                          reordered.splice(idx, 0, moved);
                          return { ...prev, items: reordered };
                        });
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
                            {suggestions.map((s: any) => (
                              <button
                                key={s.id}
                                type="button"
                                className="w-full text-left px-3 py-2 text-sm hover:bg-primary/5 border-b border-gray-50 last:border-0"
                                onMouseDown={(e) => { e.preventDefault(); applySavedItem(idx, s); }}
                              >
                                <span className="font-medium text-gray-900">{s.description}</span>
                                <span className="ml-2 text-gray-500">{Number(s.rate).toFixed(2)} | Tax: {Number(s.taxRate)}%</span>
                                {s._productId && <span className="ml-2 inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium bg-blue-100 text-blue-700">Product</span>}
                              </button>
                            ))}
                          </div>
                        )}
                      </td>
                      <td className="py-2 pr-2">
                        <input type="number" step="0.01" value={item.quantity} onChange={(e) => updateItem(idx, 'quantity', e.target.value)} className={inputClass} />
                      </td>
                      <td className="py-2 pr-2">
                        <input type="number" step="0.01" value={item.unitPrice} onChange={(e) => updateItem(idx, 'unitPrice', e.target.value)} className={inputClass} />
                      </td>
                      <td className="py-2 pr-2">
                        <input type="number" step="0.01" value={item.taxRate} onChange={(e) => updateItem(idx, 'taxRate', e.target.value)} className={inputClass} />
                      </td>
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
                        <button type="button" onClick={() => removeItem(idx)} className="text-gray-400 hover:text-red-500 p-1" aria-label="Remove">x</button>
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
                <Row label="Total" value={`${totals.total.toFixed(2)} ${form.currency}`} bold />
                {convertedTotal && (
                  <div className="mt-1 text-xs text-gray-500 text-right">
                    Approx. {convertedTotal.amount.toFixed(2)} {convertedTotal.currency}
                    <span className="ml-1 text-gray-400">
                      (1 {form.currency} = {convertedTotal.rate.toFixed(4)} {convertedTotal.currency})
                    </span>
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>

        <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-6 grid grid-cols-1 sm:grid-cols-2 gap-4">
          <Field label="Notes">
            <textarea rows={4} value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} className={inputClass} />
          </Field>
          <Field label="Terms">
            <textarea rows={4} value={form.terms} onChange={(e) => setForm({ ...form, terms: e.target.value })} className={inputClass} />
          </Field>
        </div>

        <CustomFieldsForm fieldTo="invoice" values={customFieldValues} onChange={setCustomFieldValues} />

        <div className="flex justify-end gap-2">
          <Link href="/invoices" className="px-4 py-2 text-sm font-medium text-gray-600 hover:text-gray-900">Cancel</Link>
          <button type="submit" disabled={saving} className="px-4 py-2 bg-primary text-white text-sm font-medium rounded-lg hover:bg-primary/90 disabled:opacity-50">
            {saving ? 'Saving...' : 'Create Invoice'}
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
      <span>{label}</span>
      <span className="tabular-nums">{value}</span>
    </div>
  );
}
