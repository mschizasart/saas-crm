'use client';

import { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type InvoiceStatus = 'draft' | 'sent' | 'partial' | 'paid' | 'overdue' | 'cancelled';

interface Invoice {
  id: string;
  invoice_number: string;
  client_name: string;
  date: string;        // ISO date string
  due_date: string;    // ISO date string
  total: number;
  currency: string;
  status: InvoiceStatus;
}

interface InvoicesResponse {
  data: Invoice[];
  meta: {
    page: number;
    per_page: number;
    total: number;
    total_pages: number;
  };
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

const STATUS_BADGE: Record<InvoiceStatus, string> = {
  draft:     'bg-gray-100 text-gray-600',
  sent:      'bg-blue-100 text-blue-700',
  partial:   'bg-orange-100 text-orange-700',
  paid:      'bg-green-100 text-green-700',
  overdue:   'bg-red-100 text-red-700',
  cancelled: 'bg-gray-100 text-gray-400',
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
    <span
      className={[
        'inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium',
        STATUS_BADGE[status],
      ].join(' ')}
    >
      {capitalize(status)}
    </span>
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
    <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-5">
      <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-1">{label}</p>
      <p className={`text-xl font-bold ${colorClass}`}>{value}</p>
    </div>
  );
}

function StatCardSkeleton() {
  return (
    <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-5 animate-pulse">
      <div className="h-3 bg-gray-100 rounded w-1/2 mb-2" />
      <div className="h-6 bg-gray-100 rounded w-3/4" />
    </div>
  );
}

function TableRowSkeleton() {
  return (
    <tr className="border-b border-gray-100 last:border-0">
      {Array.from({ length: 7 }).map((_, i) => (
        <td key={i} className="px-4 py-3">
          <div
            className="h-4 bg-gray-100 rounded animate-pulse"
            style={{ width: i === 1 ? '55%' : '40%' }}
          />
        </td>
      ))}
    </tr>
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
      className="text-xs text-gray-500 hover:text-primary font-medium transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
    >
      {children}
    </button>
  );
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default function InvoicesPage() {
  const [activeTab, setActiveTab] = useState<InvoiceStatus | 'all'>('all');
  const [page, setPage] = useState(1);
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [meta, setMeta] = useState<InvoicesResponse['meta'] | null>(null);
  const [stats, setStats] = useState<InvoiceStats | null>(null);
  const [loadingList, setLoadingList] = useState(true);
  const [loadingStats, setLoadingStats] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [actionLoading, setActionLoading] = useState<string | null>(null); // invoice id
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulkLoading, setBulkLoading] = useState(false);

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
      const params = new URLSearchParams({ page: String(page), per_page: '15' });
      if (activeTab !== 'all') params.set('status', activeTab);

      const res = await fetch(`${API_BASE}/api/v1/invoices?${params.toString()}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) throw new Error(`Server responded with ${res.status}`);

      const json: InvoicesResponse = await res.json();
      setInvoices(json.data ?? []);
      setMeta(json.meta ?? null);
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

  const totalPages = meta?.total_pages ?? 1;
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

  return (
    <div>
      {/* ------------------------------------------------------------------ */}
      {/* Header                                                               */}
      {/* ------------------------------------------------------------------ */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mb-6">
        <h1 className="text-2xl font-bold text-gray-900">Invoices</h1>
        <Link
          href="/invoices/new"
          className="inline-flex items-center gap-1.5 bg-primary text-white text-sm font-medium px-4 py-2 rounded-lg hover:bg-primary/90 transition-colors"
        >
          <span className="text-lg leading-none">+</span>
          New Invoice
        </Link>
      </div>

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
      {/* Filter tabs                                                          */}
      {/* ------------------------------------------------------------------ */}
      <div className="flex gap-1 mb-4 flex-wrap">
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

      {/* ------------------------------------------------------------------ */}
      {/* Mobile card view                                                     */}
      {/* ------------------------------------------------------------------ */}
      <div className="md:hidden space-y-3">
        {error && (
          <div className="px-4 py-3 bg-red-50 border border-red-100 text-sm text-red-600 rounded-lg">
            {error} — <button className="underline" onClick={fetchInvoices}>retry</button>
          </div>
        )}
        {loadingList ? (
          Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="bg-white rounded-xl border border-gray-100 shadow-sm p-4 animate-pulse">
              <div className="h-4 bg-gray-100 rounded w-1/2 mb-2" />
              <div className="h-3 bg-gray-100 rounded w-3/4" />
            </div>
          ))
        ) : invoices.length === 0 ? (
          <div className="text-center py-12 text-gray-400 text-sm">
            No {activeTab !== 'all' ? `${activeTab} ` : ''}invoices found
          </div>
        ) : (
          invoices.map((invoice) => {
            const isOverdue = invoice.status !== 'paid' && invoice.status !== 'cancelled' && new Date(invoice.due_date) < new Date();
            return (
              <Link key={invoice.id} href={`/invoices/${invoice.id}`} className="block bg-white rounded-xl border border-gray-100 shadow-sm p-4 hover:border-gray-200 transition-colors">
                <div className="flex items-start justify-between gap-2 mb-2">
                  <div className="min-w-0">
                    <p className="font-medium text-gray-900">{invoice.invoice_number}</p>
                    <p className="text-xs text-gray-500 truncate">{invoice.client_name}</p>
                  </div>
                  <StatusBadge status={invoice.status} />
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-xs text-gray-400">Due: {formatDate(invoice.due_date)}{isOverdue && <span className="ml-1 text-red-500 font-semibold">OVERDUE</span>}</span>
                  <span className="font-semibold text-gray-900 text-sm">{formatCurrency(invoice.total, invoice.currency)}</span>
                </div>
              </Link>
            );
          })
        )}
      </div>

      {/* ------------------------------------------------------------------ */}
      {/* Table card (desktop)                                                 */}
      {/* ------------------------------------------------------------------ */}
      <div className="hidden md:block bg-white rounded-xl border border-gray-100 shadow-sm overflow-hidden">
        {error && (
          <div className="px-4 py-3 bg-red-50 border-b border-red-100 text-sm text-red-600">
            {error} —{' '}
            <button className="underline" onClick={fetchInvoices}>
              retry
            </button>
          </div>
        )}

        <div className="overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead>
              <tr className="bg-gray-50 border-b border-gray-100 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide">
                <th className="px-4 py-3 w-10">
                  <input
                    type="checkbox"
                    checked={invoices.length > 0 && selected.size === invoices.length}
                    onChange={toggleAll}
                    className="w-4 h-4 rounded border-gray-300 text-primary focus:ring-primary/30"
                  />
                </th>
                <th className="px-4 py-3">Invoice #</th>
                <th className="px-4 py-3">Client</th>
                <th className="px-4 py-3">Date</th>
                <th className="px-4 py-3">Due Date</th>
                <th className="px-4 py-3 text-right">Total</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3 text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {loadingList ? (
                Array.from({ length: 8 }).map((_, i) => <TableRowSkeleton key={i} />)
              ) : invoices.length === 0 ? (
                <tr>
                  <td colSpan={8} className="px-4 py-16 text-center">
                    <div className="flex flex-col items-center gap-2 text-gray-400">
                      <svg
                        className="w-10 h-10 opacity-40"
                        xmlns="http://www.w3.org/2000/svg"
                        fill="none"
                        viewBox="0 0 24 24"
                        stroke="currentColor"
                      >
                        <path
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          strokeWidth={1.5}
                          d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414A1 1 0 0120 9.414V19a2 2 0 01-2 2z"
                        />
                      </svg>
                      <p className="text-sm font-medium">
                        No {activeTab !== 'all' ? `${activeTab} ` : ''}invoices found
                      </p>
                      <Link href="/invoices/new" className="text-sm text-primary hover:underline">
                        Create an invoice
                      </Link>
                    </div>
                  </td>
                </tr>
              ) : (
                invoices.map((invoice) => {
                  const isOverdue =
                    invoice.status !== 'paid' &&
                    invoice.status !== 'cancelled' &&
                    new Date(invoice.due_date) < new Date();

                  return (
                    <tr
                      key={invoice.id}
                      className="border-b border-gray-100 last:border-0 hover:bg-gray-50/60 transition-colors"
                    >
                      <td className="px-4 py-3">
                        <input
                          type="checkbox"
                          checked={selected.has(invoice.id)}
                          onChange={() => toggleSelect(invoice.id)}
                          className="w-4 h-4 rounded border-gray-300 text-primary focus:ring-primary/30"
                        />
                      </td>
                      <td className="px-4 py-3 font-medium text-gray-900 whitespace-nowrap">
                        <Link
                          href={`/invoices/${invoice.id}`}
                          className="hover:text-primary transition-colors"
                        >
                          {invoice.invoice_number}
                        </Link>
                      </td>
                      <td className="px-4 py-3 text-gray-600 max-w-[160px] truncate">
                        {invoice.client_name}
                      </td>
                      <td className="px-4 py-3 text-gray-500 whitespace-nowrap">
                        {formatDate(invoice.date)}
                      </td>
                      <td
                        className={[
                          'px-4 py-3 whitespace-nowrap',
                          isOverdue ? 'text-red-600 font-medium' : 'text-gray-500',
                        ].join(' ')}
                      >
                        {formatDate(invoice.due_date)}
                        {isOverdue && (
                          <span className="ml-1 text-[10px] font-semibold text-red-500 uppercase">
                            overdue
                          </span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-right font-semibold text-gray-800 whitespace-nowrap">
                        {formatCurrency(invoice.total, invoice.currency)}
                      </td>
                      <td className="px-4 py-3">
                        <StatusBadge status={invoice.status} />
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex items-center justify-end gap-3">
                          <Link
                            href={`/invoices/${invoice.id}`}
                            className="text-xs text-gray-500 hover:text-primary font-medium transition-colors"
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

        {/* ---------------------------------------------------------------- */}
        {/* Pagination                                                         */}
        {/* ---------------------------------------------------------------- */}
        {!loadingList && meta && meta.total > 0 && (
          <div className="flex items-center justify-between px-4 py-3 border-t border-gray-100 bg-gray-50/50">
            <p className="text-xs text-gray-500">
              {meta.total} invoice{meta.total !== 1 ? 's' : ''} total
            </p>
            <div className="flex items-center gap-2">
              <button
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                disabled={page <= 1}
                className="px-3 py-1.5 text-xs font-medium rounded-md border border-gray-200 bg-white hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
              >
                Previous
              </button>
              <span className="text-xs text-gray-600 min-w-[80px] text-center">
                Page {page} of {totalPages}
              </span>
              <button
                onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                disabled={page >= totalPages}
                className="px-3 py-1.5 text-xs font-medium rounded-md border border-gray-200 bg-white hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
              >
                Next
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Bulk action bar */}
      {selected.size > 0 && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 bg-gray-900 text-white rounded-xl shadow-2xl px-5 py-3 flex items-center gap-4 text-sm">
          <span className="font-medium">{selected.size} selected</span>
          <div className="w-px h-5 bg-gray-600" />
          <button
            onClick={bulkDeleteDraft}
            disabled={bulkLoading}
            className="px-3 py-1.5 rounded-lg bg-red-600 hover:bg-red-700 text-white text-xs font-medium disabled:opacity-50 transition-colors"
          >
            Delete Draft
          </button>
          <button
            onClick={bulkMarkSent}
            disabled={bulkLoading}
            className="px-3 py-1.5 rounded-lg bg-gray-700 hover:bg-gray-600 text-white text-xs font-medium disabled:opacity-50 transition-colors"
          >
            Mark as Sent
          </button>
          <button
            onClick={bulkExport}
            disabled={bulkLoading}
            className="px-3 py-1.5 rounded-lg bg-gray-700 hover:bg-gray-600 text-white text-xs font-medium disabled:opacity-50 transition-colors"
          >
            Export
          </button>
          <button
            onClick={() => setSelected(new Set())}
            className="ml-2 text-gray-400 hover:text-white text-xs transition-colors"
          >
            Cancel
          </button>
        </div>
      )}
    </div>
  );
}
