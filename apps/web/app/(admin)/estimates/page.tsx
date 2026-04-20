'use client';

import { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import { FileText } from 'lucide-react';
import { ListPageLayout } from '@/components/layouts/list-page-layout';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { StatusBadge } from '@/components/ui/status-badge';
import { TableSkeleton } from '@/components/ui/table-skeleton';
import { EmptyState } from '@/components/ui/empty-state';
import { ErrorBanner } from '@/components/ui/error-banner';
import { typography } from '@/lib/ui-tokens';

interface Estimate {
  id: string;
  number: string;
  date: string;
  total: number;
  currency: string;
  status: string;
  client?: { id: string; company: string } | null;
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

export default function EstimatesPage() {
  const [items, setItems] = useState<Estimate[]>([]);
  const [meta, setMeta] = useState<{ totalPages: number; total: number } | null>(null);
  const [stats, setStats] = useState<Stats>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [page, setPage] = useState(1);

  const fetchData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [lRes, sRes] = await Promise.all([
        fetch(`${API_BASE}/api/v1/estimates?page=${page}&limit=15`, { headers: { Authorization: `Bearer ${getToken()}` } }),
        fetch(`${API_BASE}/api/v1/estimates/stats`, { headers: { Authorization: `Bearer ${getToken()}` } }),
      ]);
      if (!lRes.ok) throw new Error(`Failed (${lRes.status})`);
      const list = await lRes.json();
      setItems(list.data ?? []);
      setMeta({ totalPages: list.totalPages, total: list.total });
      if (sRes.ok) setStats(await sRes.json());
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed');
    } finally {
      setLoading(false);
    }
  }, [page]);

  useEffect(() => { fetchData(); }, [fetchData]);

  const paginationNode =
    meta && meta.total > 0 ? (
      <div className="flex items-center justify-between px-4 py-3 border border-gray-100 dark:border-gray-800 rounded-xl bg-gray-50/50 dark:bg-gray-800/50">
        <p className="text-xs text-gray-500 dark:text-gray-400">{meta.total} total</p>
        <div className="flex items-center gap-2">
          <Button variant="secondary" size="sm" onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={page <= 1}>Previous</Button>
          <span className="text-xs text-gray-600 dark:text-gray-400">Page {page} of {meta.totalPages}</span>
          <Button variant="secondary" size="sm" onClick={() => setPage((p) => Math.min(meta.totalPages, p + 1))} disabled={page >= meta.totalPages}>Next</Button>
        </div>
      </div>
    ) : null;

  return (
    <ListPageLayout
      title="Estimates"
      secondaryActions={[{ label: 'Pipeline view', href: '/estimates/pipeline' }]}
      primaryAction={{ label: 'New Estimate', href: '/estimates/new', icon: <span className="text-lg leading-none">+</span> }}
      pagination={paginationNode}
    >
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mb-6">
        <StatCard label="Draft" value={stats.draft ?? 0} />
        <StatCard label="Sent" value={stats.sent ?? 0} />
        <StatCard label="Accepted" value={stats.accepted ?? 0} />
        <StatCard label="Declined" value={stats.declined ?? 0} />
      </div>

      <Card>
        {error && (
          <ErrorBanner message={error} onRetry={fetchData} className="rounded-none border-0 border-b border-red-100" />
        )}

        <div className="overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead>
              <tr className="bg-gray-50 dark:bg-gray-900 border-b border-gray-100 dark:border-gray-800 text-left text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide">
                <th className="px-4 py-3">Number</th>
                <th className="px-4 py-3">Client</th>
                <th className="px-4 py-3 hidden lg:table-cell">Date</th>
                <th className="px-4 py-3">Total</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3 text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <TableSkeleton rows={6} columns={6} columnWidths={['40%', '50%', '30%', '30%', '25%', '20%']} />
              ) : items.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-4 py-8">
                    <EmptyState
                      icon={<FileText className="w-10 h-10" />}
                      title="No estimates yet"
                      action={{ label: 'Create your first estimate', href: '/estimates/new' }}
                    />
                  </td>
                </tr>
              ) : items.map((est) => (
                <tr key={est.id} className="border-b border-gray-100 dark:border-gray-800 hover:bg-gray-50/60">
                  <td className="px-4 py-3 font-medium text-gray-900 dark:text-gray-100">{est.number}</td>
                  <td className="px-4 py-3 text-gray-600 dark:text-gray-400">{est.client?.company ?? '—'}</td>
                  <td className="px-4 py-3 text-gray-600 dark:text-gray-400 hidden lg:table-cell">{est.date ? new Date(est.date).toLocaleDateString() : '—'}</td>
                  <td className="px-4 py-3 tabular-nums">{est.total?.toFixed?.(2) ?? est.total} {est.currency}</td>
                  <td className="px-4 py-3">
                    <StatusBadge status={est.status} />
                  </td>
                  <td className="px-4 py-3 text-right">
                    <Link href={`/estimates/${est.id}`} className="text-xs text-gray-500 dark:text-gray-400 hover:text-primary font-medium">View</Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </ListPageLayout>
  );
}

function StatCard({ label, value }: { label: string; value: number }) {
  return (
    <Card padding="md">
      <p className="text-xs text-gray-500 dark:text-gray-400 uppercase tracking-wide">{label}</p>
      <p className={`${typography.h2} mt-1`}>{value}</p>
    </Card>
  );
}
