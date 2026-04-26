'use client';

import { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import { toast } from 'sonner';
import { ListPageLayout } from '@/components/layouts/list-page-layout';
import { Card } from '@/components/ui/card';
import { Badge, type BadgeVariant } from '@/components/ui/badge';
import { ErrorBanner } from '@/components/ui/error-banner';
import { Button } from '@/components/ui/button';
import { useModalA11y } from '@/components/ui/use-modal-a11y';
import { apiFetch } from '@/lib/api';
import { exportCsv } from '@/lib/export-csv';

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

const STATUS_MAP: Record<string, BadgeVariant> = {
  draft: 'muted',
  open: 'info',
  applied: 'success',
  voided: 'error',
};

type BulkStatus = 'open' | 'closed' | 'void';

const BULK_STATUS_OPTIONS: { value: BulkStatus; label: string }[] = [
  { value: 'open', label: 'Open' },
  { value: 'closed', label: 'Closed' },
  { value: 'void', label: 'Void' },
];

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function CreditNoteStatusBadge({ status }: { status: string }) {
  return (
    <Badge variant={STATUS_MAP[status] ?? 'default'} className="capitalize">
      {status}
    </Badge>
  );
}

export default function CreditNotesPage() {
  const [status, setStatus] = useState<Status>('all');
  const [page, setPage] = useState(1);
  const [items, setItems] = useState<CreditNote[]>([]);
  const [meta, setMeta] = useState<Response['meta'] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulkLoading, setBulkLoading] = useState(false);
  const [statusMenuOpen, setStatusMenuOpen] = useState(false);
  const [pendingStatus, setPendingStatus] = useState<BulkStatus | null>(null);
  const closeStatusModal = useCallback(() => setPendingStatus(null), []);
  const statusModalRef = useModalA11y(pendingStatus !== null, closeStatusModal);

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

  const toggleSelect = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleAll = () => {
    if (selected.size === items.length) setSelected(new Set());
    else setSelected(new Set(items.map((c) => c.id)));
  };

  const confirmBulkStatus = async () => {
    if (!pendingStatus || selected.size === 0) return;
    setBulkLoading(true);
    try {
      const res = await apiFetch('/api/v1/credit-notes/bulk/status', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ creditNoteIds: Array.from(selected), status: pendingStatus }),
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
        toast.success(`Updated ${json.updated} credit note${json.updated !== 1 ? 's' : ''}`);
      }
      setSelected(new Set());
      setPendingStatus(null);
      fetchItems();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Bulk status change failed');
    } finally {
      setBulkLoading(false);
    }
  };

  const tabs: { key: Status; label: string }[] = [
    { key: 'all', label: 'All' },
    { key: 'draft', label: 'Draft' },
    { key: 'open', label: 'Open' },
    { key: 'applied', label: 'Applied' },
    { key: 'voided', label: 'Voided' },
  ];

  const totalPages = meta?.totalPages ?? 1;

  const filtersNode = (
    <div className="border-b border-gray-200 dark:border-gray-700">
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
  );

  const paginationNode =
    !loading && meta && meta.total > 0 ? (
      <div className="flex items-center justify-between px-4 py-3 border border-gray-100 dark:border-gray-800 rounded-xl bg-gray-50/50 dark:bg-gray-800/50">
        <p className="text-xs text-gray-500 dark:text-gray-400">{meta.total} total</p>
        <div className="flex items-center gap-2">
          <Button
            variant="secondary"
            size="sm"
            onClick={() => setPage((p) => Math.max(1, p - 1))}
            disabled={page <= 1}
          >
            Previous
          </Button>
          <span className="text-xs text-gray-600 dark:text-gray-400 min-w-[80px] text-center">Page {page} of {totalPages}</span>
          <Button
            variant="secondary"
            size="sm"
            onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
            disabled={page >= totalPages}
          >
            Next
          </Button>
        </div>
      </div>
    ) : null;

  return (
    <ListPageLayout
      title="Credit Notes"
      secondaryActions={[
        {
          label: 'Export CSV',
          onClick: () => {
            const params = new URLSearchParams();
            if (status !== 'all') params.set('status', status);
            const qs = params.toString();
            void exportCsv(
              `/api/v1/credit-notes/export${qs ? `?${qs}` : ''}`,
              `credit-notes-${new Date().toISOString().slice(0, 10)}.csv`,
              { entityLabel: 'credit notes' },
            );
          },
        },
      ]}
      primaryAction={{ label: 'New Credit Note', href: '/credit-notes/new' }}
      filters={filtersNode}
      pagination={paginationNode}
    >
      {error && (
        <div className="mb-4">
          <ErrorBanner message={error} onRetry={fetchItems} />
        </div>
      )}

      <Card>
        <div className="overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead>
              <tr className="bg-gray-50 dark:bg-gray-900 border-b border-gray-100 dark:border-gray-800 text-left text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide">
                <th className="px-4 py-3 w-10">
                  <input
                    type="checkbox"
                    checked={items.length > 0 && selected.size === items.length}
                    onChange={toggleAll}
                    aria-label="Select all credit notes"
                    className="w-4 h-4 rounded border-gray-300 text-primary focus:ring-primary/30"
                  />
                </th>
                <th className="px-4 py-3">Number</th>
                <th className="px-4 py-3 hidden lg:table-cell">Date</th>
                <th className="px-4 py-3">Client</th>
                <th className="px-4 py-3">Invoice</th>
                <th className="px-4 py-3 text-right">Total</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3 text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={8} className="px-4 py-12 text-center text-gray-400 dark:text-gray-500">Loading…</td></tr>
              ) : items.length === 0 ? (
                <tr><td colSpan={8} className="px-4 py-12 text-center text-gray-400 dark:text-gray-500">No credit notes found</td></tr>
              ) : (
                items.map((cn) => (
                  <tr key={cn.id} className="border-b border-gray-100 dark:border-gray-800 last:border-0 hover:bg-gray-50/60">
                    <td className="px-4 py-3">
                      <input
                        type="checkbox"
                        checked={selected.has(cn.id)}
                        onChange={() => toggleSelect(cn.id)}
                        aria-label={`Select credit note ${cn.number}`}
                        className="w-4 h-4 rounded border-gray-300 text-primary focus:ring-primary/30"
                      />
                    </td>
                    <td className="px-4 py-3 font-medium text-gray-900 dark:text-gray-100">
                      <Link href={`/credit-notes/${cn.id}`} className="text-primary hover:underline">
                        {cn.number}
                      </Link>
                    </td>
                    <td className="px-4 py-3 text-gray-500 dark:text-gray-400 hidden lg:table-cell">{new Date(cn.date).toLocaleDateString()}</td>
                    <td className="px-4 py-3 text-gray-500 dark:text-gray-400">{cn.client?.company ?? '—'}</td>
                    <td className="px-4 py-3 text-gray-500 dark:text-gray-400">
                      {cn.invoice ? (
                        <Link href={`/invoices/${cn.invoice.id}`} className="text-primary hover:underline">
                          {cn.invoice.number}
                        </Link>
                      ) : '—'}
                    </td>
                    <td className="px-4 py-3 text-right font-medium text-gray-900 dark:text-gray-100">{Number(cn.total).toFixed(2)}</td>
                    <td className="px-4 py-3"><CreditNoteStatusBadge status={cn.status} /></td>
                    <td className="px-4 py-3 text-right">
                      <Link href={`/credit-notes/${cn.id}`} className="text-xs text-gray-500 dark:text-gray-400 hover:text-primary">View</Link>
                    </td>
                  </tr>
                ))
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
                className="absolute bottom-full mb-2 right-0 min-w-[140px] bg-white dark:bg-gray-900 text-gray-900 dark:text-gray-100 rounded-lg shadow-xl border border-gray-200 dark:border-gray-700 overflow-hidden"
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
            aria-labelledby="bulk-credit-note-status-title"
            className="bg-white dark:bg-gray-900 rounded-xl shadow-2xl w-full max-w-md"
          >
            <div className="px-6 py-4 border-b border-gray-100 dark:border-gray-800">
              <h2 id="bulk-credit-note-status-title" className="text-base font-semibold text-gray-900 dark:text-gray-100">
                Change status
              </h2>
            </div>
            <div className="px-6 py-5 text-sm text-gray-700 dark:text-gray-300">
              Change {selected.size} selected credit note{selected.size !== 1 ? 's' : ''} to{' '}
              <span className="font-semibold">{capitalize(pendingStatus)}</span>?
              <p className="mt-2 text-xs text-gray-500 dark:text-gray-400">
                Applied credit notes and already-void notes will be skipped.
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
