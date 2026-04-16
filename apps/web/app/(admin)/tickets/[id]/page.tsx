'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface TicketReply {
  id: string;
  message: string;
  isStaff: boolean;
  isInternal?: boolean;
  createdAt: string;
  user: {
    id: string;
    name: string;
  } | null;
}

interface Ticket {
  id: string;
  subject: string;
  status: string;
  priority: string;
  department: string | null;
  createdAt: string;
  client: {
    id: string;
    company: string;
  } | null;
  assignedTo: {
    id: string;
    name: string;
  } | null;
  replies: TicketReply[];
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001';

const TICKET_STATUSES = ['open', 'in_progress', 'answered', 'on_hold', 'closed'] as const;

const PRIORITY_COLOURS: Record<string, string> = {
  low: 'bg-gray-100 text-gray-500',
  medium: 'bg-blue-100 text-blue-700',
  high: 'bg-orange-100 text-orange-700',
  urgent: 'bg-red-100 text-red-700',
};

const STATUS_COLOURS: Record<string, string> = {
  open: 'bg-green-100 text-green-700',
  in_progress: 'bg-blue-100 text-blue-700',
  answered: 'bg-purple-100 text-purple-700',
  on_hold: 'bg-yellow-100 text-yellow-700',
  closed: 'bg-gray-100 text-gray-500',
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function getToken(): string | null {
  if (typeof window === 'undefined') return null;
  return localStorage.getItem('access_token');
}

function authHeaders(): HeadersInit {
  return { Authorization: `Bearer ${getToken()}`, 'Content-Type': 'application/json' };
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function Spinner() {
  return (
    <div className="flex justify-center items-center py-24">
      <svg
        className="animate-spin h-7 w-7 text-primary"
        xmlns="http://www.w3.org/2000/svg"
        fill="none"
        viewBox="0 0 24 24"
        aria-label="Loading"
      >
        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
      </svg>
    </div>
  );
}

function Badge({ label, colourClass }: { label: string; colourClass: string }) {
  return (
    <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium capitalize ${colourClass}`}>
      {label.replace('_', ' ')}
    </span>
  );
}

function ReplyCard({ reply }: { reply: TicketReply }) {
  const isStaff = reply.isStaff;
  const isInternal = reply.isInternal ?? false;

  let bgClass = isStaff ? 'bg-blue-600 text-white' : 'bg-gray-100 text-gray-800';
  let metaClass = isStaff ? 'text-blue-100' : 'text-gray-500';

  if (isInternal) {
    bgClass = 'bg-yellow-50 text-gray-800 border border-yellow-200';
    metaClass = 'text-yellow-700';
  }

  return (
    <div className={`flex ${isStaff ? 'justify-end' : 'justify-start'}`}>
      <div
        className={[
          'max-w-xl w-full rounded-xl px-4 py-3 text-sm shadow-sm',
          bgClass,
        ].join(' ')}
      >
        <div className={`flex items-center gap-2 mb-1.5 text-xs font-medium ${metaClass}`}>
          {isInternal && (
            <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-yellow-200 text-yellow-800 text-[10px] font-semibold uppercase tracking-wide">
              <svg className="w-3 h-3" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M16.5 10.5V6.75a4.5 4.5 0 10-9 0v3.75m-.75 11.25h10.5a2.25 2.25 0 002.25-2.25v-6.75a2.25 2.25 0 00-2.25-2.25H6.75a2.25 2.25 0 00-2.25 2.25v6.75a2.25 2.25 0 002.25 2.25z" />
              </svg>
              Internal
            </span>
          )}
          <span>{reply.user?.name ?? (isStaff ? 'Staff' : 'Client')}</span>
          <span>·</span>
          <span>{new Date(reply.createdAt).toLocaleString()}</span>
        </div>
        <p className="whitespace-pre-wrap leading-relaxed">{reply.message}</p>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default function TicketDetailPage() {
  const params = useParams();
  const ticketId = params.id as string;

  const [ticket, setTicket] = useState<Ticket | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Status change
  const [statusChanging, setStatusChanging] = useState(false);

  // Reply
  const [replyText, setReplyText] = useState('');
  const [isInternal, setIsInternal] = useState(false);
  const [sendingReply, setSendingReply] = useState(false);
  const [replyError, setReplyError] = useState<string | null>(null);

  // Predefined replies
  const [predefinedReplies, setPredefinedReplies] = useState<{ id: string; name: string; body: string }[]>([]);

  // Auto-refresh ref
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // ── Fetch ticket ──────────────────────────────────────────────────────────

  const fetchTicket = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    setError(null);
    try {
      const res = await fetch(`${API_BASE}/api/v1/tickets/${ticketId}`, {
        headers: authHeaders(),
      });
      if (!res.ok) throw new Error(`Server responded with ${res.status}`);
      const data: Ticket = await res.json();
      setTicket(data);
    } catch (err) {
      if (!silent) setError(err instanceof Error ? err.message : 'Failed to load ticket');
    } finally {
      if (!silent) setLoading(false);
    }
  }, [ticketId]);

  useEffect(() => {
    fetchTicket();
  }, [fetchTicket]);

  // ── Fetch predefined replies ──────────────────────────────────────────────

  useEffect(() => {
    async function loadPredefinedReplies() {
      try {
        const res = await fetch(`${API_BASE}/api/v1/predefined-replies`, {
          headers: authHeaders(),
        });
        if (!res.ok) return;
        const data = await res.json();
        setPredefinedReplies(Array.isArray(data) ? data : data.data ?? []);
      } catch {
        // silent — predefined replies are optional
      }
    }
    loadPredefinedReplies();
  }, []);

  // ── Auto-refresh every 30s ────────────────────────────────────────────────

  useEffect(() => {
    intervalRef.current = setInterval(() => fetchTicket(true), 30_000);
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [fetchTicket]);

  // ── Status change ─────────────────────────────────────────────────────────

  async function handleStatusChange(e: React.ChangeEvent<HTMLSelectElement>) {
    const newStatus = e.target.value;
    setStatusChanging(true);
    try {
      const res = await fetch(`${API_BASE}/api/v1/tickets/${ticketId}/status`, {
        method: 'PATCH',
        headers: authHeaders(),
        body: JSON.stringify({ status: newStatus }),
      });
      if (!res.ok) throw new Error(`Status update failed with ${res.status}`);
      setTicket((prev) => prev ? { ...prev, status: newStatus } : prev);
    } catch {
      // silent — keep old status displayed
    } finally {
      setStatusChanging(false);
    }
  }

  // ── Send reply ────────────────────────────────────────────────────────────

  async function handleSendReply(e: React.FormEvent) {
    e.preventDefault();
    if (!replyText.trim()) return;
    setSendingReply(true);
    setReplyError(null);
    try {
      const res = await fetch(`${API_BASE}/api/v1/tickets/${ticketId}/replies`, {
        method: 'POST',
        headers: authHeaders(),
        body: JSON.stringify({ message: replyText, isStaff: true, isInternal }),
      });
      if (!res.ok) throw new Error(`Failed to send reply: ${res.status}`);
      const newReply: TicketReply = await res.json();
      setTicket((prev) =>
        prev ? { ...prev, replies: [...(prev.replies ?? []), newReply] } : prev,
      );
      setReplyText('');
      setIsInternal(false);
    } catch (err) {
      setReplyError(err instanceof Error ? err.message : 'Failed to send reply');
    } finally {
      setSendingReply(false);
    }
  }

  // ── Render ────────────────────────────────────────────────────────────────

  if (loading) return <Spinner />;

  if (error || !ticket) {
    return (
      <div className="px-4 py-8 text-center">
        <p className="text-red-600 text-sm mb-3">{error ?? 'Ticket not found'}</p>
        <button onClick={() => fetchTicket()} className="text-sm text-primary underline">Retry</button>
      </div>
    );
  }

  return (
    <div className="max-w-4xl mx-auto">
      {/* ── Breadcrumb ────────────────────────────────────────────────────── */}
      <div className="flex items-center gap-2 mb-6 text-sm text-gray-500">
        <Link href="/tickets" className="hover:text-primary transition-colors">Tickets</Link>
        <span>/</span>
        <span className="text-gray-900 font-medium truncate max-w-xs">{ticket.subject}</span>
      </div>

      {/* ── Header ───────────────────────────────────────────────────────── */}
      <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3 mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 mb-2">{ticket.subject}</h1>
          <div className="flex flex-wrap items-center gap-2">
            <Badge
              label={ticket.status}
              colourClass={STATUS_COLOURS[ticket.status] ?? 'bg-gray-100 text-gray-500'}
            />
            <Badge
              label={ticket.priority}
              colourClass={PRIORITY_COLOURS[ticket.priority] ?? 'bg-gray-100 text-gray-500'}
            />
          </div>
        </div>

        {/* Status change dropdown */}
        <div className="flex-shrink-0">
          <label className="block text-xs font-medium text-gray-500 mb-1">Change Status</label>
          <select
            value={ticket.status}
            onChange={handleStatusChange}
            disabled={statusChanging}
            className="px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary bg-white disabled:opacity-50"
          >
            {TICKET_STATUSES.map((s) => (
              <option key={s} value={s}>
                {s.replace('_', ' ')}
              </option>
            ))}
          </select>
        </div>
      </div>

      {/* ── Info row ─────────────────────────────────────────────────────── */}
      <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-5 mb-6">
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-5 text-sm">
          <div>
            <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-1">Client</p>
            {ticket.client ? (
              <Link href={`/clients/${ticket.client.id}`} className="text-primary hover:underline font-medium">
                {ticket.client.company}
              </Link>
            ) : (
              <span className="text-gray-300">—</span>
            )}
          </div>
          <div>
            <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-1">Department</p>
            <p className="text-gray-700">{ticket.department ?? <span className="text-gray-300">—</span>}</p>
          </div>
          <div>
            <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-1">Assigned To</p>
            <p className="text-gray-700">{ticket.assignedTo?.name ?? <span className="text-gray-300">Unassigned</span>}</p>
          </div>
          <div>
            <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-1">Created</p>
            <p className="text-gray-700">{new Date(ticket.createdAt).toLocaleDateString()}</p>
          </div>
        </div>
      </div>

      {/* ── Replies thread ───────────────────────────────────────────────── */}
      <div className="bg-white rounded-xl border border-gray-100 shadow-sm mb-4">
        <div className="px-4 py-3 border-b border-gray-100">
          <h2 className="text-sm font-semibold text-gray-700">
            Replies {ticket.replies?.length ? `(${ticket.replies.length})` : ''}
          </h2>
        </div>

        <div className="px-4 py-4 space-y-4 min-h-[120px]">
          {(!ticket.replies || ticket.replies.length === 0) ? (
            <p className="text-sm text-gray-400 text-center py-6">No replies yet. Be the first to respond.</p>
          ) : (
            ticket.replies.map((reply) => (
              <ReplyCard key={reply.id} reply={reply} />
            ))
          )}
        </div>
      </div>

      {/* ── Reply form ───────────────────────────────────────────────────── */}
      <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-4">
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-sm font-semibold text-gray-700">Send Reply</h3>
          {predefinedReplies.length > 0 && (
            <select
              onChange={(e) => {
                const selected = predefinedReplies.find((r) => r.id === e.target.value);
                if (selected) {
                  setReplyText((prev) => (prev ? prev + '\n' + selected.body : selected.body));
                }
                e.target.value = '';
              }}
              defaultValue=""
              className="px-3 py-1.5 text-xs border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary bg-white text-gray-600"
            >
              <option value="" disabled>Insert Predefined Reply</option>
              {predefinedReplies.map((r) => (
                <option key={r.id} value={r.id}>{r.name}</option>
              ))}
            </select>
          )}
        </div>
        {replyError && (
          <div className="mb-3 px-3 py-2 bg-red-50 border border-red-100 text-red-600 text-xs rounded-lg">
            {replyError}
          </div>
        )}
        <form onSubmit={handleSendReply}>
          <textarea
            rows={4}
            value={replyText}
            onChange={(e) => setReplyText(e.target.value)}
            placeholder="Type your reply…"
            className="w-full px-3 py-2.5 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary resize-y"
          />
          <div className="mt-3 flex items-center justify-between">
            <label className="flex items-center gap-2 text-sm text-gray-600 cursor-pointer select-none">
              <input
                type="checkbox"
                checked={isInternal}
                onChange={(e) => setIsInternal(e.target.checked)}
                className="rounded border-gray-300 text-yellow-500 focus:ring-yellow-400"
              />
              <svg className="w-4 h-4 text-yellow-500" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M16.5 10.5V6.75a4.5 4.5 0 10-9 0v3.75m-.75 11.25h10.5a2.25 2.25 0 002.25-2.25v-6.75a2.25 2.25 0 00-2.25-2.25H6.75a2.25 2.25 0 00-2.25 2.25v6.75a2.25 2.25 0 002.25 2.25z" />
              </svg>
              Internal note (hidden from client)
            </label>
            <button
              type="submit"
              disabled={sendingReply || !replyText.trim()}
              className={`px-4 py-2 text-sm font-medium rounded-lg disabled:opacity-50 transition-colors ${
                isInternal
                  ? 'bg-yellow-500 text-white hover:bg-yellow-600'
                  : 'bg-primary text-white hover:bg-primary/90'
              }`}
            >
              {sendingReply ? 'Sending…' : isInternal ? 'Add Internal Note' : 'Send Reply'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
