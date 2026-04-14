'use client';

import { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';

interface Item {
  id: string;
  description: string;
  quantity: number;
  unitPrice: number;
  taxRate: number;
  total: number;
}

interface CreditNote {
  id: string;
  number: string;
  date: string;
  status: string;
  currency: string;
  subtotal: number;
  taxTotal: number;
  total: number;
  notes: string | null;
  invoiceId: string | null;
  client?: { id: string; company: string } | null;
  invoice?: { id: string; number: string } | null;
  items: Item[];
}

const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001';

function authHeaders(): HeadersInit {
  const token = typeof window === 'undefined' ? null : localStorage.getItem('access_token');
  return { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
}

function StatusBadge({ status }: { status: string }) {
  const map: Record<string, string> = {
    draft: 'bg-gray-100 text-gray-500',
    open: 'bg-blue-100 text-blue-700',
    applied: 'bg-green-100 text-green-700',
    voided: 'bg-red-100 text-red-700',
  };
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium capitalize ${map[status] ?? 'bg-gray-100 text-gray-500'}`}>
      {status}
    </span>
  );
}

export default function CreditNoteDetailPage() {
  const params = useParams();
  const router = useRouter();
  const id = params.id as string;

  const [cn, setCn] = useState<CreditNote | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [acting, setActing] = useState(false);

  const fetchCn = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`${API_BASE}/api/v1/credit-notes/${id}`, { headers: authHeaders() });
      if (!res.ok) throw new Error(`Server responded with ${res.status}`);
      setCn(await res.json());
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed');
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    fetchCn();
  }, [fetchCn]);

  async function doAction(path: string, method: string = 'POST') {
    setActing(true);
    try {
      const res = await fetch(`${API_BASE}/api/v1/credit-notes/${id}${path}`, {
        method,
        headers: authHeaders(),
      });
      if (!res.ok) throw new Error(`Failed with status ${res.status}`);
      if (method === 'DELETE') {
        router.push('/credit-notes');
        return;
      }
      fetchCn();
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Failed');
    } finally {
      setActing(false);
    }
  }

  if (loading) return <div className="flex justify-center py-24 text-sm text-gray-400">Loading…</div>;

  if (error || !cn) {
    return (
      <div className="px-4 py-8 text-center">
        <p className="text-red-600 text-sm mb-3">{error ?? 'Not found'}</p>
        <button onClick={fetchCn} className="text-sm text-primary underline">Retry</button>
      </div>
    );
  }

  return (
    <div className="max-w-4xl mx-auto">
      <div className="flex items-center gap-2 mb-6 text-sm text-gray-500">
        <Link href="/credit-notes" className="hover:text-primary">Credit Notes</Link>
        <span>/</span>
        <span className="text-gray-900 font-medium">{cn.number}</span>
      </div>

      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mb-6">
        <div className="flex items-center gap-3">
          <h1 className="text-2xl font-bold text-gray-900">{cn.number}</h1>
          <StatusBadge status={cn.status} />
        </div>
        <div className="flex gap-2">
          {cn.status === 'draft' && (
            <button
              onClick={() => confirm('Delete this credit note?') && doAction('', 'DELETE')}
              disabled={acting}
              className="px-4 py-2 text-sm font-medium border border-red-200 text-red-600 rounded-lg hover:bg-red-50 disabled:opacity-50"
            >
              Delete
            </button>
          )}
          {cn.status === 'open' && cn.invoiceId && (
            <button
              onClick={() => doAction('/apply')}
              disabled={acting}
              className="px-4 py-2 text-sm font-medium bg-primary text-white rounded-lg hover:bg-primary/90 disabled:opacity-50"
            >
              Apply to Invoice
            </button>
          )}
          {cn.status === 'open' && (
            <button
              onClick={() => doAction('/void')}
              disabled={acting}
              className="px-4 py-2 text-sm font-medium border border-red-200 text-red-600 rounded-lg hover:bg-red-50 disabled:opacity-50"
            >
              Void
            </button>
          )}
        </div>
      </div>

      <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-6 mb-6">
        <dl className="grid grid-cols-1 sm:grid-cols-3 gap-4 text-sm">
          <div>
            <dt className="text-xs font-semibold text-gray-400 uppercase">Date</dt>
            <dd className="text-gray-900 mt-1">{new Date(cn.date).toLocaleDateString()}</dd>
          </div>
          <div>
            <dt className="text-xs font-semibold text-gray-400 uppercase">Client</dt>
            <dd className="text-gray-900 mt-1">
              {cn.client ? (
                <Link href={`/clients/${cn.client.id}`} className="text-primary hover:underline">
                  {cn.client.company}
                </Link>
              ) : '—'}
            </dd>
          </div>
          <div>
            <dt className="text-xs font-semibold text-gray-400 uppercase">Invoice</dt>
            <dd className="text-gray-900 mt-1">
              {cn.invoice ? (
                <Link href={`/invoices/${cn.invoice.id}`} className="text-primary hover:underline">
                  {cn.invoice.number}
                </Link>
              ) : '—'}
            </dd>
          </div>
        </dl>
      </div>

      <div className="bg-white rounded-xl border border-gray-100 shadow-sm overflow-hidden mb-6">
        <table className="min-w-full text-sm">
          <thead>
            <tr className="bg-gray-50 border-b border-gray-100 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide">
              <th className="px-4 py-3">Description</th>
              <th className="px-4 py-3 text-right">Qty</th>
              <th className="px-4 py-3 text-right">Unit Price</th>
              <th className="px-4 py-3 text-right">Tax %</th>
              <th className="px-4 py-3 text-right">Total</th>
            </tr>
          </thead>
          <tbody>
            {cn.items.map((it) => (
              <tr key={it.id} className="border-b border-gray-100 last:border-0">
                <td className="px-4 py-3 text-gray-900">{it.description}</td>
                <td className="px-4 py-3 text-right text-gray-500">{Number(it.quantity)}</td>
                <td className="px-4 py-3 text-right text-gray-500">{Number(it.unitPrice).toFixed(2)}</td>
                <td className="px-4 py-3 text-right text-gray-500">{Number(it.taxRate).toFixed(2)}</td>
                <td className="px-4 py-3 text-right font-medium text-gray-900">{Number(it.total).toFixed(2)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <div className="border-t border-gray-100 p-4 text-sm space-y-1 max-w-xs ml-auto">
          <div className="flex justify-between">
            <span className="text-gray-500">Subtotal</span>
            <span className="font-medium">{Number(cn.subtotal).toFixed(2)}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-gray-500">Tax</span>
            <span className="font-medium">{Number(cn.taxTotal).toFixed(2)}</span>
          </div>
          <div className="flex justify-between text-base font-semibold border-t border-gray-100 pt-2 mt-2">
            <span>Total</span>
            <span>{Number(cn.total).toFixed(2)} {cn.currency}</span>
          </div>
        </div>
      </div>

      {cn.notes && (
        <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-6">
          <h2 className="text-xs font-semibold text-gray-400 uppercase mb-2">Notes</h2>
          <p className="text-sm text-gray-700 whitespace-pre-wrap">{cn.notes}</p>
        </div>
      )}
    </div>
  );
}
