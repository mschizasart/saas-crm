'use client';

import { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import { FileText } from 'lucide-react';
import { toast } from 'sonner';
import { ListPageLayout } from '@/components/layouts/list-page-layout';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { StatusBadge } from '@/components/ui/status-badge';
import { TableSkeleton } from '@/components/ui/table-skeleton';
import { EmptyState } from '@/components/ui/empty-state';
import { ErrorBanner } from '@/components/ui/error-banner';
import { useModalA11y } from '@/components/ui/use-modal-a11y';
import { apiFetch } from '@/lib/api';
import { exportCsv } from '@/lib/export-csv';

interface Proposal {
  id: string;
  subject: string;
  total: number | null;
  currency: string | null;
  status: string;
  createdAt: string;
  client?: { id: string; company: string } | null;
}

const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001';

function getToken(): string | null {
  if (typeof window === 'undefined') return null;
  return localStorage.getItem('access_token');
}

type ProposalStatus = 'draft' | 'sent' | 'accepted' | 'declined' | 'revising';

const BULK_STATUS_OPTIONS: { value: ProposalStatus; label: string }[] = [
  { value: 'draft', label: 'Draft' },
  { value: 'sent', label: 'Sent' },
  { value: 'accepted', label: 'Accepted' },
  { value: 'declined', label: 'Declined' },
  { value: 'revising', label: 'Revising' },
];

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

export default function ProposalsPage() {
  const [items, setItems] = useState<Proposal[]>([]);
  const [meta, setMeta] = useState<{ totalPages: number; total: number } | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulkLoading, setBulkLoading] = useState(false);
  const [statusMenuOpen, setStatusMenuOpen] = useState(false);
  const [pendingStatus, setPendingStatus] = useState<ProposalStatus | null>(null);
  const closeStatusModal = useCallback(() => setPendingStatus(null), []);
  const statusModalRef = useModalA11y(pendingStatus !== null, closeStatusModal);

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`${API_BASE}/api/v1/proposals?page=${page}&limit=15`, { headers: { Authorization: `Bearer ${getToken()}` } });
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
    else setSelected(new Set(items.map((e) => e.id)));
  };

  const confirmBulkStatus = async () => {
    if (!pendingStatus || selected.size === 0) return;
    setBulkLoading(true);
    try {
      const res = await apiFetch('/api/v1/proposals/bulk/status', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ proposalIds: Array.from(selected), status: pendingStatus }),
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
        toast.success(`Updated ${json.updated} proposal${json.updated !== 1 ? 's' : ''}`);
      }
      setSelected(new Set());
      setPendingStatus(null);
      fetchData();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Bulk status change failed');
    } finally {
      setBulkLoading(false);
    }
  };

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
      title="Proposals"
      secondaryActions={[
        {
          label: 'Export CSV',
          onClick: () =>
            void exportCsv(
              '/api/v1/proposals/export',
              `proposals-${new Date().toISOString().slice(0, 10)}.csv`,
              { entityLabel: 'proposals' },
            ),
        },
        { label: 'Pipeline view', href: '/proposals/pipeline' },
      ]}
      primaryAction={{ label: 'New Proposal', href: '/proposals/new', icon: <span className="text-lg leading-none">+</span> }}
      pagination={paginationNode}
    >
      <Card>
        {error && (
          <ErrorBanner message={error} onRetry={fetchData} className="rounded-none border-0 border-b border-red-100" />
        )}
        <div className="overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead>
              <tr className="bg-gray-50 dark:bg-gray-900 border-b border-gray-100 dark:border-gray-800 text-left text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase">
                <th className="px-4 py-3 w-10">
                  <input
                    type="checkbox"
                    checked={items.length > 0 && selected.size === items.length}
                    onChange={toggleAll}
                    aria-label="Select all proposals"
                    className="w-4 h-4 rounded border-gray-300 text-primary focus:ring-primary/30"
                  />
                </th>
                <th className="px-4 py-3">Subject</th>
                <th className="px-4 py-3">Client</th>
                <th className="px-4 py-3">Value</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3 hidden lg:table-cell">Created</th>
                <th className="px-4 py-3 text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <TableSkeleton rows={6} columns={7} columnWidths={['16px', '60%', '40%', '30%', '25%', '30%', '20%']} />
              ) : items.length === 0 ? (
                <tr>
                  <td colSpan={7} className="px-4 py-8">
                    <EmptyState
                      icon={<FileText className="w-10 h-10" />}
                      title="No proposals yet"
                      action={{ label: 'Create your first proposal', href: '/proposals/new' }}
                    />
                  </td>
                </tr>
              ) : items.map((p) => (
                <tr key={p.id} className="border-b border-gray-100 dark:border-gray-800 hover:bg-gray-50/60">
                  <td className="px-4 py-3">
                    <input
                      type="checkbox"
                      checked={selected.has(p.id)}
                      onChange={() => toggleSelect(p.id)}
                      aria-label={`Select proposal ${p.subject}`}
                      className="w-4 h-4 rounded border-gray-300 text-primary focus:ring-primary/30"
                    />
                  </td>
                  <td className="px-4 py-3 font-medium text-gray-900 dark:text-gray-100">{p.subject}</td>
                  <td className="px-4 py-3 text-gray-600 dark:text-gray-400">{p.client?.company ?? '—'}</td>
                  <td className="px-4 py-3 tabular-nums">{p.total != null ? Number(p.total).toFixed(2) : '—'} {p.currency ?? ''}</td>
                  <td className="px-4 py-3">
                    <StatusBadge status={p.status} />
                  </td>
                  <td className="px-4 py-3 text-gray-500 dark:text-gray-400 hidden lg:table-cell">{p.createdAt ? new Date(p.createdAt).toLocaleDateString() : '—'}</td>
                  <td className="px-4 py-3 text-right">
                    <Link href={`/proposals/${p.id}`} className="text-xs text-gray-500 dark:text-gray-400 hover:text-primary font-medium">View</Link>
                  </td>
                </tr>
              ))}
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
            aria-labelledby="bulk-proposal-status-title"
            className="bg-white dark:bg-gray-900 rounded-xl shadow-2xl w-full max-w-md"
          >
            <div className="px-6 py-4 border-b border-gray-100 dark:border-gray-800">
              <h2 id="bulk-proposal-status-title" className="text-base font-semibold text-gray-900 dark:text-gray-100">
                Change status
              </h2>
            </div>
            <div className="px-6 py-5 text-sm text-gray-700 dark:text-gray-300">
              Change {selected.size} selected proposal{selected.size !== 1 ? 's' : ''} to{' '}
              <span className="font-semibold">{capitalize(pendingStatus)}</span>?
              <p className="mt-2 text-xs text-gray-500 dark:text-gray-400">
                Proposals already accepted or declined will be skipped unless moving back to Revising.
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
