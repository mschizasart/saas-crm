'use client';

import { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';

interface Item {
  id?: string;
  description: string;
  quantity: number;
  unitPrice: number;
  taxRate: number;
}

interface Estimate {
  id: string;
  number: string;
  date: string;
  expiryDate?: string;
  status: string;
  currency: string;
  subtotal: number;
  tax: number;
  discount: number;
  total: number;
  notes?: string;
  terms?: string;
  client?: { id: string; company?: string; company_name?: string } | null;
  items: Item[];
}

const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001';

function getToken(): string | null {
  if (typeof window === 'undefined') return null;
  return localStorage.getItem('access_token');
}

function authHeaders(): HeadersInit {
  return { Authorization: `Bearer ${getToken()}`, 'Content-Type': 'application/json' };
}

export default function EstimateDetailPage() {
  const { id } = useParams() as { id: string };
  const router = useRouter();
  const [est, setEst] = useState<Estimate | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const fetchEst = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`${API_BASE}/api/v1/estimates/${id}`, { headers: authHeaders() });
      if (!res.ok) throw new Error(`Failed (${res.status})`);
      const json = await res.json();
      setEst(json.data ?? json);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed');
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => { if (id) fetchEst(); }, [id, fetchEst]);

  async function runAction(path: string, method = 'POST') {
    setBusy(true);
    try {
      const res = await fetch(`${API_BASE}/api/v1/estimates/${id}/${path}`, { method, headers: authHeaders() });
      if (!res.ok) throw new Error(`Action failed (${res.status})`);
      const json = await res.json().catch(() => null);
      if (path === 'convert-to-invoice') {
        const invId = json?.invoiceId ?? json?.id ?? json?.data?.id;
        if (invId) { router.push(`/invoices/${invId}`); return; }
      }
      if (path === 'duplicate') {
        const newId = json?.id ?? json?.data?.id;
        if (newId) { router.push(`/estimates/${newId}`); return; }
      }
      await fetchEst();
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Action failed');
    } finally {
      setBusy(false);
    }
  }

  if (loading) {
    return (
      <div className="max-w-4xl animate-pulse space-y-3">
        <div className="h-4 w-32 bg-gray-100 rounded" />
        <div className="h-7 w-64 bg-gray-100 rounded" />
        <div className="h-64 bg-gray-100 rounded-xl" />
      </div>
    );
  }
  if (error || !est) {
    return (
      <div>
        <Link href="/estimates" className="text-sm text-gray-500">← Back</Link>
        <div className="mt-4 px-4 py-3 bg-red-50 text-red-600 text-sm rounded">{error ?? 'Not found'}</div>
      </div>
    );
  }

  return (
    <div className="max-w-4xl">
      <div className="mb-4">
        <Link href="/estimates" className="text-sm text-gray-500 hover:text-primary">← Back to estimates</Link>
      </div>

      <div className="flex items-start justify-between mb-6 gap-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Estimate {est.number}</h1>
          <p className="text-sm text-gray-500 mt-1">
            {est.client?.company ?? est.client?.company_name ?? '—'} · {est.date ? new Date(est.date).toLocaleDateString() : ''}
          </p>
        </div>
        <span className="inline-flex items-center px-2 py-1 rounded-full text-xs font-medium bg-primary/10 text-primary">
          {est.status}
        </span>
      </div>

      <div className="flex flex-wrap gap-2 mb-6">
        <Link href={`/estimates/${id}/edit`} className="px-3 py-1.5 text-sm border border-gray-200 rounded-lg hover:bg-gray-50">Edit</Link>
        <button disabled={busy} onClick={() => runAction('send')} className="px-3 py-1.5 text-sm border border-gray-200 rounded-lg hover:bg-gray-50 disabled:opacity-50">Send</button>
        <button disabled={busy} onClick={() => runAction('accept')} className="px-3 py-1.5 text-sm border border-green-200 text-green-700 rounded-lg hover:bg-green-50 disabled:opacity-50">Accept</button>
        <button disabled={busy} onClick={() => runAction('decline')} className="px-3 py-1.5 text-sm border border-red-200 text-red-700 rounded-lg hover:bg-red-50 disabled:opacity-50">Decline</button>
        <button disabled={busy} onClick={() => runAction('convert-to-invoice')} className="px-3 py-1.5 text-sm bg-primary text-white rounded-lg hover:bg-primary/90 disabled:opacity-50">Convert to Invoice</button>
        <button disabled={busy} onClick={() => runAction('duplicate')} className="px-3 py-1.5 text-sm border border-gray-200 rounded-lg hover:bg-gray-50 disabled:opacity-50">Duplicate</button>
      </div>

      <div className="bg-white rounded-xl border border-gray-100 shadow-sm overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 text-left text-xs text-gray-500 uppercase">
            <tr>
              <th className="px-4 py-3">Description</th>
              <th className="px-4 py-3 w-20 text-right">Qty</th>
              <th className="px-4 py-3 w-28 text-right">Unit</th>
              <th className="px-4 py-3 w-20 text-right">Tax</th>
              <th className="px-4 py-3 w-28 text-right">Amount</th>
            </tr>
          </thead>
          <tbody>
            {est.items.map((it, i) => (
              <tr key={it.id ?? i} className="border-t border-gray-100">
                <td className="px-4 py-3">{it.description}</td>
                <td className="px-4 py-3 text-right tabular-nums">{it.quantity}</td>
                <td className="px-4 py-3 text-right tabular-nums">{it.unitPrice.toFixed(2)}</td>
                <td className="px-4 py-3 text-right tabular-nums">{it.taxRate}%</td>
                <td className="px-4 py-3 text-right tabular-nums">{(it.quantity * it.unitPrice).toFixed(2)}</td>
              </tr>
            ))}
          </tbody>
        </table>

        <div className="flex justify-end p-4 border-t border-gray-100 bg-gray-50/50">
          <div className="w-64 text-sm space-y-1">
            <Row label="Subtotal" value={est.subtotal?.toFixed?.(2) ?? est.subtotal} />
            <Row label="Tax" value={est.tax?.toFixed?.(2) ?? est.tax} />
            <Row label="Discount" value={`-${est.discount?.toFixed?.(2) ?? est.discount}`} />
            <div className="border-t border-gray-200 mt-2 pt-2">
              <Row label="Total" value={`${est.total?.toFixed?.(2) ?? est.total} ${est.currency}`} bold />
            </div>
          </div>
        </div>
      </div>

      {(est.notes || est.terms) && (
        <div className="mt-6 grid grid-cols-1 sm:grid-cols-2 gap-4">
          {est.notes && (
            <div className="bg-white rounded-xl border border-gray-100 p-4">
              <h3 className="text-xs font-semibold text-gray-500 uppercase mb-2">Notes</h3>
              <p className="text-sm text-gray-700 whitespace-pre-wrap">{est.notes}</p>
            </div>
          )}
          {est.terms && (
            <div className="bg-white rounded-xl border border-gray-100 p-4">
              <h3 className="text-xs font-semibold text-gray-500 uppercase mb-2">Terms</h3>
              <p className="text-sm text-gray-700 whitespace-pre-wrap">{est.terms}</p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function Row({ label, value, bold }: { label: string; value: React.ReactNode; bold?: boolean }) {
  return (
    <div className={`flex justify-between ${bold ? 'font-semibold text-gray-900' : 'text-gray-600'}`}>
      <span>{label}</span><span className="tabular-nums">{value}</span>
    </div>
  );
}
