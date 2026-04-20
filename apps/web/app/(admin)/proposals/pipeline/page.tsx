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

// NOTE: The Prisma schema comment lists `revised`, but the service/getStats
// actually persist and count the status `revising`. We accept both on input
// and render them into the same "Revising" column.
type ProposalStatus =
  | 'draft'
  | 'sent'
  | 'open'
  | 'revising'
  | 'declined'
  | 'accepted';

interface Proposal {
  id: string;
  subject: string;
  status: ProposalStatus | string;
  total: number | string | null;
  currency?: string | null;
  openTill?: string | null;
  signedAt?: string | null;
  clientId?: string | null;
  client?: { id: string; company: string } | null;
}

interface ClientOption {
  id: string;
  company: string;
}

type KanbanBoard = Record<ProposalStatus, Proposal[]>;

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const COLUMNS: { status: ProposalStatus; label: string }[] = [
  { status: 'draft',    label: 'Draft' },
  { status: 'sent',     label: 'Sent' },
  { status: 'open',     label: 'Open' },
  { status: 'revising', label: 'Revising' },
  { status: 'declined', label: 'Declined' },
  { status: 'accepted', label: 'Accepted' },
];

const STATUS_STYLES: Record<ProposalStatus, { header: string }> = {
  draft:    { header: 'border-t-gray-400' },
  sent:     { header: 'border-t-blue-400' },
  open:     { header: 'border-t-indigo-400' },
  revising: { header: 'border-t-yellow-400' },
  declined: { header: 'border-t-red-400' },
  accepted: { header: 'border-t-green-400' },
};

const emptyBoard = (): KanbanBoard => ({
  draft: [],
  sent: [],
  open: [],
  revising: [],
  declined: [],
  accepted: [],
});

const KNOWN_STATUSES: readonly string[] = [
  'draft',
  'sent',
  'open',
  'declined',
  'accepted',
];

// Map any inbound backend status value into one of our column keys.
function normalizeStatus(raw: string | null | undefined): ProposalStatus {
  const s = (raw ?? '').toLowerCase();
  if (s === 'revised' || s === 'revising') return 'revising';
  if (KNOWN_STATUSES.includes(s)) return s as ProposalStatus;
  return 'draft';
}

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

function formatOpenTill(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
}

// Map a drag transition to a backend call. All drops hit the dedicated
// PATCH /:id/status endpoint which accepts any valid status (including
// both `revised` and `revising`) and has no side-effects. Dedicated
// send/accept/decline routes remain reserved for explicit UI actions.
async function changeProposalStatus(id: string, to: ProposalStatus): Promise<Response> {
  return apiFetch(`/api/v1/proposals/${id}/status`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ status: to }),
  });
}

// ---------------------------------------------------------------------------
// Card
// ---------------------------------------------------------------------------

function ProposalCard({
  proposal,
  onDragStart,
}: {
  proposal: Proposal;
  onDragStart: (e: React.DragEvent, id: string, from: ProposalStatus) => void;
}) {
  const from = normalizeStatus(proposal.status as string);
  const openTill = formatOpenTill(proposal.openTill);

  return (
    <div
      draggable
      onDragStart={(e) => onDragStart(e, proposal.id, from)}
      className="group bg-white dark:bg-gray-900 border border-gray-100 dark:border-gray-800 rounded-lg p-3 shadow-sm cursor-grab active:cursor-grabbing hover:shadow-md hover:border-gray-200 transition-all select-none"
    >
      <div className="flex items-start justify-between gap-2 mb-1">
        <Link
          href={`/proposals/${proposal.id}`}
          className="text-sm font-medium text-gray-900 dark:text-gray-100 hover:text-primary leading-snug line-clamp-2"
          onClick={(e) => e.stopPropagation()}
        >
          {proposal.subject}
        </Link>
        {proposal.signedAt && (
          <span
            className="text-[10px] font-semibold px-1.5 py-0.5 rounded bg-emerald-50 text-emerald-700 shrink-0"
            title={`Signed at ${proposal.signedAt}`}
          >
            signed
          </span>
        )}
      </div>

      {proposal.client?.company && (
        <p className="text-xs text-gray-400 dark:text-gray-500 mb-2 truncate">{proposal.client.company}</p>
      )}

      <div className="flex items-center justify-between mt-2 gap-2">
        <span className="text-xs font-semibold text-gray-700 dark:text-gray-300 tabular-nums truncate">
          {formatMoney(proposal.total, proposal.currency)}
        </span>
        {openTill && (
          <span className="text-[10px] text-gray-400 dark:text-gray-500 shrink-0" title={`Open till ${openTill}`}>
            {openTill}
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
  proposals,
  isDragOver,
  onDragStart,
  onDragOver,
  onDragLeave,
  onDrop,
}: {
  status: ProposalStatus;
  label: string;
  proposals: Proposal[];
  isDragOver: boolean;
  onDragStart: (e: React.DragEvent, id: string, from: ProposalStatus) => void;
  onDragOver: (e: React.DragEvent, status: ProposalStatus) => void;
  onDragLeave: () => void;
  onDrop: (e: React.DragEvent, toStatus: ProposalStatus) => void;
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
            {proposals.length}
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
        {proposals.map((p) => (
          <ProposalCard key={p.id} proposal={p} onDragStart={onDragStart} />
        ))}

        {proposals.length === 0 && !isDragOver && (
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

function ProposalsPipelineInner() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const clientFilter = searchParams.get('clientId') ?? '';

  const [board, setBoard] = useState<KanbanBoard>(emptyBoard);
  const [clients, setClients] = useState<ClientOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [dragOverStatus, setDragOverStatus] = useState<ProposalStatus | null>(null);
  const dragRef = useRef<{ id: string; from: ProposalStatus } | null>(null);

  const fetchProposals = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      // The proposals list endpoint does not support a clientId filter server-side,
      // so we filter client-side after fetching.
      const res = await apiFetch(`/api/v1/proposals?limit=500`);
      if (!res.ok) throw new Error(`Server responded with ${res.status}`);
      const json = await res.json();
      const rows: Proposal[] = json.data ?? [];

      const filtered = clientFilter
        ? rows.filter((p) => p.clientId === clientFilter || p.client?.id === clientFilter)
        : rows;

      const grouped = emptyBoard();
      for (const p of filtered) {
        const s = normalizeStatus(p.status as string);
        grouped[s].push(p);
      }
      setBoard(grouped);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load proposals');
    } finally {
      setLoading(false);
    }
  }, [clientFilter]);

  useEffect(() => {
    fetchProposals();
  }, [fetchProposals]);

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

  function handleDragStart(e: React.DragEvent, id: string, from: ProposalStatus) {
    dragRef.current = { id, from };
    e.dataTransfer.effectAllowed = 'move';
  }

  function handleDragOver(e: React.DragEvent, status: ProposalStatus) {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    setDragOverStatus(status);
  }

  function handleDragLeave() {
    setDragOverStatus(null);
  }

  async function handleDrop(e: React.DragEvent, toStatus: ProposalStatus) {
    e.preventDefault();
    setDragOverStatus(null);

    const drag = dragRef.current;
    if (!drag || drag.from === toStatus) return;

    const { id, from } = drag;
    dragRef.current = null;

    // Optimistic update
    setBoard((prev) => {
      const p = prev[from].find((t) => t.id === id);
      if (!p) return prev;
      return {
        ...prev,
        [from]: prev[from].filter((t) => t.id !== id),
        [toStatus]: [{ ...p, status: toStatus }, ...prev[toStatus]],
      };
    });

    const revert = () => {
      setBoard((prev) => {
        const p = prev[toStatus].find((t) => t.id === id);
        if (!p) return prev;
        return {
          ...prev,
          [toStatus]: prev[toStatus].filter((t) => t.id !== id),
          [from]: [{ ...p, status: from }, ...prev[from]],
        };
      });
    };

    try {
      const res = await changeProposalStatus(id, toStatus);
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
    router.replace(`/proposals/pipeline${qs ? `?${qs}` : ''}`);
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
        title="Proposals - Pipeline"
        subtitle={!loading ? (
          <>
            {totals.total} proposal{totals.total !== 1 ? 's' : ''}
            {' · '}
            {COLUMNS.map((c, i) => (
              <span key={c.status}>
                {c.label}: <span className="font-medium text-gray-700 dark:text-gray-300">{board[c.status].length}</span>
                {i < COLUMNS.length - 1 ? ' · ' : ''}
              </span>
            ))}
          </>
        ) : undefined}
        primaryAction={{ label: 'New Proposal', href: '/proposals/new' }}
        secondaryActions={[{ label: 'List view', href: '/proposals' }]}
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
                  proposals={board[col.status]}
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

export default function ProposalsPipelinePage() {
  return (
    <Suspense
      fallback={
        <div className="flex items-center justify-center h-full text-sm text-gray-400 dark:text-gray-500">
          Loading pipeline…
        </div>
      }
    >
      <ProposalsPipelineInner />
    </Suspense>
  );
}
