'use client';

import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { apiFetch } from '@lib/api';
import { PageHeader } from '@/components/ui/page-header';
import { ErrorBanner } from '@/components/ui/error-banner';
import { inputClass } from '@/components/ui/form-field';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type EstimateStatus = 'draft' | 'sent' | 'declined' | 'accepted' | 'expired';

interface Estimate {
  id: string;
  number: string;
  status: EstimateStatus | string;
  total: number | string | null;
  currency?: string | null;
  expiryDate?: string | null;
  clientId?: string | null;
  client?: { id: string; company: string } | null;
}

interface ClientOption {
  id: string;
  company: string;
}

type KanbanBoard = Record<EstimateStatus, Estimate[]>;

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const COLUMNS: { status: EstimateStatus; label: string }[] = [
  { status: 'draft',    label: 'Draft' },
  { status: 'sent',     label: 'Sent' },
  { status: 'declined', label: 'Declined' },
  { status: 'accepted', label: 'Accepted' },
  { status: 'expired',  label: 'Expired' },
];

const STATUS_STYLES: Record<EstimateStatus, { header: string }> = {
  draft:    { header: 'border-t-gray-400' },
  sent:     { header: 'border-t-blue-400' },
  declined: { header: 'border-t-red-400' },
  accepted: { header: 'border-t-green-400' },
  expired:  { header: 'border-t-amber-400' },
};

const emptyBoard = (): KanbanBoard => ({
  draft: [],
  sent: [],
  declined: [],
  accepted: [],
  expired: [],
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatMoney(value: number | string | null | undefined, currency?: string | null): string {
  if (value == null || value === '') return '—';
  const n = typeof value === 'string' ? Number(value) : value;
  if (Number.isNaN(n)) return '—';
  const cur = (currency ?? 'USD').toUpperCase();
  try {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: cur,
      maximumFractionDigits: 2,
    }).format(n);
  } catch {
    return `${n.toFixed(2)} ${cur}`;
  }
}

function relativeExpiry(iso: string | null | undefined): { label: string; overdue: boolean } | null {
  if (!iso) return null;
  const now = new Date();
  const then = new Date(iso);
  if (Number.isNaN(then.getTime())) return null;

  const msPerDay = 86_400_000;
  const diffMs = then.getTime() - now.getTime();
  const diffDays = Math.round(diffMs / msPerDay);

  if (diffDays === 0) return { label: 'expires today', overdue: false };
  if (diffDays > 0) {
    if (diffDays === 1) return { label: 'in 1 day', overdue: false };
    if (diffDays < 30) return { label: `in ${diffDays} days`, overdue: false };
    const months = Math.round(diffDays / 30);
    return { label: `in ${months} mo`, overdue: false };
  }
  const overdueBy = Math.abs(diffDays);
  if (overdueBy === 1) return { label: '1 day overdue', overdue: true };
  if (overdueBy < 30) return { label: `${overdueBy} days overdue`, overdue: true };
  const months = Math.round(overdueBy / 30);
  return { label: `${months} mo overdue`, overdue: true };
}

// Map a drag transition to a backend call. All drops hit the dedicated
// PATCH /:id/status endpoint which accepts any valid status cleanly and
// has no side-effects (no email sent, etc). Dedicated send/accept/decline
// routes remain reserved for explicit UI actions that trigger event hooks.
async function changeEstimateStatus(id: string, to: EstimateStatus): Promise<Response> {
  return apiFetch(`/api/v1/estimates/${id}/status`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ status: to }),
  });
}

// ---------------------------------------------------------------------------
// Card
// ---------------------------------------------------------------------------

function EstimateCard({
  est,
  onDragStart,
}: {
  est: Estimate;
  onDragStart: (e: React.DragEvent, id: string, from: EstimateStatus) => void;
}) {
  const expiry = relativeExpiry(est.expiryDate);

  return (
    <div
      draggable
      onDragStart={(e) => onDragStart(e, est.id, est.status as EstimateStatus)}
      className="group bg-white dark:bg-gray-900 border border-gray-100 dark:border-gray-800 rounded-lg p-3 shadow-sm cursor-grab active:cursor-grabbing hover:shadow-md hover:border-gray-200 transition-all select-none"
    >
      <div className="flex items-start justify-between gap-2 mb-1">
        <Link
          href={`/estimates/${est.id}`}
          className="text-sm font-medium text-gray-900 dark:text-gray-100 hover:text-primary leading-snug line-clamp-2"
          onClick={(e) => e.stopPropagation()}
        >
          {est.number}
        </Link>
      </div>

      {est.client?.company && (
        <p className="text-xs text-gray-400 dark:text-gray-500 mb-2 truncate">{est.client.company}</p>
      )}

      <div className="flex items-center justify-between mt-2">
        <span className="text-xs font-semibold text-gray-700 dark:text-gray-300 tabular-nums">
          {formatMoney(est.total, est.currency)}
        </span>
        {expiry && (
          <span
            className={`text-[10px] font-medium ${
              expiry.overdue ? 'text-red-600' : 'text-gray-400'
            }`}
            title={est.expiryDate ?? undefined}
          >
            {expiry.label}
          </span>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Column
// ---------------------------------------------------------------------------

function KanbanColumn({
  status,
  label,
  estimates,
  isDragOver,
  onDragStart,
  onDragOver,
  onDragLeave,
  onDrop,
}: {
  status: EstimateStatus;
  label: string;
  estimates: Estimate[];
  isDragOver: boolean;
  onDragStart: (e: React.DragEvent, id: string, from: EstimateStatus) => void;
  onDragOver: (e: React.DragEvent, status: EstimateStatus) => void;
  onDragLeave: () => void;
  onDrop: (e: React.DragEvent, toStatus: EstimateStatus) => void;
}) {
  const style = STATUS_STYLES[status];

  return (
    <div className="flex flex-col min-w-[240px] w-[240px] flex-shrink-0">
      <div
        className={[
          'bg-white rounded-xl border border-gray-100 border-t-4 shadow-sm mb-2',
          style.header,
        ].join(' ')}
      >
        <div className="flex items-center justify-between px-3 py-2.5">
          <span className="text-sm font-semibold text-gray-700 dark:text-gray-300">{label}</span>
          <span className="text-xs text-gray-400 dark:text-gray-500 bg-gray-100 dark:bg-gray-800 rounded-full px-2 py-0.5 font-medium">
            {estimates.length}
          </span>
        </div>
      </div>

      <div
        onDragOver={(e) => onDragOver(e, status)}
        onDragLeave={onDragLeave}
        onDrop={(e) => onDrop(e, status)}
        className={[
          'flex flex-col gap-2 flex-1 min-h-[120px] rounded-xl p-1.5 transition-colors',
          isDragOver ? 'bg-primary/5 ring-2 ring-primary/20' : 'bg-transparent',
        ].join(' ')}
      >
        {estimates.map((est) => (
          <EstimateCard key={est.id} est={est} onDragStart={onDragStart} />
        ))}

        {estimates.length === 0 && !isDragOver && (
          <div className="flex items-center justify-center h-20 text-xs text-gray-300 dark:text-gray-600 border-2 border-dashed border-gray-100 dark:border-gray-800 rounded-lg">
            Drop here
          </div>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Inner page (uses useSearchParams — wrapped in Suspense below)
// ---------------------------------------------------------------------------

function EstimatesPipelineInner() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const clientFilter = searchParams.get('clientId') ?? '';

  const [board, setBoard] = useState<KanbanBoard>(emptyBoard);
  const [clients, setClients] = useState<ClientOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [dragOverStatus, setDragOverStatus] = useState<EstimateStatus | null>(null);
  const dragRef = useRef<{ id: string; from: EstimateStatus } | null>(null);

  const fetchEstimates = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const qs = new URLSearchParams({ limit: '500' });
      if (clientFilter) qs.set('clientId', clientFilter);
      const res = await apiFetch(`/api/v1/estimates?${qs.toString()}`);
      if (!res.ok) throw new Error(`Server responded with ${res.status}`);
      const json = await res.json();
      const rows: Estimate[] = json.data ?? [];

      const grouped = emptyBoard();
      for (const est of rows) {
        const s = est.status as EstimateStatus;
        if (grouped[s]) grouped[s].push(est);
        else grouped.draft.push(est);
      }
      setBoard(grouped);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load estimates');
    } finally {
      setLoading(false);
    }
  }, [clientFilter]);

  useEffect(() => {
    fetchEstimates();
  }, [fetchEstimates]);

  // Load client list once for the filter dropdown.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await apiFetch('/api/v1/clients?limit=500');
        if (!res.ok) return;
        const json = await res.json();
        const list: ClientOption[] = (json.data ?? []).map((c: any) => ({
          id: c.id,
          company: c.company ?? c.name ?? '—',
        }));
        if (!cancelled) setClients(list);
      } catch {
        // non-fatal
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  function handleDragStart(e: React.DragEvent, id: string, from: EstimateStatus) {
    dragRef.current = { id, from };
    e.dataTransfer.effectAllowed = 'move';
  }

  function handleDragOver(e: React.DragEvent, status: EstimateStatus) {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    setDragOverStatus(status);
  }

  function handleDragLeave() {
    setDragOverStatus(null);
  }

  async function handleDrop(e: React.DragEvent, toStatus: EstimateStatus) {
    e.preventDefault();
    setDragOverStatus(null);

    const drag = dragRef.current;
    if (!drag || drag.from === toStatus) return;

    const { id, from } = drag;
    dragRef.current = null;

    // Optimistic update
    setBoard((prev) => {
      const est = prev[from].find((t) => t.id === id);
      if (!est) return prev;
      return {
        ...prev,
        [from]: prev[from].filter((t) => t.id !== id),
        [toStatus]: [{ ...est, status: toStatus }, ...prev[toStatus]],
      };
    });

    const revert = () => {
      setBoard((prev) => {
        const est = prev[toStatus].find((t) => t.id === id);
        if (!est) return prev;
        return {
          ...prev,
          [toStatus]: prev[toStatus].filter((t) => t.id !== id),
          [from]: [{ ...est, status: from }, ...prev[from]],
        };
      });
    };

    try {
      const res = await changeEstimateStatus(id, toStatus);
      if (!res.ok) revert();
    } catch {
      revert();
    }
  }

  function handleClientFilterChange(value: string) {
    const params = new URLSearchParams(Array.from(searchParams.entries()));
    if (value) params.set('clientId', value);
    else params.delete('clientId');
    const qs = params.toString();
    router.replace(`/estimates/pipeline${qs ? `?${qs}` : ''}`);
  }

  const totals = useMemo(
    () =>
      COLUMNS.reduce(
        (acc, col) => {
          acc.total += board[col.status].length;
          return acc;
        },
        { total: 0 },
      ),
    [board],
  );

  return (
    <div className="flex flex-col h-full min-h-0">
      <PageHeader
        title="Estimates - Pipeline"
        subtitle={!loading ? (
          <>
            {totals.total} estimate{totals.total !== 1 ? 's' : ''}
            {' · '}
            {COLUMNS.map((c, i) => (
              <span key={c.status}>
                {c.label}: <span className="font-medium text-gray-700 dark:text-gray-300">{board[c.status].length}</span>
                {i < COLUMNS.length - 1 ? ' · ' : ''}
              </span>
            ))}
          </>
        ) : undefined}
        primaryAction={{ label: 'New Estimate', href: '/estimates/new' }}
        secondaryActions={[{ label: 'List view', href: '/estimates' }]}
        className="flex-shrink-0"
      >
        <select
          aria-label="Filter by client"
          value={clientFilter}
          onChange={(e) => handleClientFilterChange(e.target.value)}
          className={`${inputClass} w-auto`}
        >
          <option value="">All clients</option>
          {clients.map((c) => (
            <option key={c.id} value={c.id}>
              {c.company}
            </option>
          ))}
        </select>
      </PageHeader>

      {error && (
        <div className="mb-4 flex-shrink-0">
          <ErrorBanner message={error} />
        </div>
      )}

      <div className="flex-1 overflow-x-auto pb-4">
        <div className="flex gap-3 h-full min-w-max">
          {loading
            ? COLUMNS.map((col) => (
                <div key={col.status} className="flex flex-col min-w-[240px] w-[240px] flex-shrink-0">
                  <div className="bg-white dark:bg-gray-900 rounded-xl border border-gray-100 dark:border-gray-800 border-t-4 border-t-gray-200 shadow-sm mb-2 px-3 py-2.5 flex items-center justify-between">
                    <span className="text-sm font-semibold text-gray-300 dark:text-gray-600">{col.label}</span>
                  </div>
                  <div className="flex flex-col gap-2 p-1.5">
                    {[1, 2].map((i) => (
                      <div key={i} className="bg-white dark:bg-gray-900 border border-gray-100 dark:border-gray-800 rounded-lg p-3 shadow-sm animate-pulse">
                        <div className="h-3.5 bg-gray-100 dark:bg-gray-800 rounded w-3/4 mb-2" />
                        <div className="h-3 bg-gray-100 dark:bg-gray-800 rounded w-1/2 mb-3" />
                        <div className="h-3 bg-gray-100 dark:bg-gray-800 rounded w-1/4" />
                      </div>
                    ))}
                  </div>
                </div>
              ))
            : COLUMNS.map((col) => (
                <KanbanColumn
                  key={col.status}
                  status={col.status}
                  label={col.label}
                  estimates={board[col.status]}
                  isDragOver={dragOverStatus === col.status}
                  onDragStart={handleDragStart}
                  onDragOver={handleDragOver}
                  onDragLeave={handleDragLeave}
                  onDrop={handleDrop}
                />
              ))}
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Exported page (Suspense boundary for useSearchParams)
// ---------------------------------------------------------------------------

export default function EstimatesPipelinePage() {
  return (
    <Suspense
      fallback={
        <div className="flex items-center justify-center h-full text-sm text-gray-400 dark:text-gray-500">
          Loading pipeline…
        </div>
      }
    >
      <EstimatesPipelineInner />
    </Suspense>
  );
}
