'use client';

import { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import { apiFetch } from '@/lib/api';
import { ListPageLayout } from '@/components/layouts/list-page-layout';
import { Card } from '@/components/ui/card';
import { StatusBadge } from '@/components/ui/status-badge';
import { TableSkeleton } from '@/components/ui/table-skeleton';
import { ErrorBanner } from '@/components/ui/error-banner';
import { EmptyState } from '@/components/ui/empty-state';
import { Button } from '@/components/ui/button';

type InvoiceStatus =
  | 'draft'
  | 'sent'
  | 'partial'
  | 'paid'
  | 'overdue'
  | 'cancelled';

interface RecurringInvoice {
  id: string;
  number: string;
  client?: { id: string; company: string } | null;
  total: number | string;
  currency: string;
  status: InvoiceStatus;
  isRecurring: boolean;
  recurringEvery?: number | null;
  recurringType?: string | null;
  totalCycles?: number | null;
  totalCyclesCompleted?: number;
  lastRecurringDate?: string | null;
  nextRecurringDate?: string | null;
}

interface ListResponse {
  data: RecurringInvoice[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

function formatCurrency(amount: number | string, currency: string): string {
  const n = typeof amount === 'string' ? Number(amount) : amount;
  try {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency,
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(Number.isFinite(n) ? n : 0);
  } catch {
    return `${currency} ${(Number.isFinite(n) ? n : 0).toFixed(2)}`;
  }
}

function formatDate(iso?: string | null): string {
  if (!iso) return '—';
  try {
    return new Intl.DateTimeFormat('en-GB', {
      day: '2-digit',
      month: 'short',
      year: 'numeric',
    }).format(new Date(iso));
  } catch {
    return iso;
  }
}

function formatFrequency(
  every?: number | null,
  type?: string | null,
): string {
  if (!type) return '—';
  const n = every ?? 1;
  const base = type.toLowerCase().replace(/ly$/, '');
  const unit = ['day', 'week', 'month', 'year', 'quarter'].includes(base)
    ? base
    : type;
  return `Every ${n} ${unit}${n !== 1 ? 's' : ''}`;
}

export default function RecurringInvoicesPage() {
  const [page, setPage] = useState(1);
  const [invoices, setInvoices] = useState<RecurringInvoice[]>([]);
  const [meta, setMeta] = useState<{ totalPages: number; total: number } | null>(
    null,
  );
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const fetchInvoices = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({
        recurring: 'true',
        sortBy: 'nextRecurringDate',
        page: String(page),
        limit: '15',
      });
      const res = await apiFetch(`/api/v1/invoices?${params.toString()}`);
      if (!res.ok) throw new Error(`Server responded with ${res.status}`);
      const json: ListResponse = await res.json();
      setInvoices(json.data ?? []);
      setMeta({ totalPages: json.totalPages, total: json.total });
    } catch (err) {
      setError(
        err instanceof Error ? err.message : 'Failed to load recurring invoices',
      );
      setInvoices([]);
    } finally {
      setLoading(false);
    }
  }, [page]);

  useEffect(() => {
    fetchInvoices();
  }, [fetchInvoices]);

  async function handleStop(invoiceId: string) {
    if (
      !confirm(
        'Stop recurring for this invoice? No further occurrences will be generated.',
      )
    ) {
      return;
    }
    setActionLoading(invoiceId);
    setMessage(null);
    try {
      const res = await apiFetch(
        `/api/v1/invoices/${invoiceId}/recurring/stop`,
        { method: 'POST' },
      );
      if (!res.ok) throw new Error(`Failed (${res.status})`);
      setMessage('Recurrence stopped');
      await fetchInvoices();
    } catch (err) {
      setMessage(
        err instanceof Error ? err.message : 'Failed to stop recurrence',
      );
    } finally {
      setActionLoading(null);
    }
  }

  async function handleGenerateNow(invoiceId: string) {
    if (!confirm('Generate the next occurrence now?')) return;
    setActionLoading(invoiceId);
    setMessage(null);
    try {
      const res = await apiFetch(
        `/api/v1/invoices/${invoiceId}/recurring/run`,
        { method: 'POST' },
      );
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        throw new Error(body?.message ?? `Failed (${res.status})`);
      }
      setMessage('New occurrence generated');
      await fetchInvoices();
    } catch (err) {
      setMessage(
        err instanceof Error ? err.message : 'Failed to generate occurrence',
      );
    } finally {
      setActionLoading(null);
    }
  }

  const totalPages = meta?.totalPages ?? 1;

  const paginationNode =
    !loading && meta && meta.total > 0 ? (
      <div className="flex items-center justify-between px-4 py-3 border border-gray-100 dark:border-gray-800 rounded-xl bg-gray-50/50 dark:bg-gray-800/50">
        <p className="text-xs text-gray-500 dark:text-gray-400">
          {meta.total} recurring invoice{meta.total !== 1 ? 's' : ''}
        </p>
        <div className="flex items-center gap-2">
          <Button variant="secondary" size="sm" onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={page <= 1}>Previous</Button>
          <span className="text-xs text-gray-600 dark:text-gray-400 min-w-[80px] text-center">
            Page {page} of {totalPages}
          </span>
          <Button variant="secondary" size="sm" onClick={() => setPage((p) => Math.min(totalPages, p + 1))} disabled={page >= totalPages}>Next</Button>
        </div>
      </div>
    ) : null;

  return (
    <ListPageLayout
      title="Recurring Invoices"
      subtitle="Invoices configured to regenerate automatically on a schedule"
      pagination={paginationNode}
    >
      <div className="mb-3">
        <Link
          href="/invoices"
          className="text-sm text-gray-500 dark:text-gray-400 hover:text-primary"
        >
          &larr; All invoices
        </Link>
      </div>

      {message && (
        <div className="mb-4 px-3 py-2 bg-blue-50 border border-blue-100 text-sm text-blue-700 rounded">
          {message}
        </div>
      )}

      {error && (
        <div className="mb-4">
          <ErrorBanner message={error} onRetry={fetchInvoices} />
        </div>
      )}

      {/* Desktop table */}
      <Card className="hidden md:block">
        <div className="overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead>
              <tr className="bg-gray-50 dark:bg-gray-900 border-b border-gray-100 dark:border-gray-800 text-left text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide">
                <th className="px-4 py-3">Number</th>
                <th className="px-4 py-3">Client</th>
                <th className="px-4 py-3 text-right">Amount</th>
                <th className="px-4 py-3">Frequency</th>
                <th className="px-4 py-3">Last sent</th>
                <th className="px-4 py-3">Next due</th>
                <th className="px-4 py-3">Cycles</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3 text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <TableSkeleton rows={6} columns={9} />
              ) : invoices.length === 0 ? (
                <tr>
                  <td colSpan={9}>
                    <EmptyState
                      title="No recurring invoices"
                      description="Mark an invoice as recurring when creating or editing it"
                    />
                  </td>
                </tr>
              ) : (
                invoices.map((inv) => {
                  const completed = inv.totalCyclesCompleted ?? 0;
                  const total = inv.totalCycles;
                  const cyclesLabel =
                    total != null ? `${completed} / ${total}` : `${completed} / ∞`;
                  return (
                    <tr
                      key={inv.id}
                      className="border-b border-gray-100 dark:border-gray-800 last:border-0 hover:bg-gray-50/60 transition-colors"
                    >
                      <td className="px-4 py-3 font-medium text-gray-900 dark:text-gray-100 whitespace-nowrap">
                        <Link
                          href={`/invoices/${inv.id}`}
                          className="hover:text-primary transition-colors"
                        >
                          {inv.number}
                        </Link>
                      </td>
                      <td className="px-4 py-3 text-gray-600 dark:text-gray-400 max-w-[160px] truncate">
                        {inv.client?.company ?? '—'}
                      </td>
                      <td className="px-4 py-3 text-right font-semibold text-gray-800 dark:text-gray-200 whitespace-nowrap">
                        {formatCurrency(inv.total, inv.currency)}
                      </td>
                      <td className="px-4 py-3 text-gray-600 dark:text-gray-400 whitespace-nowrap">
                        {formatFrequency(inv.recurringEvery, inv.recurringType)}
                      </td>
                      <td className="px-4 py-3 text-gray-500 dark:text-gray-400 whitespace-nowrap">
                        {formatDate(inv.lastRecurringDate)}
                      </td>
                      <td className="px-4 py-3 text-gray-500 dark:text-gray-400 whitespace-nowrap">
                        {formatDate(inv.nextRecurringDate)}
                      </td>
                      <td className="px-4 py-3 text-gray-500 dark:text-gray-400 tabular-nums whitespace-nowrap">
                        {cyclesLabel}
                      </td>
                      <td className="px-4 py-3">
                        <StatusBadge status={inv.status} />
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex items-center justify-end gap-3">
                          <Link
                            href={`/invoices/${inv.id}`}
                            className="text-xs text-gray-500 dark:text-gray-400 hover:text-primary font-medium transition-colors"
                          >
                            View
                          </Link>
                          <button
                            onClick={() => handleGenerateNow(inv.id)}
                            disabled={actionLoading === inv.id}
                            className="text-xs text-primary hover:underline font-medium disabled:opacity-30 disabled:cursor-not-allowed"
                          >
                            {actionLoading === inv.id ? 'Working…' : 'Generate now'}
                          </button>
                          <button
                            onClick={() => handleStop(inv.id)}
                            disabled={actionLoading === inv.id}
                            className="text-xs text-red-500 hover:underline font-medium disabled:opacity-30 disabled:cursor-not-allowed"
                          >
                            Stop recurring
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>

      </Card>

      {/* Mobile card view */}
      <div className="md:hidden space-y-3 mt-4">
        {loading ? (
          Array.from({ length: 4 }).map((_, i) => (
            <Card key={i} padding="md" className="animate-pulse">
              <div className="h-4 bg-gray-100 dark:bg-gray-800 rounded w-1/2 mb-2" />
              <div className="h-3 bg-gray-100 dark:bg-gray-800 rounded w-3/4" />
            </Card>
          ))
        ) : invoices.length === 0 ? (
          <div className="text-center py-12 text-gray-400 dark:text-gray-500 text-sm">
            No recurring invoices
          </div>
        ) : (
          invoices.map((inv) => {
            const completed = inv.totalCyclesCompleted ?? 0;
            const total = inv.totalCycles;
            const cyclesLabel =
              total != null ? `${completed} / ${total}` : `${completed} / ∞`;
            return (
              <Card key={inv.id} padding="md">
                <div className="flex items-start justify-between gap-2 mb-2">
                  <div className="min-w-0">
                    <Link
                      href={`/invoices/${inv.id}`}
                      className="font-medium text-gray-900 dark:text-gray-100 hover:text-primary"
                    >
                      {inv.number}
                    </Link>
                    <p className="text-xs text-gray-500 dark:text-gray-400 truncate">
                      {inv.client?.company ?? '—'}
                    </p>
                  </div>
                  <StatusBadge status={inv.status} />
                </div>
                <dl className="grid grid-cols-2 gap-x-3 gap-y-1 text-xs text-gray-600 dark:text-gray-400">
                  <dt className="text-gray-400 dark:text-gray-500">Amount</dt>
                  <dd className="font-medium text-right">
                    {formatCurrency(inv.total, inv.currency)}
                  </dd>
                  <dt className="text-gray-400 dark:text-gray-500">Frequency</dt>
                  <dd className="text-right">
                    {formatFrequency(inv.recurringEvery, inv.recurringType)}
                  </dd>
                  <dt className="text-gray-400 dark:text-gray-500">Last sent</dt>
                  <dd className="text-right">
                    {formatDate(inv.lastRecurringDate)}
                  </dd>
                  <dt className="text-gray-400 dark:text-gray-500">Next due</dt>
                  <dd className="text-right">
                    {formatDate(inv.nextRecurringDate)}
                  </dd>
                  <dt className="text-gray-400 dark:text-gray-500">Cycles</dt>
                  <dd className="text-right tabular-nums">{cyclesLabel}</dd>
                </dl>
                <div className="mt-3 flex items-center gap-3 text-xs">
                  <Link
                    href={`/invoices/${inv.id}`}
                    className="text-gray-500 dark:text-gray-400 hover:text-primary font-medium"
                  >
                    View
                  </Link>
                  <button
                    onClick={() => handleGenerateNow(inv.id)}
                    disabled={actionLoading === inv.id}
                    className="text-primary hover:underline font-medium disabled:opacity-30"
                  >
                    {actionLoading === inv.id ? 'Working…' : 'Generate now'}
                  </button>
                  <button
                    onClick={() => handleStop(inv.id)}
                    disabled={actionLoading === inv.id}
                    className="text-red-500 hover:underline font-medium disabled:opacity-30"
                  >
                    Stop recurring
                  </button>
                </div>
              </Card>
            );
          })
        )}
      </div>
    </ListPageLayout>
  );
}
