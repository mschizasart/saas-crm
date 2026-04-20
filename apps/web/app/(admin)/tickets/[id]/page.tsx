'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useModalA11y } from '@/components/ui/use-modal-a11y';
import { DetailPageLayout } from '@/components/layouts/detail-page-layout';

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

interface MergeSearchTicket {
  id: string;
  subject: string;
  status: string;
  createdAt: string;
}

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

  // AI Draft
  const [aiDrafting, setAiDrafting] = useState(false);
  const [aiTone, setAiTone] = useState<'professional' | 'friendly' | 'formal'>('professional');

  // Predefined replies
  const [predefinedReplies, setPredefinedReplies] = useState<{ id: string; name: string; body: string }[]>([]);

  // Merge
  const [mergeOpen, setMergeOpen] = useState(false);
  const [mergeSearch, setMergeSearch] = useState('');
  const [mergeResults, setMergeResults] = useState<MergeSearchTicket[]>([]);
  const [mergeSearching, setMergeSearching] = useState(false);
  const [mergeConfirm, setMergeConfirm] = useState<MergeSearchTicket | null>(null);
  const [merging, setMerging] = useState(false);
  const [mergeToast, setMergeToast] = useState(false);
  const closeMergeModal = useCallback(() => {
    setMergeOpen(false);
    setMergeSearch('');
    setMergeResults([]);
    setMergeConfirm(null);
  }, []);
  const mergeModalRef = useModalA11y(mergeOpen, closeMergeModal);

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

  // ── Merge: search tickets ──────────────────────────────────────────────────

  useEffect(() => {
    if (!mergeOpen || mergeSearch.trim().length < 2) {
      setMergeResults([]);
      return;
    }
    const timeout = setTimeout(async () => {
      setMergeSearching(true);
      try {
        const res = await fetch(
          `${API_BASE}/api/v1/tickets?search=${encodeURIComponent(mergeSearch)}&limit=10`,
          { headers: authHeaders() },
        );
        if (!res.ok) return;
        const data = await res.json();
        const items: MergeSearchTicket[] = (data.data ?? []).filter(
          (t: any) => t.id !== ticketId,
        );
        setMergeResults(items);
      } catch {
        /* ignore */
      } finally {
        setMergeSearching(false);
      }
    }, 300);
    return () => clearTimeout(timeout);
  }, [mergeSearch, mergeOpen, ticketId]);

  // ── Merge: execute ────────────────────────────────────────────────────────

  async function handleMerge() {
    if (!mergeConfirm) return;
    setMerging(true);
    try {
      const res = await fetch(`${API_BASE}/api/v1/tickets/${ticketId}/merge`, {
        method: 'POST',
        headers: authHeaders(),
        body: JSON.stringify({ sourceTicketId: mergeConfirm.id }),
      });
      if (!res.ok) throw new Error(`Merge failed with ${res.status}`);
      setMergeOpen(false);
      setMergeConfirm(null);
      setMergeSearch('');
      setMergeToast(true);
      setTimeout(() => setMergeToast(false), 3000);
      fetchTicket();
    } catch {
      // silent
    } finally {
      setMerging(false);
    }
  }

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

  // ── AI Draft ──────────────────────────────────────────────────────────────

  async function handleAiDraft() {
    if (!ticket) return;
    setAiDrafting(true);
    setReplyError(null);
    try {
      const lastReplies = (ticket.replies ?? []).slice(-5).map((r) => ({
        from: r.isStaff ? 'Staff' : 'Client',
        message: r.message,
        date: r.createdAt,
      }));
      const res = await fetch(`${API_BASE}/api/v1/ai/draft-reply`, {
        method: 'POST',
        headers: authHeaders(),
        body: JSON.stringify({
          subject: ticket.subject,
          previousMessages: lastReplies,
          tone: aiTone,
        }),
      });
      if (!res.ok) throw new Error(`AI draft failed (${res.status})`);
      const data = await res.json();
      if (data.draft) {
        setReplyText((prev) => (prev ? prev + '\n' + data.draft : data.draft));
      }
    } catch (err) {
      setReplyError(err instanceof Error ? err.message : 'AI draft failed');
    } finally {
      setAiDrafting(false);
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
    <DetailPageLayout
      title={ticket.subject}
      breadcrumbs={[
        { label: 'Tickets', href: '/tickets' },
        { label: ticket.subject },
      ]}
      badge={
        <Badge
          label={ticket.status}
          colourClass={STATUS_COLOURS[ticket.status] ?? 'bg-gray-100 text-gray-500'}
        />
      }
      actions={[
        { label: 'Merge', onClick: () => setMergeOpen(true), variant: 'secondary' },
      ]}
    >
      <div className="flex flex-wrap items-center gap-2 -mt-2">
        <Badge
          label={ticket.priority}
          colourClass={PRIORITY_COLOURS[ticket.priority] ?? 'bg-gray-100 text-gray-500'}
        />
        {ticket.priority !== 'medium' && (
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium bg-violet-100 text-violet-700" title="Priority was auto-classified by AI based on ticket content">
            <svg className="w-3 h-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path strokeLinecap="round" strokeLinejoin="round" d="M9.813 15.904L9 18.75l-.813-2.846a4.5 4.5 0 00-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 003.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 003.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 00-3.09 3.09zM18.259 8.715L18 9.75l-.259-1.035a3.375 3.375 0 00-2.455-2.456L14.25 6l1.036-.259a3.375 3.375 0 002.455-2.456L18 2.25l.259 1.035a3.375 3.375 0 002.455 2.456L21.75 6l-1.036.259a3.375 3.375 0 00-2.455 2.456z" />
            </svg>
            AI classified
          </span>
        )}
        <div className="ml-auto">
          <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">Change Status</label>
          <select
            value={ticket.status}
            onChange={handleStatusChange}
            disabled={statusChanging}
            className="px-3 py-2 text-sm border border-gray-200 dark:border-gray-700 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary bg-white dark:bg-gray-900 disabled:opacity-50"
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
      <div className="bg-white dark:bg-gray-900 rounded-xl border border-gray-100 dark:border-gray-800 shadow-sm p-5 mb-6">
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-5 text-sm">
          <div>
            <p className="text-xs font-semibold text-gray-400 dark:text-gray-500 uppercase tracking-wide mb-1">Client</p>
            {ticket.client ? (
              <Link href={`/clients/${ticket.client.id}`} className="text-primary hover:underline font-medium">
                {ticket.client.company}
              </Link>
            ) : (
              <span className="text-gray-300 dark:text-gray-600">—</span>
            )}
          </div>
          <div>
            <p className="text-xs font-semibold text-gray-400 dark:text-gray-500 uppercase tracking-wide mb-1">Department</p>
            <p className="text-gray-700 dark:text-gray-300">{ticket.department ?? <span className="text-gray-300 dark:text-gray-600">—</span>}</p>
          </div>
          <div>
            <p className="text-xs font-semibold text-gray-400 dark:text-gray-500 uppercase tracking-wide mb-1">Assigned To</p>
            <p className="text-gray-700 dark:text-gray-300">{ticket.assignedTo?.name ?? <span className="text-gray-300 dark:text-gray-600">Unassigned</span>}</p>
          </div>
          <div>
            <p className="text-xs font-semibold text-gray-400 dark:text-gray-500 uppercase tracking-wide mb-1">Created</p>
            <p className="text-gray-700 dark:text-gray-300">{new Date(ticket.createdAt).toLocaleDateString()}</p>
          </div>
        </div>
      </div>

      {/* ── Replies thread ───────────────────────────────────────────────── */}
      <div className="bg-white dark:bg-gray-900 rounded-xl border border-gray-100 dark:border-gray-800 shadow-sm mb-4">
        <div className="px-4 py-3 border-b border-gray-100 dark:border-gray-800">
          <h2 className="text-sm font-semibold text-gray-700 dark:text-gray-300">
            Replies {ticket.replies?.length ? `(${ticket.replies.length})` : ''}
          </h2>
        </div>

        <div className="px-4 py-4 space-y-4 min-h-[120px]">
          {(!ticket.replies || ticket.replies.length === 0) ? (
            <p className="text-sm text-gray-400 dark:text-gray-500 text-center py-6">No replies yet. Be the first to respond.</p>
          ) : (
            ticket.replies.map((reply) => (
              <ReplyCard key={reply.id} reply={reply} />
            ))
          )}
        </div>
      </div>

      {/* ── Reply form ───────────────────────────────────────────────────── */}
      <div className="bg-white dark:bg-gray-900 rounded-xl border border-gray-100 dark:border-gray-800 shadow-sm p-4">
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-300">Send Reply</h3>
          <div className="flex items-center gap-2">
            {/* AI Draft button */}
            <div className="flex items-center gap-1">
              <select
                value={aiTone}
                onChange={(e) => setAiTone(e.target.value as 'professional' | 'friendly' | 'formal')}
                className="px-2 py-1.5 text-xs border border-gray-200 dark:border-gray-700 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary/30 bg-white dark:bg-gray-900 text-gray-600 dark:text-gray-400"
              >
                <option value="professional">Professional</option>
                <option value="friendly">Friendly</option>
                <option value="formal">Formal</option>
              </select>
              <button
                type="button"
                onClick={handleAiDraft}
                disabled={aiDrafting}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium bg-violet-50 text-violet-700 border border-violet-200 rounded-lg hover:bg-violet-100 transition-colors disabled:opacity-50"
              >
                {aiDrafting ? (
                  <svg className="animate-spin h-3 w-3" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                  </svg>
                ) : (
                  <svg className="w-3 h-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M9.813 15.904L9 18.75l-.813-2.846a4.5 4.5 0 00-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 003.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 003.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 00-3.09 3.09zM18.259 8.715L18 9.75l-.259-1.035a3.375 3.375 0 00-2.455-2.456L14.25 6l1.036-.259a3.375 3.375 0 002.455-2.456L18 2.25l.259 1.035a3.375 3.375 0 002.455 2.456L21.75 6l-1.036.259a3.375 3.375 0 00-2.455 2.456z" />
                  </svg>
                )}
                {aiDrafting ? 'Drafting...' : 'Draft with AI'}
              </button>
            </div>
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
                className="px-3 py-1.5 text-xs border border-gray-200 dark:border-gray-700 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary bg-white dark:bg-gray-900 text-gray-600 dark:text-gray-400"
              >
                <option value="" disabled>Insert Predefined Reply</option>
                {predefinedReplies.map((r) => (
                  <option key={r.id} value={r.id}>{r.name}</option>
                ))}
              </select>
            )}
          </div>
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
            className="w-full px-3 py-2.5 text-sm border border-gray-200 dark:border-gray-700 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary resize-y"
          />
          <div className="mt-3 flex items-center justify-between">
            <label className="flex items-center gap-2 text-sm text-gray-600 dark:text-gray-400 cursor-pointer select-none">
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

      {/* ── Merge modal ──────────────────────────────────────────────── */}
      {mergeOpen && (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4">
          <div
            ref={mergeModalRef}
            role="dialog"
            aria-modal="true"
            aria-labelledby="merge-ticket-modal-title"
            className="bg-white dark:bg-gray-900 rounded-xl shadow-xl w-full max-w-lg"
          >
            {!mergeConfirm ? (
              <>
                <div className="px-5 py-4 border-b border-gray-100 dark:border-gray-800 flex items-center justify-between">
                  <h3 id="merge-ticket-modal-title" className="text-lg font-semibold text-gray-900 dark:text-gray-100">Merge Ticket</h3>
                  <button onClick={() => { setMergeOpen(false); setMergeSearch(''); setMergeResults([]); }} aria-label="Close" className="text-gray-400 dark:text-gray-500 hover:text-gray-600 text-xl leading-none">&times;</button>
                </div>
                <div className="p-5">
                  <p className="text-sm text-gray-500 dark:text-gray-400 mb-3">Search for a ticket to merge into this one. All replies from the selected ticket will be moved here.</p>
                  <input
                    type="text"
                    value={mergeSearch}
                    onChange={(e) => setMergeSearch(e.target.value)}
                    placeholder="Search tickets by subject..."
                    className="w-full px-3 py-2 text-sm border border-gray-200 dark:border-gray-700 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary"
                    autoFocus
                  />
                  <div className="mt-3 max-h-60 overflow-y-auto space-y-1">
                    {mergeSearching && <p className="text-xs text-gray-400 dark:text-gray-500 text-center py-3">Searching...</p>}
                    {!mergeSearching && mergeSearch.trim().length >= 2 && mergeResults.length === 0 && (
                      <p className="text-xs text-gray-400 dark:text-gray-500 text-center py-3">No tickets found</p>
                    )}
                    {mergeResults.map((t) => (
                      <button
                        key={t.id}
                        onClick={() => setMergeConfirm(t)}
                        className="w-full text-left px-3 py-2 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors border border-transparent hover:border-gray-200"
                      >
                        <p className="text-sm font-medium text-gray-900 dark:text-gray-100 truncate">{t.subject}</p>
                        <p className="text-xs text-gray-400 dark:text-gray-500 mt-0.5">
                          <span className="capitalize">{t.status.replace('_', ' ')}</span> &middot; {new Date(t.createdAt).toLocaleDateString()}
                        </p>
                      </button>
                    ))}
                  </div>
                </div>
              </>
            ) : (
              <>
                <div className="px-5 py-4 border-b border-gray-100 dark:border-gray-800">
                  <h3 id="merge-ticket-modal-title" className="text-lg font-semibold text-gray-900 dark:text-gray-100">Confirm Merge</h3>
                </div>
                <div className="p-5">
                  <p className="text-sm text-gray-700 dark:text-gray-300">
                    Merge ticket <strong>&ldquo;{mergeConfirm.subject}&rdquo;</strong> into this ticket? All replies will be moved here and the source ticket will be closed.
                  </p>
                  <div className="flex items-center justify-end gap-3 mt-5">
                    <button
                      onClick={() => setMergeConfirm(null)}
                      className="px-4 py-2 text-sm font-medium border border-gray-200 dark:border-gray-700 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-800"
                    >
                      Cancel
                    </button>
                    <button
                      onClick={handleMerge}
                      disabled={merging}
                      className="px-4 py-2 text-sm font-medium bg-primary text-white rounded-lg hover:bg-primary/90 disabled:opacity-50"
                    >
                      {merging ? 'Merging...' : 'Confirm Merge'}
                    </button>
                  </div>
                </div>
              </>
            )}
          </div>
        </div>
      )}

      {/* ── Merge toast ──────────────────────────────────────────────── */}
      {mergeToast && (
        <div className="fixed bottom-6 right-6 bg-green-600 text-white px-4 py-2.5 rounded-lg shadow-lg text-sm font-medium z-50">
          Tickets merged
        </div>
      )}
    </DetailPageLayout>
  );
}
