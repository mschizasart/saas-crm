'use client';

import { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { FileText } from 'lucide-react';
import { toast } from 'sonner';
import { ListPageLayout } from '@/components/layouts/list-page-layout';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { TableSkeleton } from '@/components/ui/table-skeleton';
import { EmptyState } from '@/components/ui/empty-state';
import { ErrorBanner } from '@/components/ui/error-banner';
import { useModalA11y } from '@/components/ui/use-modal-a11y';
import { apiFetch } from '@/lib/api';
import { exportCsv } from '@/lib/export-csv';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type InvoiceStatus = 'draft' | 'sent' | 'partial' | 'paid' | 'overdue' | 'cancelled';

interface Invoice {
  id: string;
  number: string;
  client?: { id: string; company: string };
  date: string;        // ISO date string
  dueDate: string;     // ISO date string
  total: number;
  currency: string;
  status: InvoiceStatus;
}

interface InvoicesResponse {
  data: Invoice[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

interface InvoiceStats {
  outstanding: number;
  overdue: number;
  paid_this_month: number;
  currency: string;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001';

const STATUS_TABS: { value: InvoiceStatus | 'all'; label: string }[] = [
  { value: 'all',       label: 'All' },
  { value: 'draft',     label: 'Draft' },
  { value: 'sent',      label: 'Sent' },
  { value: 'partial',   label: 'Partial' },
  { value: 'paid',      label: 'Paid' },
  { value: 'overdue',   label: 'Overdue' },
];

const INVOICE_STATUS_VARIANT: Record<InvoiceStatus, 'default' | 'info' | 'warning' | 'success' | 'error' | 'muted'> = {
  draft: 'default',
  sent: 'info',
  partial: 'warning',
  paid: 'success',
  overdue: 'error',
  cancelled: 'muted',
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function getToken(): string | null {
  if (typeof window === 'undefined') return null;
  return localStorage.getItem('access_token');
}

function formatCurrency(amount: number, currency: string): string {
  try {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency,
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(amount);
  } catch {
    return `${currency} ${amount.toFixed(2)}`;
  }
}

function formatDate(iso: string): string {
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

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function StatusBadge({ status }: { status: InvoiceStatus }) {
  return (
    <Badge variant={INVOICE_STATUS_VARIANT[status]}>
      {capitalize(status)}
    </Badge>
  );
}

function StatCard({
  label,
  value,
  colorClass,
}: {
  label: string;
  value: string;
  colorClass: string;
}) {
  return (
    <Card padding="lg">
      <p className="text-xs font-semibold text-gray-400 dark:text-gray-500 uppercase tracking-wide mb-1">{label}</p>
      <p className={`text-xl font-bold ${colorClass}`}>{value}</p>
    </Card>
  );
}

function StatCardSkeleton() {
  return (
    <Card padding="lg" className="animate-pulse">
      <div className="h-3 bg-gray-100 dark:bg-gray-800 rounded w-1/2 mb-2" />
      <div className="h-6 bg-gray-100 dark:bg-gray-800 rounded w-3/4" />
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Action button
// ---------------------------------------------------------------------------

function ActionButton({
  onClick,
  disabled,
  children,
}: {
  onClick?: () => void;
  disabled?: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className="text-xs text-gray-500 dark:text-gray-400 hover:text-primary font-medium transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
    >
      {children}
    </button>
  );
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default function InvoicesPage() {
  const router = useRouter();
  const [activeTab, setActiveTab] = useState<InvoiceStatus | 'all'>('all');
  const [page, setPage] = useState(1);
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [meta, setMeta] = useState<{ totalPages: number; total: number } | null>(null);
  const [stats, setStats] = useState<InvoiceStats | null>(null);
  const [loadingList, setLoadingList] = useState(true);
  const [loadingStats, setLoadingStats] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [actionLoading, setActionLoading] = useState<string | null>(null); // invoice id
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulkLoading, setBulkLoading] = useState(false);
  const [statusMenuOpen, setStatusMenuOpen] = useState(false);
  const [pendingStatus, setPendingStatus] = useState<InvoiceStatus | null>(null);
  const closeStatusModal = useCallback(() => setPendingStatus(null), []);
  const statusModalRef = useModalA11y(pendingStatus !== null, closeStatusModal);

  // Reset page when filter changes
  useEffect(() => {
    setPage(1);
  }, [activeTab]);

  // ------------------------------------------------------------------
  // Fetch stats (once on mount)
  // ------------------------------------------------------------------

  useEffect(() => {
    async function fetchStats() {
      setLoadingStats(true);
      try {
        const token = getToken();
        const res = await fetch(`${API_BASE}/api/v1/invoices/stats`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (!res.ok) throw new Error(`Stats: ${res.status}`);
        const json: InvoiceStats = await res.json();
        setStats(json);
      } catch {
        // Stats are non-critical — silently ignore
      } finally {
        setLoadingStats(false);
      }
    }
    fetchStats();
  }, []);

  // ------------------------------------------------------------------
  // Fetch invoice list
  // ------------------------------------------------------------------

  const fetchInvoices = useCallback(async () => {
    setLoadingList(true);
    setError(null);
    try {
      const token = getToken();
      const params = new URLSearchParams({ page: String(page), limit: '15' });
      if (activeTab !== 'all') params.set('status', activeTab);

      const res = await fetch(`${API_BASE}/api/v1/invoices?${params.toString()}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) throw new Error(`Server responded with ${res.status}`);

      const json: InvoicesResponse = await res.json();
      setInvoices(json.data ?? []);
      setMeta({ totalPages: json.totalPages, total: json.total });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load invoices');
      setInvoices([]);
    } finally {
      setLoadingList(false);
    }
  }, [activeTab, page]);

  useEffect(() => {
    fetchInvoices();
  }, [fetchInvoices]);

  // ------------------------------------------------------------------
  // Actions
  // ------------------------------------------------------------------

  async function handleSend(invoiceId: string) {
    setActionLoading(invoiceId);
    try {
      const token = getToken();
      await fetch(`${API_BASE}/api/v1/invoices/${invoiceId}/send`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
      });
      await fetchInvoices();
    } finally {
      setActionLoading(null);
    }
  }

  async function handleMarkPaid(invoiceId: string) {
    setActionLoading(invoiceId);
    try {
      const token = getToken();
      await fetch(`${API_BASE}/api/v1/invoices/${invoiceId}/mark-paid`, {
        method: 'PATCH',
        headers: { Authorization: `Bearer ${token}` },
      });
      await fetchInvoices();
    } finally {
      setActionLoading(null);
    }
  }

  const totalPages = meta?.totalPages ?? 1;
  const statCurrency = stats?.currency ?? 'USD';

  const toggleSelect = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleAll = () => {
    if (selected.size === invoices.length) {
      setSelected(new Set());
    } else {
      setSelected(new Set(invoices.map((inv) => inv.id)));
    }
  };

  const bulkDeleteDraft = async () => {
    const drafts = invoices.filter((i) => selected.has(i.id) && i.status === 'draft');
    if (drafts.length === 0) { alert('Only draft invoices can be bulk deleted.'); return; }
    if (!confirm(`Delete ${drafts.length} draft invoice(s)?`)) return;
    setBulkLoading(true);
    const token = getToken();
    for (const inv of drafts) {
      await fetch(`${API_BASE}/api/v1/invoices/${inv.id}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` },
      }).catch(() => {});
    }
    setSelected(new Set());
    setBulkLoading(false);
    fetchInvoices();
  };

  const bulkMarkSent = async () => {
    setBulkLoading(true);
    const token = getToken();
    for (const id of selected) {
      await fetch(`${API_BASE}/api/v1/invoices/${id}/send`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
      }).catch(() => {});
    }
    setSelected(new Set());
    setBulkLoading(false);
    fetchInvoices();
  };

  const bulkExport = () => {
    const token = getToken();
    const ids = Array.from(selected).join(',');
    window.open(`${API_BASE}/api/v1/exports/invoices?format=xlsx&ids=${ids}&token=${token}`, '_blank');
  };

  const bulkMerge = async () => {
    const picks = invoices.filter((i) => selected.has(i.id));
    if (picks.length < 2) { alert('Select at least two invoices.'); return; }
    const clientIds = new Set(picks.map((p) => p.client?.id).filter(Boolean));
    const currencies = new Set(picks.map((p) => p.currency));
    const nonDraft = picks.filter((p) => p.status !== 'draft');
    if (clientIds.size !== 1) { alert('All selected invoices must share the same client.'); return; }
    if (currencies.size !== 1) { alert('All selected invoices must share the same currency.'); return; }
    if (nonDraft.length > 0) { alert('All selected invoices must be in draft status.'); return; }
    if (!confirm(`Merge ${picks.length} draft invoice(s) into a single new draft?`)) return;
    setBulkLoading(true);
    try {
      const token = getToken();
      const res = await fetch(`${API_BASE}/api/v1/invoices/merge`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ invoiceIds: picks.map((p) => p.id) }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body?.message ?? `Merge failed (${res.status})`);
      }
      const merged = await res.json();
      setSelected(new Set());
      router.push(`/invoices/${merged.id}`);
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Merge failed');
    } finally {
      setBulkLoading(false);
    }
  };

  const bulkPdfExport = async () => {
    if (selected.size === 0) return;
    setBulkLoading(true);
    try {
      const token = getToken();
      const res = await fetch(`${API_BASE}/api/v1/invoices/bulk-pdf`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ invoiceIds: Array.from(selected) }),
      });
      if (!res.ok) throw new Error(`Download failed (${res.status})`);
      const blob = await res.blob();
      const ts = new Date().toISOString().replace(/[:.]/g, '-');
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `invoices-${ts}.zip`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Download failed');
    } finally {
      setBulkLoading(false);
    }
  };

  // "paid" is intentionally omitted — it requires a payment row; use
  // the per-row Mark Paid action for that.
  const BULK_STATUS_OPTIONS: { value: InvoiceStatus; label: string }[] = [
    { value: 'draft', label: 'Draft' },
    { value: 'sent', label: 'Sent' },
    { value: 'partial', label: 'Partial' },
    { value: 'overdue', label: 'Overdue' },
    { value: 'cancelled', label: 'Cancelled' },
  ];

  const confirmBulkStatus = async () => {
    if (!pendingStatus || selected.size === 0) return;
    setBulkLoading(true);
    try {
      const res = await apiFetch('/api/v1/invoices/bulk/status', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          invoiceIds: Array.from(selected),
          status: pendingStatus,
        }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body?.message ?? `Bulk status failed (${res.status})`);
      }
      const json: { updated: number; skipped: Array<{ id: string; reason: string }> } = await res.json();
      if (json.skipped.length > 0) {
        toast.success(
          `Updated ${json.updated}, skipped ${json.skipped.length}`,
          { description: json.skipped.slice(0, 3).map((s) => s.reason).join('; ') },
        );
      } else {
        toast.success(`Updated ${json.updated} invoice${json.updated !== 1 ? 's' : ''}`);
      }
      setSelected(new Set());
      setPendingStatus(null);
      fetchInvoices();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Bulk status change failed');
    } finally {
      setBulkLoading(false);
    }
  };

  const filtersNode = (
    <div className="flex gap-1 flex-wrap">
      {STATUS_TABS.map((tab) => (
        <button
          key={tab.value}
          onClick={() => setActiveTab(tab.value)}
          className={[
            'px-3 py-1.5 text-sm font-medium rounded-lg transition-colors',
            activeTab === tab.value
              ? 'bg-primary text-white shadow-sm'
              : 'text-gray-500 hover:text-gray-700 hover:bg-gray-100',
          ].join(' ')}
        >
          {tab.label}
        </button>
      ))}
    </div>
  );

  const paginationNode =
    !loadingList && meta && meta.total > 0 ? (
      <div className="flex items-center justify-between px-4 py-3 border border-gray-100 dark:border-gray-800 rounded-xl bg-gray-50/50 dark:bg-gray-800/50">
        <p className="text-xs text-gray-500 dark:text-gray-400">
          {meta.total} invoice{meta.total !== 1 ? 's' : ''} total
        </p>
        <div className="flex items-center gap-2">
          <Button variant="secondary" size="sm" onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={page <= 1}>
            Previous
          </Button>
          <span className="text-xs text-gray-600 dark:text-gray-400 min-w-[80px] text-center">
            Page {page} of {totalPages}
          </span>
          <Button variant="secondary" size="sm" onClick={() => setPage((p) => Math.min(totalPages, p + 1))} disabled={page >= totalPages}>
            Next
          </Button>
        </div>
      </div>
    ) : null;

  return (
    <ListPageLayout
      title="Invoices"
      secondaryActions={[
        {
          label: 'Export CSV',
          onClick: () => {
            const params = new URLSearchParams();
            if (activeTab !== 'all') params.set('status', activeTab);
            const qs = params.toString();
            void exportCsv(
              `/api/v1/invoices/export${qs ? `?${qs}` : ''}`,
              `invoices-${new Date().toISOString().slice(0, 10)}.csv`,
              { entityLabel: 'invoices' },
            );
          },
        },
      ]}
      primaryAction={{ label: 'New Invoice', href: '/invoices/new', icon: <span className="text-lg leading-none">+</span> }}
      filters={filtersNode}
      pagination={paginationNode}
    >
      {/* ------------------------------------------------------------------ */}
      {/* Stats row                                                            */}
      {/* ------------------------------------------------------------------ */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-6">
        {loadingStats ? (
          <>
            <StatCardSkeleton />
            <StatCardSkeleton />
            <StatCardSkeleton />
          </>
        ) : (
          <>
            <StatCard
              label="Outstanding"
              value={stats ? formatCurrency(stats.outstanding, statCurrency) : '—'}
              colorClass="text-blue-600"
            />
            <StatCard
              label="Overdue"
              value={stats ? formatCurrency(stats.overdue, statCurrency) : '—'}
              colorClass="text-red-600"
            />
            <StatCard
              label="Paid This Month"
              value={stats ? formatCurrency(stats.paid_this_month, statCurrency) : '—'}
              colorClass="text-green-600"
            />
          </>
        )}
      </div>

      {/* ------------------------------------------------------------------ */}
      {/* Mobile card view                                                     */}
      {/* ------------------------------------------------------------------ */}
      <div className="md:hidden space-y-3">
        {error && <ErrorBanner message={error} onRetry={fetchInvoices} />}
        {loadingList ? (
          Array.from({ length: 4 }).map((_, i) => (
            <Card key={i} padding="md" className="animate-pulse">
              <div className="h-4 bg-gray-100 dark:bg-gray-800 rounded w-1/2 mb-2" />
              <div className="h-3 bg-gray-100 dark:bg-gray-800 rounded w-3/4" />
            </Card>
          ))
        ) : invoices.length === 0 ? (
          <EmptyState
            icon={<FileText className="w-10 h-10" />}
            title={`No ${activeTab !== 'all' ? `${activeTab} ` : ''}invoices found`}
            action={{ label: 'Create an invoice', href: '/invoices/new' }}
          />
        ) : (
          invoices.map((invoice) => {
            const isOverdue = invoice.status !== 'paid' && invoice.status !== 'cancelled' && new Date(invoice.dueDate) < new Date();
            return (
              <Link key={invoice.id} href={`/invoices/${invoice.id}`} className="block bg-white dark:bg-gray-900 rounded-xl border border-gray-100 dark:border-gray-800 shadow-sm p-4 hover:border-gray-200 transition-colors">
                <div className="flex items-start justify-between gap-2 mb-2">
                  <div className="min-w-0">
                    <p className="font-medium text-gray-900 dark:text-gray-100">{invoice.number}</p>
                    <p className="text-xs text-gray-500 dark:text-gray-400 truncate">{invoice.client?.company ?? '—'}</p>
                  </div>
                  <StatusBadge status={invoice.status} />
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-xs text-gray-400 dark:text-gray-500">Due: {formatDate(invoice.dueDate)}{isOverdue && <span className="ml-1 text-red-500 font-semibold">OVERDUE</span>}</span>
                  <span className="font-semibold text-gray-900 dark:text-gray-100 text-sm">{formatCurrency(invoice.total, invoice.currency)}</span>
                </div>
              </Link>
            );
          })
        )}
      </div>

      {/* ------------------------------------------------------------------ */}
      {/* Table card (desktop)                                                 */}
      {/* ------------------------------------------------------------------ */}
      <Card className="hidden md:block">
        {error && (
          <ErrorBanner message={error} onRetry={fetchInvoices} className="rounded-none border-0 border-b border-red-100" />
        )}

        <div className="overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead>
              <tr className="bg-gray-50 dark:bg-gray-900 border-b border-gray-100 dark:border-gray-800 text-left text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide">
                <th className="px-4 py-3 w-10">
                  <input
                    type="checkbox"
                    checked={invoices.length > 0 && selected.size === invoices.length}
                    onChange={toggleAll}
                    aria-label="Select all invoices"
                    className="w-4 h-4 rounded border-gray-300 text-primary focus:ring-primary/30"
                  />
                </th>
                <th className="px-4 py-3">Invoice #</th>
                <th className="px-4 py-3">Client</th>
                <th className="px-4 py-3 hidden lg:table-cell">Date</th>
                <th className="px-4 py-3 hidden lg:table-cell">Due Date</th>
                <th className="px-4 py-3 text-right">Total</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3 text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {loadingList ? (
                <TableSkeleton rows={8} columns={8} columnWidths={['16px', '30%', '40%', '30%', '30%', '25%', '20%', '30%']} />
              ) : invoices.length === 0 ? (
                <tr>
                  <td colSpan={8} className="px-4 py-8">
                    <EmptyState
                      icon={<FileText className="w-10 h-10" />}
                      title={`No ${activeTab !== 'all' ? `${activeTab} ` : ''}invoices found`}
                      action={{ label: 'Create an invoice', href: '/invoices/new' }}
                    />
                  </td>
                </tr>
              ) : (
                invoices.map((invoice) => {
                  const isOverdue =
                    invoice.status !== 'paid' &&
                    invoice.status !== 'cancelled' &&
                    new Date(invoice.dueDate) < new Date();

                  return (
                    <tr
                      key={invoice.id}
                      className="border-b border-gray-100 dark:border-gray-800 last:border-0 hover:bg-gray-50/60 transition-colors"
                    >
                      <td className="px-4 py-3">
                        <input
                          type="checkbox"
                          checked={selected.has(invoice.id)}
                          onChange={() => toggleSelect(invoice.id)}
                          aria-label={`Select invoice ${invoice.number}`}
                          className="w-4 h-4 rounded border-gray-300 text-primary focus:ring-primary/30"
                        />
                      </td>
                      <td className="px-4 py-3 font-medium text-gray-900 dark:text-gray-100 whitespace-nowrap">
                        <Link
                          href={`/invoices/${invoice.id}`}
                          className="hover:text-primary transition-colors"
                        >
                          {invoice.number}
                        </Link>
                      </td>
                      <td className="px-4 py-3 text-gray-600 dark:text-gray-400 max-w-[160px] truncate">
                        {invoice.client?.company ?? '—'}
                      </td>
                      <td className="px-4 py-3 text-gray-500 dark:text-gray-400 whitespace-nowrap hidden lg:table-cell">
                        {formatDate(invoice.date)}
                      </td>
                      <td
                        className={[
                          'px-4 py-3 whitespace-nowrap hidden lg:table-cell',
                          isOverdue ? 'text-red-600 font-medium' : 'text-gray-500',
                        ].join(' ')}
                      >
                        {formatDate(invoice.dueDate)}
                        {isOverdue && (
                          <span className="ml-1 text-[10px] font-semibold text-red-500 uppercase">
                            overdue
                          </span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-right font-semibold text-gray-800 dark:text-gray-200 whitespace-nowrap">
                        {formatCurrency(invoice.total, invoice.currency)}
                      </td>
                      <td className="px-4 py-3">
                        <StatusBadge status={invoice.status} />
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex items-center justify-end gap-3">
                          <Link
                            href={`/invoices/${invoice.id}`}
                            className="text-xs text-gray-500 dark:text-gray-400 hover:text-primary font-medium transition-colors"
                          >
                            View
                          </Link>
                          {invoice.status === 'draft' && (
                            <ActionButton
                              onClick={() => handleSend(invoice.id)}
                              disabled={actionLoading === invoice.id}
                            >
                              {actionLoading === invoice.id ? 'Sending…' : 'Send'}
                            </ActionButton>
                          )}
                          {(invoice.status === 'sent' || invoice.status === 'partial' || invoice.status === 'overdue') && (
                            <ActionButton
                              onClick={() => handleMarkPaid(invoice.id)}
                              disabled={actionLoading === invoice.id}
                            >
                              {actionLoading === invoice.id ? 'Saving…' : 'Mark Paid'}
                            </ActionButton>
                          )}
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

      {/* Bulk action bar */}
      {selected.size > 0 && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 bg-gray-900 text-white rounded-xl shadow-2xl px-5 py-3 flex items-center gap-4 text-sm">
          <span className="font-medium">{selected.size} selected</span>
          <div className="w-px h-5 bg-gray-600" />
          <Button variant="destructive" size="sm" onClick={bulkDeleteDraft} disabled={bulkLoading}>
            Delete Draft
          </Button>
          <button
            onClick={bulkMarkSent}
            disabled={bulkLoading}
            className="px-3 py-1.5 rounded-lg bg-gray-700 hover:bg-gray-600 text-white text-xs font-medium disabled:opacity-50 transition-colors"
          >
            Mark as Sent
          </button>
          <div className="relative">
            <button
              onClick={() => setStatusMenuOpen((v) => !v)}
              disabled={bulkLoading}
              className="px-3 py-1.5 rounded-lg bg-gray-700 hover:bg-gray-600 text-white text-xs font-medium disabled:opacity-50 transition-colors inline-flex items-center gap-1"
              aria-haspopup="menu"
              aria-expanded={statusMenuOpen}
            >
              Change status
              <span aria-hidden="true">▾</span>
            </button>
            {statusMenuOpen && (
              <div
                role="menu"
                className="absolute bottom-full mb-2 right-0 min-w-[160px] bg-white dark:bg-gray-900 text-gray-900 dark:text-gray-100 rounded-lg shadow-xl border border-gray-200 dark:border-gray-700 overflow-hidden"
              >
                {BULK_STATUS_OPTIONS.map((opt) => (
                  <button
                    key={opt.value}
                    role="menuitem"
                    onClick={() => {
                      setStatusMenuOpen(false);
                      setPendingStatus(opt.value);
                    }}
                    className="block w-full text-left px-3 py-2 text-xs font-medium hover:bg-gray-100 dark:hover:bg-gray-800"
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
            )}
          </div>
          <button
            onClick={bulkExport}
            disabled={bulkLoading}
            className="px-3 py-1.5 rounded-lg bg-gray-700 hover:bg-gray-600 text-white text-xs font-medium disabled:opacity-50 transition-colors"
          >
            Export
          </button>
          <button
            onClick={bulkMerge}
            disabled={bulkLoading}
            className="px-3 py-1.5 rounded-lg bg-gray-700 hover:bg-gray-600 text-white text-xs font-medium disabled:opacity-50 transition-colors"
          >
            Merge
          </button>
          <button
            onClick={bulkPdfExport}
            disabled={bulkLoading}
            className="px-3 py-1.5 rounded-lg bg-gray-700 hover:bg-gray-600 text-white text-xs font-medium disabled:opacity-50 transition-colors"
          >
            {bulkLoading ? 'Working…' : 'Export PDFs'}
          </button>
          <button
            onClick={() => setSelected(new Set())}
            className="ml-2 text-gray-400 dark:text-gray-500 hover:text-white text-xs transition-colors"
          >
            Cancel
          </button>
        </div>
      )}

      {/* Bulk status confirm modal */}
      {pendingStatus && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div
            ref={statusModalRef}
            role="dialog"
            aria-modal="true"
            aria-labelledby="bulk-status-title"
            className="bg-white dark:bg-gray-900 rounded-xl shadow-2xl w-full max-w-md"
          >
            <div className="px-6 py-4 border-b border-gray-100 dark:border-gray-800">
              <h2 id="bulk-status-title" className="text-base font-semibold text-gray-900 dark:text-gray-100">
                Change status
              </h2>
            </div>
            <div className="px-6 py-5 text-sm text-gray-700 dark:text-gray-300">
              Change {selected.size} selected invoice{selected.size !== 1 ? 's' : ''} to{' '}
              <span className="font-semibold">{capitalize(pendingStatus)}</span>?
              <p className="mt-2 text-xs text-gray-500 dark:text-gray-400">
                Invoices that can&apos;t legally transition to this status will be skipped.
              </p>
            </div>
            <div className="px-6 py-3 border-t border-gray-100 dark:border-gray-800 flex justify-end gap-2">
              <Button variant="secondary" size="sm" onClick={closeStatusModal} disabled={bulkLoading}>
                Cancel
              </Button>
              <Button variant="primary" size="sm" onClick={confirmBulkStatus} loading={bulkLoading}>
                Confirm
              </Button>
            </div>
          </div>
        </div>
      )}
    </ListPageLayout>
  );
}
