'use client';

import { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import { Repeat } from 'lucide-react';
import { ListPageLayout } from '@/components/layouts/list-page-layout';
import { Card } from '@/components/ui/card';
import { StatusBadge } from '@/components/ui/status-badge';
import { TableSkeleton } from '@/components/ui/table-skeleton';
import { EmptyState } from '@/components/ui/empty-state';
import { ErrorBanner } from '@/components/ui/error-banner';
import { exportCsv } from '@/lib/export-csv';

type Status = 'all' | 'active' | 'paused' | 'cancelled';

interface Subscription {
  id: string;
  name: string;
  unitPrice: number;
  quantity: number;
  total: number | null;
  currency: string;
  status: string;
  nextDueDate: string | null;
  nextInvoiceAt?: string | null;
  interval?: string | null;
  intervalCount?: number | null;
  client?: { id: string; company: string } | null;
}

function formatFrequency(s: Subscription): string {
  const interval = s.interval ?? 'month';
  const count = s.intervalCount ?? 1;
  const noun = count > 1 ? `${interval}s` : interval;
  return `Every ${count} ${noun}`;
}

interface Response {
  data: Subscription[];
  meta?: { total: number };
}

const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001';

function authHeaders(): HeadersInit {
  const token = typeof window === 'undefined' ? null : localStorage.getItem('access_token');
  return { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
}

export default function SubscriptionsPage() {
  const [status, setStatus] = useState<Status>('all');
  const [items, setItems] = useState<Subscription[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchItems = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      if (status !== 'all') params.set('status', status);
      const res = await fetch(`${API_BASE}/api/v1/subscriptions?${params.toString()}`, {
        headers: authHeaders(),
      });
      if (!res.ok) throw new Error(`Server responded with ${res.status}`);
      const json: Response = await res.json();
      setItems(json.data ?? (Array.isArray(json) ? json : []));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed');
    } finally {
      setLoading(false);
    }
  }, [status]);

  useEffect(() => {
    fetchItems();
  }, [fetchItems]);

  const tabs: { key: Status; label: string }[] = [
    { key: 'all', label: 'All' },
    { key: 'active', label: 'Active' },
    { key: 'paused', label: 'Paused' },
    { key: 'cancelled', label: 'Cancelled' },
  ];

  const filtersNode = (
    <div className="border-b border-gray-200 dark:border-gray-700">
      <nav className="flex gap-1 -mb-px" role="tablist" aria-label="Subscription status filter">
        {tabs.map((t) => (
          <button
            key={t.key}
            onClick={() => setStatus(t.key)}
            role="tab"
            aria-selected={status === t.key}
            className={`px-4 py-2.5 text-sm font-medium border-b-2 transition-colors ${
              status === t.key ? 'border-primary text-primary' : 'border-transparent text-gray-500 hover:text-gray-700'
            }`}
          >
            {t.label}
          </button>
        ))}
      </nav>
    </div>
  );

  return (
    <ListPageLayout
      title="Subscriptions"
      secondaryActions={[
        {
          label: 'Export CSV',
          onClick: () => {
            const params = new URLSearchParams();
            if (status !== 'all') params.set('status', status);
            const qs = params.toString();
            void exportCsv(
              `/api/v1/subscriptions/export${qs ? `?${qs}` : ''}`,
              `subscriptions-${new Date().toISOString().slice(0, 10)}.csv`,
              { entityLabel: 'subscriptions' },
            );
          },
        },
      ]}
      primaryAction={{ label: 'New Subscription', href: '/subscriptions/new', icon: <span className="text-lg leading-none">+</span> }}
      filters={filtersNode}
    >
      <Card>
        {error && (
          <ErrorBanner message={error} onRetry={fetchItems} className="rounded-none border-0 border-b border-red-100" />
        )}
        <div className="overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead>
              <tr className="bg-gray-50 dark:bg-gray-900 border-b border-gray-100 dark:border-gray-800 text-left text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide">
                <th className="px-4 py-3">Name</th>
                <th className="px-4 py-3">Client</th>
                <th className="px-4 py-3 text-right">Total</th>
                <th className="px-4 py-3">Frequency</th>
                <th className="px-4 py-3">Next Due</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3 text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <TableSkeleton rows={6} columns={7} columnWidths={['40%', '40%', '30%', '30%', '30%', '25%', '20%']} />
              ) : items.length === 0 ? (
                <tr>
                  <td colSpan={7} className="px-4 py-8">
                    <EmptyState
                      icon={<Repeat className="w-10 h-10" />}
                      title="No subscriptions found"
                      action={{ label: 'Create a subscription', href: '/subscriptions/new' }}
                    />
                  </td>
                </tr>
              ) : (
                items.map((s) => (
                  <tr key={s.id} className="border-b border-gray-100 dark:border-gray-800 last:border-0 hover:bg-gray-50/60">
                    <td className="px-4 py-3 font-medium text-gray-900 dark:text-gray-100">
                      <Link href={`/subscriptions/${s.id}`} className="text-primary hover:underline">{s.name}</Link>
                    </td>
                    <td className="px-4 py-3 text-gray-500 dark:text-gray-400">{s.client?.company ?? '—'}</td>
                    <td className="px-4 py-3 text-right font-medium text-gray-900 dark:text-gray-100">
                      {Number(s.total ?? s.unitPrice * s.quantity).toFixed(2)} {s.currency}
                    </td>
                    <td className="px-4 py-3 text-gray-500 dark:text-gray-400">{formatFrequency(s)}</td>
                    <td className="px-4 py-3 text-gray-500 dark:text-gray-400">
                      {(s.nextInvoiceAt ?? s.nextDueDate) ? new Date((s.nextInvoiceAt ?? s.nextDueDate) as string).toLocaleDateString() : '—'}
                    </td>
                    <td className="px-4 py-3"><StatusBadge status={s.status} /></td>
                    <td className="px-4 py-3 text-right">
                      <Link href={`/subscriptions/${s.id}`} className="text-xs text-gray-500 dark:text-gray-400 hover:text-primary">View</Link>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </Card>
    </ListPageLayout>
  );
}
