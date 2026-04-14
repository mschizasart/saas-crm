'use client';

import { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';

type Status = 'all' | 'draft' | 'open' | 'applied' | 'voided';

interface CreditNote {
  id: string;
  number: string;
  date: string;
  total: number;
  status: string;
  client?: { id: string; company: string } | null;
  invoice?: { id: string; number: string } | null;
  invoiceId?: string | null;
}

interface Response {
  data: CreditNote[];
  meta: { page: number; total: number; totalPages: number };
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

export default function CreditNotesPage() {
  const [status, setStatus] = useState<Status>('all');
  const [page, setPage] = useState(1);
  const [items, setItems] = useState<CreditNote[]>([]);
  const [meta, setMeta] = useState<Response['meta'] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchItems = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({ page: String(page), limit: '20' });
      if (status !== 'all') params.set('status', status);
      const res = await fetch(`${API_BASE}/api/v1/credit-notes?${params.toString()}`, {
        headers: authHeaders(),
      });
      if (!res.ok) throw new Error(`Server responded with ${res.status}`);
      const json: Response = await res.json();
      setItems(json.data ?? []);
      setMeta(json.meta ?? null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load');
    } finally {
      setLoading(false);
    }
  }, [status, page]);

  useEffect(() => {
    fetchItems();
  }, [fetchItems]);

  useEffect(() => {
    setPage(1);
  }, [status]);

  const tabs: { key: Status; label: string }[] = [
    { key: 'all', label: 'All' },
    { key: 'draft', label: 'Draft' },
    { key: 'open', label: 'Open' },
    { key: 'applied', label: 'Applied' },
    { key: 'voided', label: 'Voided' },
  ];

  const totalPages = meta?.totalPages ?? 1;

  return (
    <div>
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mb-6">
        <h1 className="text-2xl font-bold text-gray-900">Credit Notes</h1>
        <Link
          href="/credit-notes/new"
          className="inline-flex items-center gap-1.5 bg-primary text-white text-sm font-medium px-4 py-2 rounded-lg hover:bg-primary/90"
        >
          <span className="text-lg leading-none">+</span>
          New Credit Note
        </Link>
      </div>

      <div className="border-b border-gray-200 mb-4">
        <nav className="flex gap-1 -mb-px">
          {tabs.map((t) => (
            <button
              key={t.key}
              onClick={() => setStatus(t.key)}
              className={`px-4 py-2.5 text-sm font-medium border-b-2 transition-colors ${
                status === t.key ? 'border-primary text-primary' : 'border-transparent text-gray-500 hover:text-gray-700'
              }`}
            >
              {t.label}
            </button>
          ))}
        </nav>
      </div>

      <div className="bg-white rounded-xl border border-gray-100 shadow-sm overflow-hidden">
        {error && (
          <div className="px-4 py-3 bg-red-50 border-b border-red-100 text-sm text-red-600">
            {error} — <button className="underline" onClick={fetchItems}>retry</button>
          </div>
        )}
        <div className="overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead>
              <tr className="bg-gray-50 border-b border-gray-100 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide">
                <th className="px-4 py-3">Number</th>
                <th className="px-4 py-3">Date</th>
                <th className="px-4 py-3">Client</th>
                <th className="px-4 py-3">Invoice</th>
                <th className="px-4 py-3 text-right">Total</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3 text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={7} className="px-4 py-12 text-center text-gray-400">Loading…</td></tr>
              ) : items.length === 0 ? (
                <tr><td colSpan={7} className="px-4 py-12 text-center text-gray-400">No credit notes found</td></tr>
              ) : (
                items.map((cn) => (
                  <tr key={cn.id} className="border-b border-gray-100 last:border-0 hover:bg-gray-50/60">
                    <td className="px-4 py-3 font-medium text-gray-900">
                      <Link href={`/credit-notes/${cn.id}`} className="text-primary hover:underline">
                        {cn.number}
                      </Link>
                    </td>
                    <td className="px-4 py-3 text-gray-500">{new Date(cn.date).toLocaleDateString()}</td>
                    <td className="px-4 py-3 text-gray-500">{cn.client?.company ?? '—'}</td>
                    <td className="px-4 py-3 text-gray-500">
                      {cn.invoice ? (
                        <Link href={`/invoices/${cn.invoice.id}`} className="text-primary hover:underline">
                          {cn.invoice.number}
                        </Link>
                      ) : '—'}
                    </td>
                    <td className="px-4 py-3 text-right font-medium text-gray-900">{Number(cn.total).toFixed(2)}</td>
                    <td className="px-4 py-3"><StatusBadge status={cn.status} /></td>
                    <td className="px-4 py-3 text-right">
                      <Link href={`/credit-notes/${cn.id}`} className="text-xs text-gray-500 hover:text-primary">View</Link>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
        {!loading && meta && meta.total > 0 && (
          <div className="flex items-center justify-between px-4 py-3 border-t border-gray-100 bg-gray-50/50">
            <p className="text-xs text-gray-500">{meta.total} total</p>
            <div className="flex items-center gap-2">
              <button
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                disabled={page <= 1}
                className="px-3 py-1.5 text-xs font-medium rounded-md border border-gray-200 bg-white hover:bg-gray-50 disabled:opacity-40"
              >
                Previous
              </button>
              <span className="text-xs text-gray-600 min-w-[80px] text-center">Page {page} of {totalPages}</span>
              <button
                onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                disabled={page >= totalPages}
                className="px-3 py-1.5 text-xs font-medium rounded-md border border-gray-200 bg-white hover:bg-gray-50 disabled:opacity-40"
              >
                Next
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
