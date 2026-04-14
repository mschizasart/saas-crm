'use client';

import { useState, useEffect, FormEvent, useMemo } from 'react';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';

interface ClientOption { id: string; company?: string; company_name?: string; name?: string; }
interface LineItem { description: string; quantity: string; unitPrice: string; taxRate: string; }
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

function getToken(): string | null {
  if (typeof window === 'undefined') return null;
  return localStorage.getItem('access_token');
}

export default function EditInvoicePage() {
  const { id } = useParams() as { id: string };
  const router = useRouter();
  const [form, setForm] = useState<InvoiceForm | null>(null);
  const [clients, setClients] = useState<ClientOption[]>([]);
  const [status, setStatus] = useState<string>('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const [invRes, clientsRes] = await Promise.all([
          fetch(`${API_BASE}/api/v1/invoices/${id}`, { headers: { Authorization: `Bearer ${getToken()}` } }),
          fetch(`${API_BASE}/api/v1/clients?limit=100`, { headers: { Authorization: `Bearer ${getToken()}` } }),
        ]);
        if (!invRes.ok) throw new Error('Failed to load invoice');
        const inv = await invRes.json();
        const data = inv.data ?? inv;
        setStatus(data.status ?? '');
        setForm({
          clientId: data.clientId ?? data.client?.id ?? '',
          date: (data.date ?? '').slice(0, 10),
          dueDate: (data.dueDate ?? '').slice(0, 10),
          currency: data.currency ?? 'USD',
          notes: data.notes ?? '',
          terms: data.terms ?? '',
          discount: data.discount != null ? String(data.discount) : '0',
          items: (data.items ?? []).length > 0 ? data.items.map((it: {
            description?: string; quantity?: number; unitPrice?: number; taxRate?: number;
          }) => ({
            description: it.description ?? '',
            quantity: String(it.quantity ?? 1),
            unitPrice: String(it.unitPrice ?? 0),
            taxRate: String(it.taxRate ?? 0),
          })) : [{ ...EMPTY_ITEM }],
        });
        if (clientsRes.ok) {
          const cj = await clientsRes.json();
          setClients(cj.data ?? []);
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed');
      } finally {
        setLoading(false);
      }
    })();
  }, [id]);

  const totals = useMemo(() => {
    if (!form) return { subtotal: 0, taxTotal: 0, discount: 0, total: 0 };
    let subtotal = 0, taxTotal = 0;
    for (const item of form.items) {
      const qty = parseFloat(item.quantity) || 0;
      const price = parseFloat(item.unitPrice) || 0;
      const rate = parseFloat(item.taxRate) || 0;
      const line = qty * price;
      subtotal += line;
      taxTotal += (line * rate) / 100;
    }
    const discount = parseFloat(form.discount) || 0;
    return { subtotal, taxTotal, discount, total: Math.max(0, subtotal + taxTotal - discount) };
  }, [form]);

  if (loading) return <div className="animate-pulse h-96 bg-gray-100 rounded-xl max-w-5xl" />;
  if (!form) return <div className="text-red-600">{error ?? 'Not found'}</div>;

  if (status !== 'draft') {
    return (
      <div className="max-w-3xl">
        <Link href={`/invoices/${id}`} className="text-sm text-gray-500 hover:text-primary">← Back</Link>
        <div className="mt-4 px-4 py-3 bg-amber-50 border border-amber-200 rounded text-sm text-amber-700">
          Only draft invoices can be edited. Current status: <b>{status}</b>.
        </div>
      </div>
    );
  }

  function updateItem(idx: number, key: keyof LineItem, value: string) {
    setForm((prev) => prev ? { ...prev, items: prev.items.map((it, i) => i === idx ? { ...it, [key]: value } : it) } : prev);
  }
  function addItem() {
    setForm((p) => p ? { ...p, items: [...p.items, { ...EMPTY_ITEM }] } : p);
  }
  function removeItem(idx: number) {
    setForm((p) => p ? { ...p, items: p.items.length > 1 ? p.items.filter((_, i) => i !== idx) : p.items } : p);
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!form) return;
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
      const res = await fetch(`${API_BASE}/api/v1/invoices/${id}`, {
        method: 'PATCH',
        headers: { Authorization: `Bearer ${getToken()}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (!res.ok) throw new Error(`Save failed (${res.status})`);
      router.push(`/invoices/${id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Save failed');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="max-w-5xl">
      <div className="mb-4">
        <Link href={`/invoices/${id}`} className="text-sm text-gray-500 hover:text-primary">← Back</Link>
      </div>
      <h1 className="text-2xl font-bold text-gray-900 mb-6">Edit Invoice</h1>

      <form onSubmit={handleSubmit} className="space-y-6">
        {error && <div className="px-3 py-2 bg-red-50 border border-red-100 text-sm text-red-600 rounded">{error}</div>}

        <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-6">
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            <Field label="Client" required className="sm:col-span-2">
              <select required value={form.clientId} onChange={(e) => setForm({ ...form, clientId: e.target.value })} className={inputClass}>
                <option value="">— Select —</option>
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

        <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-6">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-sm font-semibold text-gray-700">Line Items</h2>
            <button type="button" onClick={addItem} className="text-sm text-primary hover:underline">+ Add item</button>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs text-gray-500 uppercase">
                  <th className="pb-2 pr-2">Description</th>
                  <th className="pb-2 pr-2 w-24">Qty</th>
                  <th className="pb-2 pr-2 w-32">Unit Price</th>
                  <th className="pb-2 pr-2 w-24">Tax %</th>
                  <th className="pb-2 pr-2 w-28 text-right">Amount</th>
                  <th className="pb-2 w-8" />
                </tr>
              </thead>
              <tbody>
                {form.items.map((item, idx) => {
                  const amount = (parseFloat(item.quantity) || 0) * (parseFloat(item.unitPrice) || 0);
                  return (
                    <tr key={idx} className="border-t border-gray-100">
                      <td className="py-2 pr-2">
                        <input value={item.description} onChange={(e) => updateItem(idx, 'description', e.target.value)} className={inputClass} />
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
                      <td className="py-2">
                        <button type="button" onClick={() => removeItem(idx)} className="text-gray-400 hover:text-red-500">×</button>
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

        <div className="flex justify-end gap-2">
          <Link href={`/invoices/${id}`} className="px-4 py-2 text-sm font-medium text-gray-600 hover:text-gray-900">Cancel</Link>
          <button type="submit" disabled={saving} className="px-4 py-2 bg-primary text-white text-sm font-medium rounded-lg hover:bg-primary/90 disabled:opacity-50">
            {saving ? 'Saving…' : 'Save Changes'}
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
