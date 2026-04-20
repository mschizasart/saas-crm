'use client';

import { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { DetailPageLayout } from '@/components/layouts/detail-page-layout';

interface Item {
  id?: string;
  description: string;
  qty: number;
  rate: number;
  tax1: string | null;
}

interface Estimate {
  id: string;
  number: string;
  date: string;
  expiryDate?: string;
  status: string;
  currency: string;
  subTotal: number;
  totalTax: number;
  discount: number;
  total: number;
  clientNote?: string;
  terms?: string;
  client?: { id: string; company?: string } | null;
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
        <div className="h-4 w-32 bg-gray-100 dark:bg-gray-800 rounded" />
        <div className="h-7 w-64 bg-gray-100 dark:bg-gray-800 rounded" />
        <div className="h-64 bg-gray-100 dark:bg-gray-800 rounded-xl" />
      </div>
    );
  }
  if (error || !est) {
    return (
      <div>
        <Link href="/estimates" className="text-sm text-gray-500 dark:text-gray-400">← Back</Link>
        <div className="mt-4 px-4 py-3 bg-red-50 text-red-600 text-sm rounded">{error ?? 'Not found'}</div>
      </div>
    );
  }

  return (
    <DetailPageLayout
      title={`Estimate ${est.number}`}
      subtitle={`${est.client?.company ?? '—'} · ${est.date ? new Date(est.date).toLocaleDateString() : ''}`}
      breadcrumbs={[
        { label: 'Estimates', href: '/estimates' },
        { label: `Estimate ${est.number}` },
      ]}
      badge={
        <span className="inline-flex items-center px-2 py-1 rounded-full text-xs font-medium bg-primary/10 text-primary">
          {est.status}
        </span>
      }
      actions={[
        { label: 'Edit', href: `/estimates/${id}/edit`, variant: 'secondary' },
        { label: 'Send', onClick: () => runAction('send'), disabled: busy, variant: 'secondary' },
        { label: 'Accept', onClick: () => runAction('accept'), disabled: busy, variant: 'secondary' },
        { label: 'Decline', onClick: () => runAction('decline'), disabled: busy, variant: 'secondary' },
        { label: 'Convert to Invoice', onClick: () => runAction('convert-to-invoice'), disabled: busy, variant: 'primary' },
        { label: 'Duplicate', onClick: () => runAction('duplicate'), disabled: busy, variant: 'secondary' },
      ]}
    >
      <div className="bg-white dark:bg-gray-900 rounded-xl border border-gray-100 dark:border-gray-800 shadow-sm overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 dark:bg-gray-900 text-left text-xs text-gray-500 dark:text-gray-400 uppercase">
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
              <tr key={it.id ?? i} className="border-t border-gray-100 dark:border-gray-800">
                <td className="px-4 py-3">{it.description}</td>
                <td className="px-4 py-3 text-right tabular-nums">{it.qty}</td>
                <td className="px-4 py-3 text-right tabular-nums">{Number(it.rate).toFixed(2)}</td>
                <td className="px-4 py-3 text-right tabular-nums">{it.tax1 ?? '—'}</td>
                <td className="px-4 py-3 text-right tabular-nums">{(Number(it.qty) * Number(it.rate)).toFixed(2)}</td>
              </tr>
            ))}
          </tbody>
        </table>

        <div className="flex justify-end p-4 border-t border-gray-100 dark:border-gray-800 bg-gray-50/50 dark:bg-gray-800/50">
          <div className="w-64 text-sm space-y-1">
            <Row label="Subtotal" value={Number(est.subTotal).toFixed(2)} />
            <Row label="Tax" value={Number(est.totalTax).toFixed(2)} />
            <Row label="Discount" value={`-${Number(est.discount).toFixed(2)}`} />
            <div className="border-t border-gray-200 dark:border-gray-700 mt-2 pt-2">
              <Row label="Total" value={`${Number(est.total).toFixed(2)} ${est.currency}`} bold />
            </div>
          </div>
        </div>
      </div>

      {(est.clientNote || est.terms) && (
        <div className="mt-6 grid grid-cols-1 sm:grid-cols-2 gap-4">
          {est.clientNote && (
            <div className="bg-white dark:bg-gray-900 rounded-xl border border-gray-100 dark:border-gray-800 p-4">
              <h3 className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase mb-2">Notes</h3>
              <p className="text-sm text-gray-700 dark:text-gray-300 whitespace-pre-wrap">{est.clientNote}</p>
            </div>
          )}
          {est.terms && (
            <div className="bg-white dark:bg-gray-900 rounded-xl border border-gray-100 dark:border-gray-800 p-4">
              <h3 className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase mb-2">Terms</h3>
              <p className="text-sm text-gray-700 dark:text-gray-300 whitespace-pre-wrap">{est.terms}</p>
            </div>
          )}
        </div>
      )}
    </DetailPageLayout>
  );
}

function Row({ label, value, bold }: { label: string; value: React.ReactNode; bold?: boolean }) {
  return (
    <div className={`flex justify-between ${bold ? 'font-semibold text-gray-900' : 'text-gray-600'}`}>
      <span>{label}</span><span className="tabular-nums">{value}</span>
    </div>
  );
}
