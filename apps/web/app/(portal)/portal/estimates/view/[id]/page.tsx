'use client';

import { useState, useEffect, useCallback } from 'react';
import { useParams } from 'next/navigation';

interface Item {
  id: string;
  description: string;
  quantity: number;
  unitPrice: number;
  taxRate: number;
  total: number;
}

interface Estimate {
  id: string;
  number: string;
  date: string;
  expiryDate: string | null;
  status: string;
  currency: string;
  subtotal: number;
  taxTotal: number;
  total: number;
  notes: string | null;
  client?: { id: string; company: string } | null;
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
    sent: 'bg-blue-100 text-blue-700',
    accepted: 'bg-green-100 text-green-700',
    declined: 'bg-red-100 text-red-700',
    expired: 'bg-gray-100 text-gray-500',
  };
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium capitalize ${map[status] ?? 'bg-gray-100 text-gray-500'}`}>
      {status}
    </span>
  );
}

export default function EstimateViewPage() {
  const params = useParams();
  const id = params.id as string;

  const [estimate, setEstimate] = useState<Estimate | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [acting, setActing] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const fetchEstimate = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`${API_BASE}/api/v1/estimates/${id}`, { headers: authHeaders() });
      if (!res.ok) throw new Error(`Server responded with ${res.status}`);
      setEstimate(await res.json());
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed');
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    fetchEstimate();
  }, [fetchEstimate]);

  async function action(path: string) {
    setActing(true);
    setMessage(null);
    try {
      const res = await fetch(`${API_BASE}/api/v1/estimates/${id}${path}`, {
        method: 'POST',
        headers: authHeaders(),
      });
      if (!res.ok) throw new Error(`Failed with status ${res.status}`);
      setMessage(path === '/accept' ? 'Estimate accepted!' : 'Estimate declined.');
      fetchEstimate();
    } catch (err) {
      setMessage(err instanceof Error ? err.message : 'Failed');
    } finally {
      setActing(false);
    }
  }

  async function downloadPdf() {
    try {
      const res = await fetch(`${API_BASE}/api/v1/estimates/${id}/pdf`, { headers: authHeaders() });
      if (!res.ok) throw new Error('Failed');
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `estimate-${estimate?.number ?? id}.pdf`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Download failed');
    }
  }

  if (loading) return <div className="max-w-3xl mx-auto py-10 text-sm text-gray-400 dark:text-gray-500 text-center">Loading…</div>;

  if (error || !estimate) {
    return (
      <div className="max-w-3xl mx-auto py-10 text-center">
        <p className="text-red-600 text-sm mb-3">{error ?? 'Not found'}</p>
        <button onClick={fetchEstimate} className="text-sm text-primary underline">Retry</button>
      </div>
    );
  }

  const canAct = estimate.status === 'sent' || estimate.status === 'draft';

  return (
    <div className="max-w-3xl mx-auto">
      {message && (
        <div className="mb-4 px-3 py-2 bg-blue-50 border border-blue-100 text-blue-700 text-sm rounded-lg">
          {message}
        </div>
      )}
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-3">
          <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">Estimate {estimate.number}</h1>
          <StatusBadge status={estimate.status} />
        </div>
        <button
          onClick={downloadPdf}
          className="px-4 py-2 text-sm font-medium border border-gray-200 dark:border-gray-700 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-800"
        >
          Download PDF
        </button>
      </div>

      <div className="bg-white dark:bg-gray-900 rounded-xl border border-gray-100 dark:border-gray-800 shadow-sm p-6 mb-6">
        <dl className="grid grid-cols-1 sm:grid-cols-3 gap-4 text-sm">
          <div>
            <dt className="text-xs font-semibold text-gray-400 dark:text-gray-500 uppercase">Date</dt>
            <dd className="text-gray-900 dark:text-gray-100 mt-1">{new Date(estimate.date).toLocaleDateString()}</dd>
          </div>
          <div>
            <dt className="text-xs font-semibold text-gray-400 dark:text-gray-500 uppercase">Expiry</dt>
            <dd className="text-gray-900 dark:text-gray-100 mt-1">
              {estimate.expiryDate ? new Date(estimate.expiryDate).toLocaleDateString() : '—'}
            </dd>
          </div>
          <div>
            <dt className="text-xs font-semibold text-gray-400 dark:text-gray-500 uppercase">Client</dt>
            <dd className="text-gray-900 dark:text-gray-100 mt-1">{estimate.client?.company ?? '—'}</dd>
          </div>
        </dl>
      </div>

      <div className="bg-white dark:bg-gray-900 rounded-xl border border-gray-100 dark:border-gray-800 shadow-sm overflow-hidden mb-6">
        <table className="min-w-full text-sm">
          <thead>
            <tr className="bg-gray-50 dark:bg-gray-900 border-b border-gray-100 dark:border-gray-800 text-left text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide">
              <th className="px-4 py-3">Description</th>
              <th className="px-4 py-3 text-right">Qty</th>
              <th className="px-4 py-3 text-right">Unit Price</th>
              <th className="px-4 py-3 text-right">Total</th>
            </tr>
          </thead>
          <tbody>
            {estimate.items.map((it) => (
              <tr key={it.id} className="border-b border-gray-100 dark:border-gray-800 last:border-0">
                <td className="px-4 py-3 text-gray-900 dark:text-gray-100">{it.description}</td>
                <td className="px-4 py-3 text-right text-gray-500 dark:text-gray-400">{Number(it.quantity)}</td>
                <td className="px-4 py-3 text-right text-gray-500 dark:text-gray-400">{Number(it.unitPrice).toFixed(2)}</td>
                <td className="px-4 py-3 text-right font-medium text-gray-900 dark:text-gray-100">{Number(it.total).toFixed(2)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <div className="border-t border-gray-100 dark:border-gray-800 p-4 text-sm space-y-1 max-w-xs ml-auto">
          <div className="flex justify-between">
            <span className="text-gray-500 dark:text-gray-400">Subtotal</span>
            <span className="font-medium">{Number(estimate.subtotal).toFixed(2)}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-gray-500 dark:text-gray-400">Tax</span>
            <span className="font-medium">{Number(estimate.taxTotal).toFixed(2)}</span>
          </div>
          <div className="flex justify-between text-base font-semibold border-t border-gray-100 dark:border-gray-800 pt-2 mt-2">
            <span>Total</span>
            <span>{Number(estimate.total).toFixed(2)} {estimate.currency}</span>
          </div>
        </div>
      </div>

      {canAct && (
        <div className="flex gap-3">
          <button
            onClick={() => action('/accept')}
            disabled={acting}
            className="flex-1 px-4 py-3 text-sm font-medium bg-green-600 text-white rounded-lg hover:bg-green-700 disabled:opacity-50"
          >
            Accept Estimate
          </button>
          <button
            onClick={() => action('/decline')}
            disabled={acting}
            className="flex-1 px-4 py-3 text-sm font-medium bg-red-600 text-white rounded-lg hover:bg-red-700 disabled:opacity-50"
          >
            Decline
          </button>
        </div>
      )}
    </div>
  );
}
