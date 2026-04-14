'use client';

import { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';

interface Estimate {
  id: string;
  number: string;
  date: string;
  total: number;
  currency: string;
  status: string;
  client?: { id: string; company?: string; company_name?: string } | null;
}

interface EstimatesResponse {
  data: Estimate[];
  meta: { page: number; per_page: number; total: number; total_pages: number };
}

interface Stats {
  draft?: number;
  sent?: number;
  accepted?: number;
  declined?: number;
  total?: number;
}

const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001';

function getToken(): string | null {
  if (typeof window === 'undefined') return null;
  return localStorage.getItem('access_token');
}

const STATUS_COLORS: Record<string, string> = {
  draft: 'bg-gray-100 text-gray-700',
  sent: 'bg-blue-100 text-blue-700',
  accepted: 'bg-green-100 text-green-700',
  declined: 'bg-red-100 text-red-700',
  expired: 'bg-amber-100 text-amber-700',
};

export default function EstimatesPage() {
  const [items, setItems] = useState<Estimate[]>([]);
  const [meta, setMeta] = useState<EstimatesResponse['meta'] | null>(null);
  const [stats, setStats] = useState<Stats>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [page, setPage] = useState(1);

  const fetchData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [lRes, sRes] = await Promise.all([
        fetch(`${API_BASE}/api/v1/estimates?page=${page}&per_page=15`, { headers: { Authorization: `Bearer ${getToken()}` } }),
        fetch(`${API_BASE}/api/v1/estimates/stats`, { headers: { Authorization: `Bearer ${getToken()}` } }),
      ]);
      if (!lRes.ok) throw new Error(`Failed (${lRes.status})`);
      const list = await lRes.json();
      setItems(list.data ?? []);
      setMeta(list.meta ?? null);
      if (sRes.ok) setStats(await sRes.json());
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
        <h1 className="text-2xl font-bold text-gray-900">Estimates</h1>
        <Link href="/estimates/new" className="inline-flex items-center gap-1.5 bg-primary text-white text-sm font-medium px-4 py-2 rounded-lg hover:bg-primary/90">
          <span className="text-lg leading-none">+</span>New Estimate
        </Link>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mb-6">
        <StatCard label="Draft" value={stats.draft ?? 0} />
        <StatCard label="Sent" value={stats.sent ?? 0} />
        <StatCard label="Accepted" value={stats.accepted ?? 0} />
        <StatCard label="Declined" value={stats.declined ?? 0} />
      </div>

      <div className="bg-white rounded-xl border border-gray-100 shadow-sm overflow-hidden">
        {error && (
          <div className="px-4 py-3 bg-red-50 border-b border-red-100 text-sm text-red-600">{error}</div>
        )}

        <div className="overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead>
              <tr className="bg-gray-50 border-b border-gray-100 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide">
                <th className="px-4 py-3">Number</th>
                <th className="px-4 py-3">Client</th>
                <th className="px-4 py-3">Date</th>
                <th className="px-4 py-3">Total</th>
                <th className="px-4 py-3">Status</th>
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
                <tr><td colSpan={6} className="px-4 py-12 text-center text-sm text-gray-400">No estimates yet</td></tr>
              ) : items.map((est) => (
                <tr key={est.id} className="border-b border-gray-100 hover:bg-gray-50/60">
                  <td className="px-4 py-3 font-medium text-gray-900">{est.number}</td>
                  <td className="px-4 py-3 text-gray-600">{est.client?.company ?? est.client?.company_name ?? '—'}</td>
                  <td className="px-4 py-3 text-gray-600">{est.date ? new Date(est.date).toLocaleDateString() : '—'}</td>
                  <td className="px-4 py-3 tabular-nums">{est.total?.toFixed?.(2) ?? est.total} {est.currency}</td>
                  <td className="px-4 py-3">
                    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${STATUS_COLORS[est.status] ?? 'bg-gray-100 text-gray-700'}`}>
                      {est.status}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-right">
                    <Link href={`/estimates/${est.id}`} className="text-xs text-gray-500 hover:text-primary font-medium">View</Link>
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

function StatCard({ label, value }: { label: string; value: number }) {
  return (
    <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-4">
      <p className="text-xs text-gray-500 uppercase tracking-wide">{label}</p>
      <p className="text-2xl font-bold text-gray-900 mt-1">{value}</p>
    </div>
  );
}
