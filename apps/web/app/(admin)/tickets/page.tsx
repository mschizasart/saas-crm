'use client';

import { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import { Search, MessageSquare } from 'lucide-react';
import { ListPageLayout } from '@/components/layouts/list-page-layout';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { TableSkeleton } from '@/components/ui/table-skeleton';
import { EmptyState } from '@/components/ui/empty-state';
import { ErrorBanner } from '@/components/ui/error-banner';
import { inputClass } from '@/components/ui/form-field';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type TicketStatus   = 'open' | 'in_progress' | 'answered' | 'on_hold' | 'closed';
type TicketPriority = 'low' | 'medium' | 'high' | 'urgent';

interface Ticket {
  id: string;
  subject: string;
  client?: { id: string; company: string } | null;
  clientId: string | null;
  priority: TicketPriority;
  status: TicketStatus;
  assignedTo?: string | null;
  lastReplyAt: string | null;
  slaResponseStatus?: 'ok' | 'warning' | 'breached' | null;
  slaResolutionStatus?: 'ok' | 'warning' | 'breached' | null;
  slaResponseRemaining?: number | null;
  slaResolutionRemaining?: number | null;
}

interface TicketsResponse {
  data: Ticket[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

interface TicketStats {
  open: number;
  urgent: number;
  answered: number;
  closed: number;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001';

const STATUS_FILTERS: { label: string; value: TicketStatus | 'all' }[] = [
  { label: 'All',         value: 'all' },
  { label: 'Open',        value: 'open' },
  { label: 'In Progress', value: 'in_progress' },
  { label: 'Answered',    value: 'answered' },
  { label: 'On Hold',     value: 'on_hold' },
  { label: 'Closed',      value: 'closed' },
];

type BadgeVariant = 'default' | 'success' | 'warning' | 'error' | 'info' | 'muted';

const STATUS_BADGE: Record<TicketStatus, { variant: BadgeVariant; label: string }> = {
  open:        { variant: 'info',    label: 'Open' },
  in_progress: { variant: 'info',    label: 'In Progress' },
  answered:    { variant: 'success', label: 'Answered' },
  on_hold:     { variant: 'warning', label: 'On Hold' },
  closed:      { variant: 'muted',   label: 'Closed' },
};

const PRIORITY_BADGE: Record<TicketPriority, { variant: BadgeVariant; label: string }> = {
  low:    { variant: 'muted',   label: 'Low' },
  medium: { variant: 'info',    label: 'Medium' },
  high:   { variant: 'warning', label: 'High' },
  urgent: { variant: 'error',   label: 'Urgent' },
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function getToken(): string | null {
  if (typeof window === 'undefined') return null;
  return localStorage.getItem('access_token');
}

function useDebounce<T>(value: T, delay: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(timer);
  }, [value, delay]);
  return debounced;
}

function formatDate(iso: string | null): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString('en-GB', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  });
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function StatusBadge({ status }: { status: TicketStatus }) {
  const s = STATUS_BADGE[status] ?? STATUS_BADGE.open;
  return <Badge variant={s.variant}>{s.label}</Badge>;
}

function PriorityBadge({ priority }: { priority: TicketPriority }) {
  const p = PRIORITY_BADGE[priority] ?? PRIORITY_BADGE.low;
  return <Badge variant={p.variant}>{p.label}</Badge>;
}

function StatsCard({
  label,
  value,
  bgClass,
  textClass,
  valueClass,
}: {
  label: string;
  value: number | undefined;
  bgClass: string;
  textClass: string;
  valueClass: string;
}) {
  return (
    <div className={['rounded-xl border shadow-sm px-4 py-3 flex flex-col gap-1', bgClass].join(' ')}>
      <span className={['text-2xl font-bold', valueClass].join(' ')}>
        {value ?? '—'}
      </span>
      <span className={['text-xs font-medium', textClass].join(' ')}>{label}</span>
    </div>
  );
}

function SlaDot({ status, remaining }: { status?: 'ok' | 'warning' | 'breached' | null; remaining?: number | null }) {
  if (!status) return <span className="text-gray-300 dark:text-gray-600">--</span>;
  const colors = {
    ok: 'bg-green-500',
    warning: 'bg-yellow-400',
    breached: 'bg-red-500',
  };
  const labels = { ok: 'Within SLA', warning: 'SLA Warning (>80%)', breached: 'SLA Breached' };
  const timeText = remaining != null
    ? remaining > 0
      ? `${Math.floor(Math.abs(remaining) / 60)}h ${Math.abs(remaining) % 60}m remaining`
      : `${Math.floor(Math.abs(remaining) / 60)}h ${Math.abs(remaining) % 60}m exceeded`
    : '';
  return (
    <span className="relative group cursor-default inline-flex items-center">
      <span className={`inline-block w-2.5 h-2.5 rounded-full ${colors[status]}`} />
      <span className="absolute bottom-full left-1/2 -translate-x-1/2 mb-1 px-2 py-1 bg-gray-800 text-white text-xs rounded whitespace-nowrap opacity-0 group-hover:opacity-100 pointer-events-none transition-opacity z-10">
        {labels[status]}{timeText ? ` — ${timeText}` : ''}
      </span>
    </span>
  );
}


// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default function TicketsPage() {
  const [search, setSearch]           = useState('');
  const [statusFilter, setStatusFilter] = useState<TicketStatus | 'all'>('all');
  const [page, setPage]               = useState(1);
  const [tickets, setTickets]         = useState<Ticket[]>([]);
  const [meta, setMeta]               = useState<{ total: number; totalPages: number } | null>(null);
  const [stats, setStats]             = useState<TicketStats | null>(null);
  const [loading, setLoading]         = useState(true);
  const [error, setError]             = useState<string | null>(null);
  const [selected, setSelected]       = useState<Set<string>>(new Set());
  const [bulkLoading, setBulkLoading] = useState(false);

  const debouncedSearch = useDebounce(search, 350);

  // Reset page when filter or search changes
  useEffect(() => {
    setPage(1);
  }, [statusFilter, debouncedSearch]);

  // Fetch stats once on mount
  useEffect(() => {
    const token = getToken();
    fetch(`${API_BASE}/api/v1/tickets/stats`, {
      headers: { Authorization: `Bearer ${token}` },
    })
      .then((r) => (r.ok ? r.json() : Promise.reject(r.status)))
      .then((json: TicketStats) => setStats(json))
      .catch(() => {/* non-critical, ignore */});
  }, []);

  const fetchTickets = useCallback(async () => {
    setLoading(true);
    setError(null);

    try {
      const token  = getToken();
      const params = new URLSearchParams({ page: String(page), limit: '20' });
      if (statusFilter !== 'all') params.set('status', statusFilter);
      if (debouncedSearch) params.set('search', debouncedSearch);

      const res = await fetch(`${API_BASE}/api/v1/tickets?${params.toString()}`, {
        headers: { Authorization: `Bearer ${token}` },
      });

      if (!res.ok) throw new Error(`Server responded with ${res.status}`);

      const json: TicketsResponse = await res.json();
      setTickets(json.data ?? []);
      setMeta({ total: json.total ?? 0, totalPages: json.totalPages ?? 1 });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load tickets');
      setTickets([]);
    } finally {
      setLoading(false);
    }
  }, [statusFilter, debouncedSearch, page]);

  useEffect(() => {
    fetchTickets();
  }, [fetchTickets]);

  const totalPages = meta?.totalPages ?? 1;

  const toggleSelect = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleAll = () => {
    if (selected.size === tickets.length) {
      setSelected(new Set());
    } else {
      setSelected(new Set(tickets.map((t) => t.id)));
    }
  };

  const bulkClose = async () => {
    if (!confirm(`Close ${selected.size} ticket(s)?`)) return;
    setBulkLoading(true);
    const token = getToken();
    for (const id of selected) {
      await fetch(`${API_BASE}/api/v1/tickets/${id}/status`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ status: 'closed' }),
      }).catch(() => {});
    }
    setSelected(new Set());
    setBulkLoading(false);
    fetchTickets();
  };

  const bulkDelete = async () => {
    if (!confirm(`Delete ${selected.size} ticket(s)?`)) return;
    setBulkLoading(true);
    const token = getToken();
    for (const id of selected) {
      await fetch(`${API_BASE}/api/v1/tickets/${id}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` },
      }).catch(() => {});
    }
    setSelected(new Set());
    setBulkLoading(false);
    fetchTickets();
  };

  const filtersNode = (
    <>
      <div className="flex flex-wrap gap-2 mb-4">
        {STATUS_FILTERS.map((f) => (
          <button
            key={f.value}
            onClick={() => setStatusFilter(f.value)}
            className={[
              'px-3 py-1.5 rounded-full text-xs font-medium border transition-colors',
              statusFilter === f.value
                ? 'bg-primary text-white border-primary'
                : 'bg-white text-gray-600 border-gray-200 hover:bg-gray-50',
            ].join(' ')}
          >
            {f.label}
          </button>
        ))}
      </div>
      <div className="relative max-w-sm">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400 dark:text-gray-500 pointer-events-none" aria-hidden="true" />
        <input
          type="text"
          placeholder="Search tickets…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          aria-label="Search tickets"
          className={`${inputClass} pl-9`}
        />
      </div>
    </>
  );

  const paginationNode =
    !loading && meta && meta.total > 0 ? (
      <div className="flex items-center justify-between px-4 py-3 border border-gray-100 dark:border-gray-800 rounded-xl bg-gray-50/50 dark:bg-gray-800/50">
        <p className="text-xs text-gray-500 dark:text-gray-400">
          {meta.total} ticket{meta.total !== 1 ? 's' : ''} total
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
      title="Support Tickets"
      secondaryActions={[{ label: 'Kanban', href: '/tickets/kanban' }]}
      primaryAction={{ label: 'New Ticket', href: '/tickets/new', icon: <span className="text-lg leading-none">+</span> }}
      filters={filtersNode}
      pagination={paginationNode}
    >
      {/* ------------------------------------------------------------------ */}
      {/* Stats row                                                            */}
      {/* ------------------------------------------------------------------ */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-6">
        <StatsCard
          label="Open"
          value={stats?.open}
          bgClass="bg-blue-50 border-blue-100"
          textClass="text-blue-600"
          valueClass="text-blue-700"
        />
        <StatsCard
          label="Urgent"
          value={stats?.urgent}
          bgClass="bg-red-50 border-red-100"
          textClass="text-red-500"
          valueClass="text-red-600"
        />
        <StatsCard
          label="Answered"
          value={stats?.answered}
          bgClass="bg-green-50 border-green-100"
          textClass="text-green-600"
          valueClass="text-green-700"
        />
        <StatsCard
          label="Closed"
          value={stats?.closed}
          bgClass="bg-gray-50 border-gray-100"
          textClass="text-gray-500"
          valueClass="text-gray-700"
        />
      </div>

      {/* ------------------------------------------------------------------ */}
      {/* Mobile card view                                                     */}
      {/* ------------------------------------------------------------------ */}
      <div className="md:hidden space-y-3">
        {error && <ErrorBanner message={error} onRetry={fetchTickets} />}
        {loading ? (
          Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="bg-white dark:bg-gray-900 rounded-xl border border-gray-100 dark:border-gray-800 shadow-sm p-4 animate-pulse">
              <div className="h-4 bg-gray-100 dark:bg-gray-800 rounded w-3/4 mb-2" />
              <div className="h-3 bg-gray-100 dark:bg-gray-800 rounded w-1/2" />
            </div>
          ))
        ) : tickets.length === 0 ? (
          <EmptyState
            icon={<MessageSquare className="w-10 h-10" />}
            title={
              search
                ? `No tickets match "${search}"`
                : statusFilter !== 'all'
                ? `No ${STATUS_BADGE[statusFilter as TicketStatus]?.label ?? statusFilter} tickets`
                : 'No tickets found'
            }
            action={!search && statusFilter === 'all' ? { label: 'Create your first ticket', href: '/tickets/new' } : undefined}
          />
        ) : (
          tickets.map((ticket) => (
            <Link
              key={ticket.id}
              href={`/tickets/${ticket.id}`}
              className="block bg-white dark:bg-gray-900 rounded-xl border border-gray-100 dark:border-gray-800 shadow-sm p-4 hover:border-gray-200 transition-colors"
            >
              <div className="flex items-start justify-between gap-2 mb-2">
                <p className="font-medium text-gray-900 dark:text-gray-100 line-clamp-1 flex-1">{ticket.subject}</p>
                <div className="flex items-center gap-1.5 flex-shrink-0">
                  <PriorityBadge priority={ticket.priority} />
                  <StatusBadge status={ticket.status} />
                </div>
              </div>
              <div className="flex items-center justify-between text-xs text-gray-500 dark:text-gray-400">
                <span className="truncate">{ticket.client?.company ?? 'No client'}</span>
                <span className="whitespace-nowrap ml-2">{formatDate(ticket.lastReplyAt)}</span>
              </div>
            </Link>
          ))
        )}
      </div>

      {/* ------------------------------------------------------------------ */}
      {/* Table card                                                           */}
      {/* ------------------------------------------------------------------ */}
      <Card className="hidden md:block">
        {error && (
          <ErrorBanner message={error} onRetry={fetchTickets} className="rounded-none border-0 border-b border-red-100" />
        )}

        <div className="overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead>
              <tr className="bg-gray-50 dark:bg-gray-900 border-b border-gray-100 dark:border-gray-800 text-left text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide">
                <th className="px-4 py-3 w-10">
                  <input
                    type="checkbox"
                    checked={tickets.length > 0 && selected.size === tickets.length}
                    onChange={toggleAll}
                    aria-label="Select all tickets"
                    className="w-4 h-4 rounded border-gray-300 text-primary focus:ring-primary/30"
                  />
                </th>
                <th className="px-4 py-3">#</th>
                <th className="px-4 py-3">Subject</th>
                <th className="px-4 py-3 hidden lg:table-cell">Client</th>
                <th className="px-4 py-3">Priority</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3 hidden lg:table-cell">Assigned To</th>
                <th className="px-4 py-3 hidden lg:table-cell">SLA</th>
                <th className="px-4 py-3">Last Reply</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <TableSkeleton rows={8} columns={9} columnWidths={['16px', '30%', '65%', '40%', '25%', '25%', '30%', '25%', '30%']} />
              ) : tickets.length === 0 ? (
                <tr>
                  <td colSpan={9} className="px-4 py-8">
                    <EmptyState
                      icon={<MessageSquare className="w-10 h-10" />}
                      title={
                        search
                          ? `No tickets match "${search}"`
                          : statusFilter !== 'all'
                          ? `No ${STATUS_BADGE[statusFilter as TicketStatus]?.label ?? statusFilter} tickets`
                          : 'No tickets found'
                      }
                      action={!search && statusFilter === 'all' ? { label: 'Create your first ticket', href: '/tickets/new' } : undefined}
                    />
                  </td>
                </tr>
              ) : (
                tickets.map((ticket) => (
                  <tr
                    key={ticket.id}
                    className="border-b border-gray-100 dark:border-gray-800 last:border-0 hover:bg-gray-50/60 transition-colors"
                  >
                    <td className="px-4 py-3">
                      <input
                        type="checkbox"
                        checked={selected.has(ticket.id)}
                        onChange={() => toggleSelect(ticket.id)}
                        aria-label={`Select ticket ${ticket.subject}`}
                        className="w-4 h-4 rounded border-gray-300 text-primary focus:ring-primary/30"
                      />
                    </td>
                    <td className="px-4 py-3 font-mono text-xs text-gray-400 dark:text-gray-500 whitespace-nowrap">
                      #{ticket.id.slice(0, 6).toUpperCase()}
                    </td>
                    <td className="px-4 py-3 font-medium text-gray-900 dark:text-gray-100 max-w-[260px]">
                      <Link
                        href={`/tickets/${ticket.id}`}
                        className="hover:text-primary transition-colors line-clamp-1"
                      >
                        {ticket.subject}
                      </Link>
                    </td>
                    <td className="px-4 py-3 text-gray-500 dark:text-gray-400 hidden lg:table-cell">
                      {ticket.clientId ? (
                        <Link
                          href={`/clients/${ticket.clientId}`}
                          className="hover:text-primary transition-colors"
                        >
                          {ticket.client?.company ?? '—'}
                        </Link>
                      ) : (
                        <span className="text-gray-300 dark:text-gray-600">—</span>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <PriorityBadge priority={ticket.priority} />
                    </td>
                    <td className="px-4 py-3">
                      <StatusBadge status={ticket.status} />
                    </td>
                    <td className="px-4 py-3 text-gray-500 dark:text-gray-400 hidden lg:table-cell">
                      {ticket.assignedTo ?? (
                        <span className="text-gray-300 dark:text-gray-600">Unassigned</span>
                      )}
                    </td>
                    <td className="px-4 py-3 hidden lg:table-cell">
                      <div className="flex items-center gap-1.5">
                        <SlaDot status={ticket.slaResponseStatus} remaining={ticket.slaResponseRemaining} />
                        <SlaDot status={ticket.slaResolutionStatus} remaining={ticket.slaResolutionRemaining} />
                      </div>
                    </td>
                    <td className="px-4 py-3 text-gray-500 dark:text-gray-400 whitespace-nowrap">
                      {formatDate(ticket.lastReplyAt)}
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
          <button
            onClick={bulkClose}
            disabled={bulkLoading}
            className="px-3 py-1.5 rounded-lg bg-gray-700 hover:bg-gray-600 text-white text-xs font-medium disabled:opacity-50 transition-colors"
          >
            Close Selected
          </button>
          <Button variant="destructive" size="sm" onClick={bulkDelete} disabled={bulkLoading}>
            Delete
          </Button>
          <button
            onClick={() => setSelected(new Set())}
            className="ml-2 text-gray-400 dark:text-gray-500 hover:text-white text-xs transition-colors"
          >
            Cancel
          </button>
        </div>
      )}
    </ListPageLayout>
  );
}
