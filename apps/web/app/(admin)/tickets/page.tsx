'use client';

import { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type TicketStatus   = 'open' | 'in_progress' | 'answered' | 'on_hold' | 'closed';
type TicketPriority = 'low' | 'medium' | 'high' | 'urgent';

interface Ticket {
  id: string;
  subject: string;
  client_name: string | null;
  client_id: string | null;
  priority: TicketPriority;
  status: TicketStatus;
  assigned_to_name: string | null;
  last_reply_at: string | null;
}

interface TicketsResponse {
  data: Ticket[];
  meta: {
    page: number;
    per_page: number;
    total: number;
    total_pages: number;
  };
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

const STATUS_BADGE: Record<TicketStatus, { bg: string; text: string; label: string }> = {
  open:        { bg: 'bg-blue-100',   text: 'text-blue-700',   label: 'Open' },
  in_progress: { bg: 'bg-indigo-100', text: 'text-indigo-700', label: 'In Progress' },
  answered:    { bg: 'bg-green-100',  text: 'text-green-700',  label: 'Answered' },
  on_hold:     { bg: 'bg-yellow-100', text: 'text-yellow-700', label: 'On Hold' },
  closed:      { bg: 'bg-gray-100',   text: 'text-gray-500',   label: 'Closed' },
};

const PRIORITY_BADGE: Record<TicketPriority, { bg: string; text: string; label: string }> = {
  low:    { bg: 'bg-gray-100',   text: 'text-gray-500',   label: 'Low' },
  medium: { bg: 'bg-blue-100',   text: 'text-blue-700',   label: 'Medium' },
  high:   { bg: 'bg-orange-100', text: 'text-orange-700', label: 'High' },
  urgent: { bg: 'bg-red-100',    text: 'text-red-600',    label: 'Urgent' },
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
  return (
    <span
      className={[
        'inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium',
        s.bg,
        s.text,
      ].join(' ')}
    >
      {s.label}
    </span>
  );
}

function PriorityBadge({ priority }: { priority: TicketPriority }) {
  const p = PRIORITY_BADGE[priority] ?? PRIORITY_BADGE.low;
  return (
    <span
      className={[
        'inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium',
        p.bg,
        p.text,
      ].join(' ')}
    >
      {p.label}
    </span>
  );
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

function SkeletonRow() {
  return (
    <tr className="border-b border-gray-100 last:border-0">
      {Array.from({ length: 7 }).map((_, i) => (
        <td key={i} className="px-4 py-3">
          <div
            className="h-4 bg-gray-100 rounded animate-pulse"
            style={{ width: i === 1 ? '65%' : i === 0 ? '30%' : '40%' }}
          />
        </td>
      ))}
    </tr>
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
  const [meta, setMeta]               = useState<TicketsResponse['meta'] | null>(null);
  const [stats, setStats]             = useState<TicketStats | null>(null);
  const [loading, setLoading]         = useState(true);
  const [error, setError]             = useState<string | null>(null);

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
      setMeta(json.meta ?? null);
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

  const totalPages = meta?.total_pages ?? 1;

  return (
    <div>
      {/* ------------------------------------------------------------------ */}
      {/* Header                                                               */}
      {/* ------------------------------------------------------------------ */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mb-6">
        <h1 className="text-2xl font-bold text-gray-900">Support Tickets</h1>
        <Link
          href="/tickets/new"
          className="inline-flex items-center gap-1.5 bg-primary text-white text-sm font-medium px-4 py-2 rounded-lg hover:bg-primary/90 transition-colors"
        >
          <span className="text-lg leading-none">+</span>
          New Ticket
        </Link>
      </div>

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
      {/* Filter tabs                                                          */}
      {/* ------------------------------------------------------------------ */}
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

      {/* ------------------------------------------------------------------ */}
      {/* Search                                                               */}
      {/* ------------------------------------------------------------------ */}
      <div className="mb-4">
        <div className="relative max-w-sm">
          <svg
            className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400 pointer-events-none"
            xmlns="http://www.w3.org/2000/svg"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            strokeWidth={2}
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M21 21l-4.35-4.35M17 11A6 6 0 1 1 5 11a6 6 0 0 1 12 0z"
            />
          </svg>
          <input
            type="text"
            placeholder="Search tickets…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full pl-9 pr-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary bg-white"
          />
        </div>
      </div>

      {/* ------------------------------------------------------------------ */}
      {/* Table card                                                           */}
      {/* ------------------------------------------------------------------ */}
      <div className="bg-white rounded-xl border border-gray-100 shadow-sm overflow-hidden">
        {error && (
          <div className="px-4 py-3 bg-red-50 border-b border-red-100 text-sm text-red-600">
            {error} —{' '}
            <button className="underline" onClick={fetchTickets}>
              retry
            </button>
          </div>
        )}

        <div className="overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead>
              <tr className="bg-gray-50 border-b border-gray-100 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide">
                <th className="px-4 py-3">#</th>
                <th className="px-4 py-3">Subject</th>
                <th className="px-4 py-3">Client</th>
                <th className="px-4 py-3">Priority</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3">Assigned To</th>
                <th className="px-4 py-3">Last Reply</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                Array.from({ length: 8 }).map((_, i) => <SkeletonRow key={i} />)
              ) : tickets.length === 0 ? (
                <tr>
                  <td colSpan={7} className="px-4 py-16 text-center">
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
                          d="M8 10h.01M12 10h.01M16 10h.01M9 16H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-5l-5 4v-4z"
                        />
                      </svg>
                      <p className="text-sm font-medium">
                        {search
                          ? `No tickets match "${search}"`
                          : statusFilter !== 'all'
                          ? `No ${STATUS_BADGE[statusFilter as TicketStatus]?.label ?? statusFilter} tickets`
                          : 'No tickets found'}
                      </p>
                      {!search && statusFilter === 'all' && (
                        <Link
                          href="/tickets/new"
                          className="text-sm text-primary hover:underline"
                        >
                          Create your first ticket
                        </Link>
                      )}
                    </div>
                  </td>
                </tr>
              ) : (
                tickets.map((ticket) => (
                  <tr
                    key={ticket.id}
                    className="border-b border-gray-100 last:border-0 hover:bg-gray-50/60 transition-colors"
                  >
                    <td className="px-4 py-3 font-mono text-xs text-gray-400 whitespace-nowrap">
                      #{ticket.id.slice(0, 6).toUpperCase()}
                    </td>
                    <td className="px-4 py-3 font-medium text-gray-900 max-w-[260px]">
                      <Link
                        href={`/tickets/${ticket.id}`}
                        className="hover:text-primary transition-colors line-clamp-1"
                      >
                        {ticket.subject}
                      </Link>
                    </td>
                    <td className="px-4 py-3 text-gray-500">
                      {ticket.client_id ? (
                        <Link
                          href={`/clients/${ticket.client_id}`}
                          className="hover:text-primary transition-colors"
                        >
                          {ticket.client_name ?? ticket.client_id}
                        </Link>
                      ) : (
                        <span className="text-gray-300">—</span>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <PriorityBadge priority={ticket.priority} />
                    </td>
                    <td className="px-4 py-3">
                      <StatusBadge status={ticket.status} />
                    </td>
                    <td className="px-4 py-3 text-gray-500">
                      {ticket.assigned_to_name ?? (
                        <span className="text-gray-300">Unassigned</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-gray-500 whitespace-nowrap">
                      {formatDate(ticket.last_reply_at)}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        {/* ---------------------------------------------------------------- */}
        {/* Pagination                                                         */}
        {/* ---------------------------------------------------------------- */}
        {!loading && meta && meta.total > 0 && (
          <div className="flex items-center justify-between px-4 py-3 border-t border-gray-100 bg-gray-50/50">
            <p className="text-xs text-gray-500">
              {meta.total} ticket{meta.total !== 1 ? 's' : ''} total
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
    </div>
  );
}
