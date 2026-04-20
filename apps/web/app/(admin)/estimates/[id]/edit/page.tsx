'use client';

import { useState, useEffect, FormEvent, useMemo } from 'react';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { ComplexFormPageLayout } from '@/components/layouts/complex-form-page-layout';

interface ClientOption { id: string; company?: string; company_name?: string; name?: string; }
interface LineItem { description: string; qty: string; rate: string; tax1: string; }

const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001';
const EMPTY_ITEM: LineItem = { description: '', qty: '1', rate: '0', tax1: '0' };

function getToken(): string | null {
  if (typeof window === 'undefined') return null;
  return localStorage.getItem('access_token');
}

export default function EditEstimatePage() {
  const { id } = useParams() as { id: string };
  const router = useRouter();
  const [clientId, setClientId] = useState('');
  const [date, setDate] = useState('');
  const [expiryDate, setExpiryDate] = useState('');
  const [currency, setCurrency] = useState('USD');
  const [clientNote, setClientNote] = useState('');
  const [terms, setTerms] = useState('');
  const [discount, setDiscount] = useState('0');
  const [items, setItems] = useState<LineItem[]>([{ ...EMPTY_ITEM }]);
  const [clients, setClients] = useState<ClientOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const [eRes, cRes] = await Promise.all([
          fetch(`${API_BASE}/api/v1/estimates/${id}`, { headers: { Authorization: `Bearer ${getToken()}` } }),
          fetch(`${API_BASE}/api/v1/clients?limit=100`, { headers: { Authorization: `Bearer ${getToken()}` } }),
        ]);
        if (!eRes.ok) throw new Error(`Failed (${eRes.status})`);
        const json = await eRes.json();
        const e = json.data ?? json;
        setClientId(e.clientId ?? e.client?.id ?? '');
        setDate((e.date ?? '').slice(0, 10));
        setExpiryDate((e.expiryDate ?? '').slice(0, 10));
        setCurrency(e.currency ?? 'USD');
        setClientNote(e.clientNote ?? e.notes ?? '');
        setTerms(e.terms ?? '');
        setDiscount(e.discount != null ? String(e.discount) : '0');
        setItems((e.items ?? []).length > 0 ? e.items.map((it: { description?: string; qty?: number; rate?: number; tax1?: number }) => ({
          description: it.description ?? '',
          qty: String(it.qty ?? 1),
          rate: String(it.rate ?? 0),
          tax1: String(it.tax1 ?? 0),
        })) : [{ ...EMPTY_ITEM }]);
        if (cRes.ok) setClients((await cRes.json()).data ?? []);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed');
      } finally {
        setLoading(false);
      }
    })();
  }, [id]);

  const totals = useMemo(() => {
    let subtotal = 0, taxTotal = 0;
    for (const it of items) {
      const line = (parseFloat(it.qty) || 0) * (parseFloat(it.rate) || 0);
      subtotal += line;
      taxTotal += (line * (parseFloat(it.tax1) || 0)) / 100;
    }
    const d = parseFloat(discount) || 0;
    return { subtotal, taxTotal, discount: d, total: Math.max(0, subtotal + taxTotal - d) };
  }, [items, discount]);

  function updateItem(idx: number, key: keyof LineItem, value: string) {
    setItems((prev) => prev.map((it, i) => i === idx ? { ...it, [key]: value } : it));
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      const payload = {
        clientId, date, expiryDate, currency, clientNote, terms,
        discount: Number(discount) || 0,
        items: items.map((it) => ({
          description: it.description,
          qty: Number(it.qty) || 0,
          rate: Number(it.rate) || 0,
          tax1: Number(it.tax1) || 0,
        })),
      };
      const res = await fetch(`${API_BASE}/api/v1/estimates/${id}`, {
        method: 'PATCH',
        headers: { Authorization: `Bearer ${getToken()}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (!res.ok) throw new Error(`Save failed (${res.status})`);
      router.push(`/estimates/${id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Save failed');
    } finally {
      setSaving(false);
    }
  }

  if (loading) return <div className="animate-pulse h-96 bg-gray-100 dark:bg-gray-800 rounded-xl max-w-5xl" />;

  return (
    <ComplexFormPageLayout
      title="Edit Estimate"
      backHref={`/estimates/${id}`}
      backLabel="Back"
      widthClass="max-w-5xl"
    >
      <form onSubmit={handleSubmit} className="space-y-6">
        {error && <div className="px-3 py-2 bg-red-50 border border-red-100 text-sm text-red-600 rounded">{error}</div>}

        <div className="bg-white dark:bg-gray-900 rounded-xl border border-gray-100 dark:border-gray-800 shadow-sm p-6">
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            <Field label="Client" required className="sm:col-span-2">
              <select required value={clientId} onChange={(e) => setClientId(e.target.value)} className={inputClass}>
                <option value="">— Select —</option>
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

        <div className="bg-white dark:bg-gray-900 rounded-xl border border-gray-100 dark:border-gray-800 shadow-sm p-6">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-sm font-semibold text-gray-700 dark:text-gray-300">Line Items</h2>
            <button type="button" onClick={() => setItems([...items, { ...EMPTY_ITEM }])} className="text-sm text-primary hover:underline">+ Add item</button>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs text-gray-500 dark:text-gray-400 uppercase">
                  <th className="pb-2 pr-2">Description</th>
                  <th className="pb-2 pr-2 w-24">Qty</th>
                  <th className="pb-2 pr-2 w-32">Unit Price</th>
                  <th className="pb-2 pr-2 w-24">Tax %</th>
                  <th className="pb-2 pr-2 w-28 text-right">Amount</th>
                  <th className="pb-2 w-8" />
                </tr>
              </thead>
              <tbody>
                {items.map((item, idx) => {
                  const amount = (parseFloat(item.qty) || 0) * (parseFloat(item.rate) || 0);
                  return (
                    <tr key={idx} className="border-t border-gray-100 dark:border-gray-800">
                      <td className="py-2 pr-2"><input value={item.description} onChange={(e) => updateItem(idx, 'description', e.target.value)} className={inputClass} /></td>
                      <td className="py-2 pr-2"><input type="number" step="0.01" value={item.qty} onChange={(e) => updateItem(idx, 'qty', e.target.value)} className={inputClass} /></td>
                      <td className="py-2 pr-2"><input type="number" step="0.01" value={item.rate} onChange={(e) => updateItem(idx, 'rate', e.target.value)} className={inputClass} /></td>
                      <td className="py-2 pr-2"><input type="number" step="0.01" value={item.tax1} onChange={(e) => updateItem(idx, 'tax1', e.target.value)} className={inputClass} /></td>
                      <td className="py-2 pr-2 text-right tabular-nums">{amount.toFixed(2)}</td>
                      <td className="py-2"><button type="button" onClick={() => setItems((p) => p.length > 1 ? p.filter((_, i) => i !== idx) : p)} className="text-gray-400 dark:text-gray-500 hover:text-red-500">×</button></td>
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
              <div className="border-t border-gray-200 dark:border-gray-700 mt-2 pt-2">
                <Row label="Total" value={`${totals.total.toFixed(2)} ${currency}`} bold />
              </div>
            </div>
          </div>
        </div>

        <div className="bg-white dark:bg-gray-900 rounded-xl border border-gray-100 dark:border-gray-800 shadow-sm p-6 grid grid-cols-1 sm:grid-cols-2 gap-4">
          <Field label="Notes"><textarea rows={4} value={clientNote} onChange={(e) => setClientNote(e.target.value)} className={inputClass} /></Field>
          <Field label="Terms"><textarea rows={4} value={terms} onChange={(e) => setTerms(e.target.value)} className={inputClass} /></Field>
        </div>

        <div className="flex justify-end gap-2">
          <Link href={`/estimates/${id}`} className="px-4 py-2 text-sm font-medium text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-gray-100">Cancel</Link>
          <button type="submit" disabled={saving} className="px-4 py-2 bg-primary text-white text-sm font-medium rounded-lg hover:bg-primary/90 disabled:opacity-50">
            {saving ? 'Saving…' : 'Save'}
          </button>
        </div>
      </form>
    </ComplexFormPageLayout>
  );
}

const inputClass = 'w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary bg-white';

function Field({ label, required, children, className }: { label: string; required?: boolean; children: React.ReactNode; className?: string }) {
  return (
    <div className={className}>
      <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">
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
