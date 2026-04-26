'use client';

import { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import { ListPageLayout } from '@/components/layouts/list-page-layout';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { TableSkeleton } from '@/components/ui/table-skeleton';
import { ErrorBanner } from '@/components/ui/error-banner';
import { Button } from '@/components/ui/button';
import { exportCsv } from '@/lib/export-csv';

interface Contract {
  id: string;
  subject: string;
  type: string;
  status: string;
  value: number;
  startDate: string;
  endDate: string;
  client?: { id: string; company: string } | null;
}

interface Response {
  data: Contract[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001';

function getToken(): string | null {
  if (typeof window === 'undefined') return null;
  return localStorage.getItem('access_token');
}

const STATUS_VARIANTS: Record<string, 'default' | 'warning' | 'success' | 'error'> = {
  draft: 'default',
  pending_signature: 'warning',
  signed: 'success',
  expired: 'error',
  terminated: 'error',
};

export default function ContractsPage() {
  const [items, setItems] = useState<Contract[]>([]);
  const [meta, setMeta] = useState<{ totalPages: number; total: number } | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [page, setPage] = useState(1);

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`${API_BASE}/api/v1/contracts?page=${page}&limit=15`, { headers: { Authorization: `Bearer ${getToken()}` } });
      if (!res.ok) throw new Error(`Failed (${res.status})`);
      const json = await res.json();
      setItems(json.data ?? []);
      setMeta({ totalPages: json.totalPages, total: json.total });
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
      title="Contracts"
      secondaryActions={[
        {
          label: 'Export CSV',
          onClick: () =>
            void exportCsv(
              '/api/v1/contracts/export',
              `contracts-${new Date().toISOString().slice(0, 10)}.csv`,
              { entityLabel: 'contracts' },
            ),
        },
      ]}
      primaryAction={{ label: 'New Contract', href: '/contracts/new' }}
      pagination={paginationNode}
    >
      {error && (
        <div className="mb-4">
          <ErrorBanner message={error} onRetry={fetchData} />
        </div>
      )}

      <Card>
        <div className="overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead>
              <tr className="bg-gray-50 dark:bg-gray-900 border-b border-gray-100 dark:border-gray-800 text-left text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase">
                <th className="px-4 py-3">Subject</th>
                <th className="px-4 py-3">Client</th>
                <th className="px-4 py-3">Type</th>
                <th className="px-4 py-3">Value</th>
                <th className="px-4 py-3 hidden lg:table-cell">Period</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3 text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <TableSkeleton rows={6} columns={7} />
              ) : items.length === 0 ? (
                <tr><td colSpan={7} className="px-4 py-12 text-center text-sm text-gray-400 dark:text-gray-500">No contracts yet</td></tr>
              ) : items.map((c) => (
                <tr key={c.id} className="border-b border-gray-100 dark:border-gray-800 hover:bg-gray-50/60">
                  <td className="px-4 py-3 font-medium text-gray-900 dark:text-gray-100">{c.subject}</td>
                  <td className="px-4 py-3 text-gray-600 dark:text-gray-400">{c.client?.company ?? '—'}</td>
                  <td className="px-4 py-3 text-gray-600 dark:text-gray-400">{c.type}</td>
                  <td className="px-4 py-3 tabular-nums">{c.value}</td>
                  <td className="px-4 py-3 text-gray-500 dark:text-gray-400 text-xs hidden lg:table-cell">
                    {c.startDate ? new Date(c.startDate).toLocaleDateString() : '—'}
                    {' → '}
                    {c.endDate ? new Date(c.endDate).toLocaleDateString() : '—'}
                  </td>
                  <td className="px-4 py-3">
                    <Badge variant={STATUS_VARIANTS[c.status] ?? 'default'}>
                      {c.status}
                    </Badge>
                  </td>
                  <td className="px-4 py-3 text-right">
                    <Link href={`/contracts/${c.id}`} className="text-xs text-gray-500 dark:text-gray-400 hover:text-primary font-medium">View</Link>
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
