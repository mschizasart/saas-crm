'use client';

import { useState, useEffect, useRef } from 'react';
import Link from 'next/link';
import { PageHeader } from '@/components/ui/page-header';
import { ErrorBanner } from '@/components/ui/error-banner';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type TicketStatus = 'open' | 'in_progress' | 'answered' | 'on_hold' | 'closed';

interface Ticket {
  id: string;
  subject: string;
  client?: { id: string; company: string } | null;
  priority: string;
  status: TicketStatus;
  assignedTo?: string | null;
}

type KanbanBoard = Record<TicketStatus, Ticket[]>;

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001';

const COLUMNS: { status: TicketStatus; label: string }[] = [
  { status: 'open',        label: 'Open' },
  { status: 'in_progress', label: 'In Progress' },
  { status: 'answered',    label: 'Answered' },
  { status: 'on_hold',     label: 'On Hold' },
  { status: 'closed',      label: 'Closed' },
];

const STATUS_STYLES: Record<TicketStatus, { header: string; badge: string; dot: string }> = {
  open:        { header: 'border-t-blue-400',   badge: 'bg-blue-50 text-blue-700',     dot: 'bg-blue-400' },
  in_progress: { header: 'border-t-indigo-400', badge: 'bg-indigo-50 text-indigo-700', dot: 'bg-indigo-400' },
  answered:    { header: 'border-t-green-400',  badge: 'bg-green-50 text-green-700',   dot: 'bg-green-400' },
  on_hold:     { header: 'border-t-yellow-400', badge: 'bg-yellow-50 text-yellow-700', dot: 'bg-yellow-400' },
  closed:      { header: 'border-t-gray-400',   badge: 'bg-gray-50 text-gray-700',     dot: 'bg-gray-400' },
};

const PRIORITY_COLORS: Record<string, string> = {
  low: 'bg-gray-100 text-gray-600',
  medium: 'bg-blue-100 text-blue-700',
  high: 'bg-orange-100 text-orange-700',
  urgent: 'bg-red-100 text-red-600',
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

// ---------------------------------------------------------------------------
// Ticket card
// ---------------------------------------------------------------------------

function TicketCard({
  ticket,
  onDragStart,
}: {
  ticket: Ticket;
  onDragStart: (e: React.DragEvent, ticketId: string, fromStatus: TicketStatus) => void;
}) {
  return (
    <div
      draggable
      onDragStart={(e) => onDragStart(e, ticket.id, ticket.status)}
      className="group bg-white dark:bg-gray-900 border border-gray-100 dark:border-gray-800 rounded-lg p-3 shadow-sm cursor-grab active:cursor-grabbing hover:shadow-md hover:border-gray-200 transition-all select-none"
    >
      <div className="flex items-start justify-between gap-2 mb-1">
        <Link
          href={`/tickets/${ticket.id}`}
          className="text-sm font-medium text-gray-900 dark:text-gray-100 hover:text-primary leading-snug line-clamp-2"
          onClick={(e) => e.stopPropagation()}
        >
          {ticket.subject}
        </Link>
      </div>

      {ticket.client?.company && (
        <p className="text-xs text-gray-400 dark:text-gray-500 mb-2 truncate">{ticket.client.company}</p>
      )}

      <div className="flex items-center justify-between mt-2">
        <span
          className={`text-[10px] font-semibold px-1.5 py-0.5 rounded ${
            PRIORITY_COLORS[ticket.priority] ?? 'bg-gray-100 text-gray-500'
          }`}
        >
          {ticket.priority}
        </span>

        {ticket.assignedTo && (
          <div
            title={ticket.assignedTo}
            className="w-6 h-6 rounded-full bg-primary/10 text-primary text-[10px] font-bold flex items-center justify-center"
          >
            {initials(ticket.assignedTo)}
          </div>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Kanban column
// ---------------------------------------------------------------------------

function KanbanColumn({
  status,
  label,
  tickets,
  isDragOver,
  onDragStart,
  onDragOver,
  onDragLeave,
  onDrop,
}: {
  status: TicketStatus;
  label: string;
  tickets: Ticket[];
  isDragOver: boolean;
  onDragStart: (e: React.DragEvent, ticketId: string, fromStatus: TicketStatus) => void;
  onDragOver: (e: React.DragEvent, status: TicketStatus) => void;
  onDragLeave: () => void;
  onDrop: (e: React.DragEvent, toStatus: TicketStatus) => void;
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
            {tickets.length}
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
        {tickets.map((ticket) => (
          <TicketCard key={ticket.id} ticket={ticket} onDragStart={onDragStart} />
        ))}

        {tickets.length === 0 && !isDragOver && (
          <div className="flex items-center justify-center h-20 text-xs text-gray-300 dark:text-gray-600 border-2 border-dashed border-gray-100 dark:border-gray-800 rounded-lg">
            Drop here
          </div>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default function TicketsKanbanPage() {
  const [board, setBoard] = useState<KanbanBoard>({
    open: [],
    in_progress: [],
    answered: [],
    on_hold: [],
    closed: [],
  });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [dragOverStatus, setDragOverStatus] = useState<TicketStatus | null>(null);
  const dragRef = useRef<{ ticketId: string; fromStatus: TicketStatus } | null>(null);

  useEffect(() => {
    async function fetchTickets() {
      setLoading(true);
      setError(null);
      try {
        const token = getToken();
        const res = await fetch(`${API_BASE}/api/v1/tickets?limit=200`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (!res.ok) throw new Error(`Server responded with ${res.status}`);
        const json = await res.json();
        const tickets: Ticket[] = json.data ?? [];

        const grouped: KanbanBoard = {
          open: [],
          in_progress: [],
          answered: [],
          on_hold: [],
          closed: [],
        };
        for (const t of tickets) {
          const s = t.status as TicketStatus;
          if (grouped[s]) grouped[s].push(t);
          else grouped.open.push(t);
        }
        setBoard(grouped);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load tickets');
      } finally {
        setLoading(false);
      }
    }
    fetchTickets();
  }, []);

  function handleDragStart(e: React.DragEvent, ticketId: string, fromStatus: TicketStatus) {
    dragRef.current = { ticketId, fromStatus };
    e.dataTransfer.effectAllowed = 'move';
  }

  function handleDragOver(e: React.DragEvent, status: TicketStatus) {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    setDragOverStatus(status);
  }

  function handleDragLeave() {
    setDragOverStatus(null);
  }

  async function handleDrop(e: React.DragEvent, toStatus: TicketStatus) {
    e.preventDefault();
    setDragOverStatus(null);

    const drag = dragRef.current;
    if (!drag || drag.fromStatus === toStatus) return;

    const { ticketId, fromStatus } = drag;
    dragRef.current = null;

    // Optimistic update
    setBoard((prev) => {
      const ticket = prev[fromStatus].find((t) => t.id === ticketId);
      if (!ticket) return prev;
      return {
        ...prev,
        [fromStatus]: prev[fromStatus].filter((t) => t.id !== ticketId),
        [toStatus]: [{ ...ticket, status: toStatus }, ...prev[toStatus]],
      };
    });

    try {
      const token = getToken();
      const res = await fetch(`${API_BASE}/api/v1/tickets/${ticketId}/status`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ status: toStatus }),
      });

      if (!res.ok) {
        setBoard((prev) => {
          const ticket = prev[toStatus].find((t) => t.id === ticketId);
          if (!ticket) return prev;
          return {
            ...prev,
            [toStatus]: prev[toStatus].filter((t) => t.id !== ticketId),
            [fromStatus]: [{ ...ticket, status: fromStatus }, ...prev[fromStatus]],
          };
        });
      }
    } catch {
      setBoard((prev) => {
        const ticket = prev[toStatus].find((t) => t.id === ticketId);
        if (!ticket) return prev;
        return {
          ...prev,
          [toStatus]: prev[toStatus].filter((t) => t.id !== ticketId),
          [fromStatus]: [{ ...ticket, status: fromStatus }, ...prev[fromStatus]],
        };
      });
    }
  }

  const totalTickets = Object.values(board).reduce((acc, col) => acc + col.length, 0);

  return (
    <div className="flex flex-col h-full min-h-0">
      <PageHeader
        title="Tickets - Kanban"
        subtitle={!loading ? `${totalTickets} ticket${totalTickets !== 1 ? 's' : ''}` : undefined}
        primaryAction={{ label: 'New Ticket', href: '/tickets/new' }}
        secondaryActions={[{ label: 'List View', href: '/tickets' }]}
        className="flex-shrink-0"
      />

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
                  tickets={board[col.status]}
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
