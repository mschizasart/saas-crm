'use client';

import { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';

interface Proposal {
  id: string;
  subject: string;
  totalValue: number;
  currency: string;
  status: string;
  createdAt: string;
  client?: { id: string; company?: string; company_name?: string } | null;
}

interface Response {
  data: Proposal[];
  meta: { page: number; per_page: number; total: number; total_pages: number };
}

const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001';

function getToken(): string | null {
  if (typeof window === 'undefined') return null;
  return localStorage.getItem('access_token');
}

const STATUS_COLORS: Record<string, string> = {
  draft: 'bg-gray-100 text-gray-700',
  sent: 'bg-blue-100 text-blue-700',
  opened: 'bg-indigo-100 text-indigo-700',
  accepted: 'bg-green-100 text-green-700',
  declined: 'bg-red-100 text-red-700',
};

export default function ProposalsPage() {
  const [items, setItems] = useState<Proposal[]>([]);
  const [meta, setMeta] = useState<Response['meta'] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [page, setPage] = useState(1);

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`${API_BASE}/api/v1/proposals?page=${page}&per_page=15`, { headers: { Authorization: `Bearer ${getToken()}` } });
      if (!res.ok) throw new Error(`Failed (${res.status})`);
      const json = await res.json();
      setItems(json.data ?? []);
      setMeta(json.meta ?? null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed');
    } finally {
      setLoading(false);
    }
  }, [page]);

  useEffect(() => { fetchData(); }, [fetchData]);

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold text-gray-900">Proposals</h1>
        <Link href="/proposals/new" className="inline-flex items-center gap-1.5 bg-primary text-white text-sm font-medium px-4 py-2 rounded-lg hover:bg-primary/90">
          <span className="text-lg leading-none">+</span>New Proposal
        </Link>
      </div>

      <div className="bg-white rounded-xl border border-gray-100 shadow-sm overflow-hidden">
        {error && <div className="px-4 py-3 bg-red-50 border-b border-red-100 text-sm text-red-600">{error}</div>}
        <div className="overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead>
              <tr className="bg-gray-50 border-b border-gray-100 text-left text-xs font-semibold text-gray-500 uppercase">
                <th className="px-4 py-3">Subject</th>
                <th className="px-4 py-3">Client</th>
                <th className="px-4 py-3">Value</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3">Created</th>
                <th className="px-4 py-3 text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                Array.from({ length: 6 }).map((_, i) => (
                  <tr key={i} className="border-b border-gray-100">
                    {Array.from({ length: 6 }).map((__, j) => (
                      <td key={j} className="px-4 py-3"><div className="h-4 bg-gray-100 rounded animate-pulse" /></td>
                    ))}
                  </tr>
                ))
              ) : items.length === 0 ? (
                <tr><td colSpan={6} className="px-4 py-12 text-center text-sm text-gray-400">No proposals yet</td></tr>
              ) : items.map((p) => (
                <tr key={p.id} className="border-b border-gray-100 hover:bg-gray-50/60">
                  <td className="px-4 py-3 font-medium text-gray-900">{p.subject}</td>
                  <td className="px-4 py-3 text-gray-600">{p.client?.company ?? p.client?.company_name ?? '—'}</td>
                  <td className="px-4 py-3 tabular-nums">{p.totalValue?.toFixed?.(2) ?? p.totalValue} {p.currency}</td>
                  <td className="px-4 py-3">
                    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${STATUS_COLORS[p.status] ?? 'bg-gray-100 text-gray-700'}`}>
                      {p.status}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-gray-500">{p.createdAt ? new Date(p.createdAt).toLocaleDateString() : '—'}</td>
                  <td className="px-4 py-3 text-right">
                    <Link href={`/proposals/${p.id}`} className="text-xs text-gray-500 hover:text-primary font-medium">View</Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {meta && meta.total > 0 && (
          <div className="flex items-center justify-between px-4 py-3 border-t border-gray-100 bg-gray-50/50">
            <p className="text-xs text-gray-500">{meta.total} total</p>
            <div className="flex items-center gap-2">
              <button onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={page <= 1} className="px-3 py-1.5 text-xs border border-gray-200 rounded-md bg-white disabled:opacity-40">Previous</button>
              <span className="text-xs text-gray-600">Page {page} of {meta.total_pages}</span>
              <button onClick={() => setPage((p) => Math.min(meta.total_pages, p + 1))} disabled={page >= meta.total_pages} className="px-3 py-1.5 text-xs border border-gray-200 rounded-md bg-white disabled:opacity-40">Next</button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
