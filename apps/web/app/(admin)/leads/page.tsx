'use client';

import { useState, useEffect, useRef } from 'react';
import Link from 'next/link';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type LeadStatus =
  | 'new'
  | 'contacted'
  | 'qualified'
  | 'proposal'
  | 'negotiation'
  | 'won'
  | 'lost';

interface Lead {
  id: string;
  name: string;
  company: string | null;
  budget: number | null;
  currency: string | null;
  assigned_to: string | null; // full name — we'll derive initials
  status: LeadStatus;
}

type KanbanBoard = Record<LeadStatus, Lead[]>;

interface KanbanResponse {
  data: KanbanBoard;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001';

const COLUMNS: { status: LeadStatus; label: string }[] = [
  { status: 'new',         label: 'New' },
  { status: 'contacted',   label: 'Contacted' },
  { status: 'qualified',   label: 'Qualified' },
  { status: 'proposal',    label: 'Proposal' },
  { status: 'negotiation', label: 'Negotiation' },
  { status: 'won',         label: 'Won' },
  { status: 'lost',        label: 'Lost' },
];

const STATUS_STYLES: Record<LeadStatus, { header: string; badge: string; dot: string }> = {
  new:         { header: 'border-t-blue-400',   badge: 'bg-blue-50 text-blue-700',     dot: 'bg-blue-400' },
  contacted:   { header: 'border-t-yellow-400', badge: 'bg-yellow-50 text-yellow-700', dot: 'bg-yellow-400' },
  qualified:   { header: 'border-t-orange-400', badge: 'bg-orange-50 text-orange-700', dot: 'bg-orange-400' },
  proposal:    { header: 'border-t-purple-400', badge: 'bg-purple-50 text-purple-700', dot: 'bg-purple-400' },
  negotiation: { header: 'border-t-indigo-400', badge: 'bg-indigo-50 text-indigo-700', dot: 'bg-indigo-400' },
  won:         { header: 'border-t-green-400',  badge: 'bg-green-50 text-green-700',   dot: 'bg-green-400' },
  lost:        { header: 'border-t-red-400',    badge: 'bg-red-50 text-red-700',       dot: 'bg-red-400' },
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function getToken(): string | null {
  if (typeof window === 'undefined') return null;
  return localStorage.getItem('access_token');
}

function initials(name: string | null): string {
  if (!name) return '?';
  return name
    .split(' ')
    .map((w) => w[0]?.toUpperCase() ?? '')
    .slice(0, 2)
    .join('');
}

function formatBudget(amount: number, currency: string | null): string {
  try {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: currency ?? 'USD',
      maximumFractionDigits: 0,
    }).format(amount);
  } catch {
    return `${currency ?? '$'}${amount.toLocaleString()}`;
  }
}

// ---------------------------------------------------------------------------
// Lead card
// ---------------------------------------------------------------------------

interface LeadCardProps {
  lead: Lead;
  onDragStart: (e: React.DragEvent, leadId: string, fromStatus: LeadStatus) => void;
}

function LeadCard({ lead, onDragStart }: LeadCardProps) {
  const style = STATUS_STYLES[lead.status];

  return (
    <div
      draggable
      onDragStart={(e) => onDragStart(e, lead.id, lead.status)}
      className="group bg-white border border-gray-100 rounded-lg p-3 shadow-sm cursor-grab active:cursor-grabbing hover:shadow-md hover:border-gray-200 transition-all select-none"
    >
      {/* Name + link */}
      <div className="flex items-start justify-between gap-2 mb-1">
        <Link
          href={`/leads/${lead.id}`}
          className="text-sm font-medium text-gray-900 hover:text-primary leading-snug line-clamp-2"
          onClick={(e) => e.stopPropagation()}
        >
          {lead.name}
        </Link>
        <span
          className={`shrink-0 inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-semibold ${style.badge}`}
        >
          <span className={`w-1.5 h-1.5 rounded-full mr-1 ${style.dot}`} />
          {COLUMNS.find((c) => c.status === lead.status)?.label}
        </span>
      </div>

      {/* Company */}
      {lead.company && (
        <p className="text-xs text-gray-400 mb-2 truncate">{lead.company}</p>
      )}

      {/* Footer: budget + avatar */}
      <div className="flex items-center justify-between mt-2">
        {lead.budget != null ? (
          <span className="text-xs font-semibold text-gray-700">
            {formatBudget(lead.budget, lead.currency)}
          </span>
        ) : (
          <span />
        )}

        {lead.assigned_to && (
          <div
            title={lead.assigned_to}
            className="w-6 h-6 rounded-full bg-primary/10 text-primary text-[10px] font-bold flex items-center justify-center"
          >
            {initials(lead.assigned_to)}
          </div>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Kanban column
// ---------------------------------------------------------------------------

interface ColumnProps {
  status: LeadStatus;
  label: string;
  leads: Lead[];
  isDragOver: boolean;
  onDragStart: (e: React.DragEvent, leadId: string, fromStatus: LeadStatus) => void;
  onDragOver: (e: React.DragEvent, status: LeadStatus) => void;
  onDragLeave: () => void;
  onDrop: (e: React.DragEvent, toStatus: LeadStatus) => void;
}

function KanbanColumn({
  status,
  label,
  leads,
  isDragOver,
  onDragStart,
  onDragOver,
  onDragLeave,
  onDrop,
}: ColumnProps) {
  const style = STATUS_STYLES[status];

  return (
    <div className="flex flex-col min-w-[220px] w-[220px] flex-shrink-0">
      {/* Column header */}
      <div
        className={[
          'bg-white rounded-xl border border-gray-100 border-t-4 shadow-sm mb-2',
          style.header,
        ].join(' ')}
      >
        <div className="flex items-center justify-between px-3 py-2.5">
          <span className="text-sm font-semibold text-gray-700">{label}</span>
          <span className="text-xs text-gray-400 bg-gray-100 rounded-full px-2 py-0.5 font-medium">
            {leads.length}
          </span>
        </div>
      </div>

      {/* Drop zone */}
      <div
        onDragOver={(e) => onDragOver(e, status)}
        onDragLeave={onDragLeave}
        onDrop={(e) => onDrop(e, status)}
        className={[
          'flex flex-col gap-2 flex-1 min-h-[120px] rounded-xl p-1.5 transition-colors',
          isDragOver ? 'bg-primary/5 ring-2 ring-primary/20' : 'bg-transparent',
        ].join(' ')}
      >
        {leads.map((lead) => (
          <LeadCard key={lead.id} lead={lead} onDragStart={onDragStart} />
        ))}

        {leads.length === 0 && !isDragOver && (
          <div className="flex items-center justify-center h-20 text-xs text-gray-300 border-2 border-dashed border-gray-100 rounded-lg">
            Drop here
          </div>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Skeleton column
// ---------------------------------------------------------------------------

function SkeletonColumn({ label }: { label: string }) {
  return (
    <div className="flex flex-col min-w-[220px] w-[220px] flex-shrink-0">
      <div className="bg-white rounded-xl border border-gray-100 border-t-4 border-t-gray-200 shadow-sm mb-2 px-3 py-2.5 flex items-center justify-between">
        <span className="text-sm font-semibold text-gray-300">{label}</span>
        <span className="text-xs text-gray-300 bg-gray-50 rounded-full px-2 py-0.5">—</span>
      </div>
      <div className="flex flex-col gap-2 p-1.5">
        {Array.from({ length: Math.floor(Math.random() * 2) + 1 }).map((_, i) => (
          <div key={i} className="bg-white border border-gray-100 rounded-lg p-3 shadow-sm animate-pulse">
            <div className="h-3.5 bg-gray-100 rounded w-3/4 mb-2" />
            <div className="h-3 bg-gray-100 rounded w-1/2 mb-3" />
            <div className="h-3 bg-gray-100 rounded w-1/4" />
          </div>
        ))}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default function LeadsPage() {
  const [view, setView] = useState<'kanban' | 'list'>('kanban');
  const [board, setBoard] = useState<KanbanBoard>({
    new: [], contacted: [], qualified: [], proposal: [],
    negotiation: [], won: [], lost: [],
  });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [dragOverStatus, setDragOverStatus] = useState<LeadStatus | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulkLoading, setBulkLoading] = useState(false);

  // Store dragged lead info in a ref to avoid stale closures
  const dragRef = useRef<{ leadId: string; fromStatus: LeadStatus } | null>(null);

  // ------------------------------------------------------------------
  // Fetch
  // ------------------------------------------------------------------

  useEffect(() => {
    async function fetchBoard() {
      setLoading(true);
      setError(null);
      try {
        const token = getToken();
        const res = await fetch(`${API_BASE}/api/v1/leads/kanban`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (!res.ok) throw new Error(`Server responded with ${res.status}`);
        const json: KanbanResponse = await res.json();
        // Ensure all status keys exist even if the API omits empty ones
        const safeBoard: KanbanBoard = {
          new: [], contacted: [], qualified: [], proposal: [],
          negotiation: [], won: [], lost: [], ...json.data,
        };
        setBoard(safeBoard);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load leads');
      } finally {
        setLoading(false);
      }
    }
    fetchBoard();
  }, []);

  // ------------------------------------------------------------------
  // Drag & drop handlers
  // ------------------------------------------------------------------

  function handleDragStart(e: React.DragEvent, leadId: string, fromStatus: LeadStatus) {
    dragRef.current = { leadId, fromStatus };
    e.dataTransfer.effectAllowed = 'move';
  }

  function handleDragOver(e: React.DragEvent, status: LeadStatus) {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    setDragOverStatus(status);
  }

  function handleDragLeave() {
    setDragOverStatus(null);
  }

  async function handleDrop(e: React.DragEvent, toStatus: LeadStatus) {
    e.preventDefault();
    setDragOverStatus(null);

    const drag = dragRef.current;
    if (!drag || drag.fromStatus === toStatus) return;

    const { leadId, fromStatus } = drag;
    dragRef.current = null;

    // Optimistic UI update
    setBoard((prev) => {
      const lead = prev[fromStatus].find((l) => l.id === leadId);
      if (!lead) return prev;
      return {
        ...prev,
        [fromStatus]: prev[fromStatus].filter((l) => l.id !== leadId),
        [toStatus]: [{ ...lead, status: toStatus }, ...prev[toStatus]],
      };
    });

    // Persist to API
    try {
      const token = getToken();
      const res = await fetch(`${API_BASE}/api/v1/leads/${leadId}/status`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ status: toStatus }),
      });

      if (!res.ok) {
        // Roll back optimistic update on failure
        setBoard((prev) => {
          const lead = prev[toStatus].find((l) => l.id === leadId);
          if (!lead) return prev;
          return {
            ...prev,
            [toStatus]: prev[toStatus].filter((l) => l.id !== leadId),
            [fromStatus]: [{ ...lead, status: fromStatus }, ...prev[fromStatus]],
          };
        });
      }
    } catch {
      // Network error — roll back
      setBoard((prev) => {
        const lead = prev[toStatus].find((l) => l.id === leadId);
        if (!lead) return prev;
        return {
          ...prev,
          [toStatus]: prev[toStatus].filter((l) => l.id !== leadId),
          [fromStatus]: [{ ...lead, status: fromStatus }, ...prev[fromStatus]],
        };
      });
    }
  }

  const totalLeads = Object.values(board).reduce((acc, col) => acc + col.length, 0);
  const allLeads = Object.values(board).flat();

  const toggleSelect = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleAll = () => {
    if (selected.size === allLeads.length) {
      setSelected(new Set());
    } else {
      setSelected(new Set(allLeads.map((l) => l.id)));
    }
  };

  const bulkDeleteLeads = async () => {
    if (!confirm(`Delete ${selected.size} lead(s)?`)) return;
    setBulkLoading(true);
    const token = getToken();
    for (const id of selected) {
      await fetch(`${API_BASE}/api/v1/leads/${id}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` },
      }).catch(() => {});
    }
    setSelected(new Set());
    setBulkLoading(false);
    // re-fetch
    window.location.reload();
  };

  const bulkChangeStatus = async (newStatus: LeadStatus) => {
    setBulkLoading(true);
    const token = getToken();
    for (const id of selected) {
      await fetch(`${API_BASE}/api/v1/leads/${id}/status`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ status: newStatus }),
      }).catch(() => {});
    }
    setSelected(new Set());
    setBulkLoading(false);
    window.location.reload();
  };

  return (
    <div className="flex flex-col h-full min-h-0">
      {/* ------------------------------------------------------------------ */}
      {/* Header                                                               */}
      {/* ------------------------------------------------------------------ */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mb-6 flex-shrink-0">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Leads</h1>
          {!loading && (
            <p className="text-sm text-gray-500 mt-0.5">
              {totalLeads} lead{totalLeads !== 1 ? 's' : ''} in pipeline
            </p>
          )}
        </div>
        <div className="flex items-center gap-2">
          <div className="inline-flex rounded-lg border border-gray-200 overflow-hidden">
            <button
              onClick={() => setView('kanban')}
              className={`px-3 py-2 text-xs font-medium transition-colors ${
                view === 'kanban' ? 'bg-primary text-white' : 'bg-white text-gray-600 hover:bg-gray-50'
              }`}
            >
              Kanban
            </button>
            <button
              onClick={() => setView('list')}
              className={`px-3 py-2 text-xs font-medium transition-colors ${
                view === 'list' ? 'bg-primary text-white' : 'bg-white text-gray-600 hover:bg-gray-50'
              }`}
            >
              List
            </button>
          </div>
          <Link
            href="/leads/import"
            className="inline-flex items-center gap-1.5 border border-gray-200 text-gray-700 text-sm font-medium px-4 py-2 rounded-lg hover:bg-gray-50 transition-colors"
          >
            Import CSV
          </Link>
          <Link
            href="/leads/new"
            className="inline-flex items-center gap-1.5 bg-primary text-white text-sm font-medium px-4 py-2 rounded-lg hover:bg-primary/90 transition-colors"
          >
            <span className="text-lg leading-none">+</span>
            New Lead
          </Link>
        </div>
      </div>

      {/* ------------------------------------------------------------------ */}
      {/* Error banner                                                         */}
      {/* ------------------------------------------------------------------ */}
      {error && (
        <div className="mb-4 px-4 py-3 bg-red-50 border border-red-100 rounded-lg text-sm text-red-600 flex-shrink-0">
          {error}
        </div>
      )}

      {/* ------------------------------------------------------------------ */}
      {/* Board (Kanban view)                                                  */}
      {/* ------------------------------------------------------------------ */}
      {view === 'kanban' && (
        <div className="flex-1 overflow-x-auto pb-4">
          <div className="flex gap-3 h-full min-w-max">
            {loading
              ? COLUMNS.map((col) => <SkeletonColumn key={col.status} label={col.label} />)
              : COLUMNS.map((col) => (
                  <KanbanColumn
                    key={col.status}
                    status={col.status}
                    label={col.label}
                    leads={board[col.status]}
                    isDragOver={dragOverStatus === col.status}
                    onDragStart={handleDragStart}
                    onDragOver={handleDragOver}
                    onDragLeave={handleDragLeave}
                    onDrop={handleDrop}
                  />
                ))}
          </div>
        </div>
      )}

      {/* ------------------------------------------------------------------ */}
      {/* List view                                                            */}
      {/* ------------------------------------------------------------------ */}
      {view === 'list' && (
        <div className="bg-white rounded-xl border border-gray-100 shadow-sm overflow-hidden">
          <div className="overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead>
                <tr className="bg-gray-50 border-b border-gray-100 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide">
                  <th className="px-4 py-3 w-10">
                    <input
                      type="checkbox"
                      checked={allLeads.length > 0 && selected.size === allLeads.length}
                      onChange={toggleAll}
                      className="w-4 h-4 rounded border-gray-300 text-primary focus:ring-primary/30"
                    />
                  </th>
                  <th className="px-4 py-3">Name</th>
                  <th className="px-4 py-3">Company</th>
                  <th className="px-4 py-3">Status</th>
                  <th className="px-4 py-3">Budget</th>
                  <th className="px-4 py-3">Assigned To</th>
                  <th className="px-4 py-3 text-right">Actions</th>
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  <tr>
                    <td colSpan={7} className="px-4 py-10 text-center text-gray-400">
                      Loading...
                    </td>
                  </tr>
                ) : allLeads.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="px-4 py-10 text-center text-gray-400">
                      No leads found
                    </td>
                  </tr>
                ) : (
                  allLeads.map((lead) => {
                    const style = STATUS_STYLES[lead.status];
                    return (
                      <tr
                        key={lead.id}
                        className="border-b border-gray-100 last:border-0 hover:bg-gray-50/60 transition-colors"
                      >
                        <td className="px-4 py-3">
                          <input
                            type="checkbox"
                            checked={selected.has(lead.id)}
                            onChange={() => toggleSelect(lead.id)}
                            className="w-4 h-4 rounded border-gray-300 text-primary focus:ring-primary/30"
                          />
                        </td>
                        <td className="px-4 py-3 font-medium text-gray-900">
                          <Link href={`/leads/${lead.id}`} className="hover:text-primary">
                            {lead.name}
                          </Link>
                        </td>
                        <td className="px-4 py-3 text-gray-500">{lead.company ?? '—'}</td>
                        <td className="px-4 py-3">
                          <span
                            className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${style.badge}`}
                          >
                            <span className={`w-1.5 h-1.5 rounded-full mr-1 ${style.dot}`} />
                            {COLUMNS.find((c) => c.status === lead.status)?.label}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-gray-600">
                          {lead.budget != null
                            ? formatBudget(lead.budget, lead.currency)
                            : '—'}
                        </td>
                        <td className="px-4 py-3 text-gray-500">{lead.assigned_to ?? '—'}</td>
                        <td className="px-4 py-3 text-right">
                          <Link
                            href={`/leads/${lead.id}`}
                            className="text-xs text-gray-500 hover:text-primary font-medium"
                          >
                            View
                          </Link>
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Bulk action bar */}
      {selected.size > 0 && view === 'list' && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 bg-gray-900 text-white rounded-xl shadow-2xl px-5 py-3 flex items-center gap-4 text-sm">
          <span className="font-medium">{selected.size} selected</span>
          <div className="w-px h-5 bg-gray-600" />
          <button
            onClick={bulkDeleteLeads}
            disabled={bulkLoading}
            className="px-3 py-1.5 rounded-lg bg-red-600 hover:bg-red-700 text-white text-xs font-medium disabled:opacity-50 transition-colors"
          >
            Delete
          </button>
          <select
            onChange={(e) => {
              if (e.target.value) bulkChangeStatus(e.target.value as LeadStatus);
            }}
            disabled={bulkLoading}
            defaultValue=""
            className="px-3 py-1.5 rounded-lg bg-gray-700 text-white text-xs font-medium border-none cursor-pointer disabled:opacity-50"
          >
            <option value="" disabled>Change Status</option>
            {COLUMNS.map((c) => (
              <option key={c.status} value={c.status}>{c.label}</option>
            ))}
          </select>
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
