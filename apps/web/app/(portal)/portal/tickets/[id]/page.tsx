'use client';

import { useState, useEffect, useCallback, FormEvent } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';

interface Reply {
  id: string;
  message: string;
  createdAt: string;
  author?: { name?: string } | null;
  fromClient?: boolean;
}

interface Ticket {
  id: string;
  subject: string;
  message: string;
  status: string;
  priority: string;
  createdAt: string;
  replies: Reply[];
}

const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001';

function getToken(): string | null {
  if (typeof window === 'undefined') return null;
  return localStorage.getItem('access_token');
}

function authHeaders(): HeadersInit {
  return { Authorization: `Bearer ${getToken()}`, 'Content-Type': 'application/json' };
}

export default function PortalTicketDetailPage() {
  const { id } = useParams() as { id: string };
  const [ticket, setTicket] = useState<Ticket | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [reply, setReply] = useState('');
  const [sending, setSending] = useState(false);

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`${API_BASE}/api/v1/portal/tickets/${id}`, { headers: authHeaders() });
      if (!res.ok) throw new Error(`Failed (${res.status})`);
      const json = await res.json();
      setTicket(json.data ?? json);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed');
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => { if (id) fetchData(); }, [id, fetchData]);

  async function sendReply(e: FormEvent) {
    e.preventDefault();
    if (!reply.trim()) return;
    setSending(true);
    try {
      const res = await fetch(`${API_BASE}/api/v1/portal/tickets/${id}/replies`, {
        method: 'POST',
        headers: authHeaders(),
        body: JSON.stringify({ message: reply }),
      });
      if (!res.ok) throw new Error('Failed');
      setReply('');
      await fetchData();
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Failed');
    } finally {
      setSending(false);
    }
  }

  if (loading) return <div className="animate-pulse h-96 bg-gray-100 rounded-xl" />;
  if (error || !ticket) return <div className="text-red-600">{error ?? 'Not found'}</div>;

  return (
    <div>
      <div className="mb-4"><Link href="/portal/tickets" className="text-sm text-gray-500 hover:text-primary">← Back to tickets</Link></div>

      <div className="flex items-start justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">{ticket.subject}</h1>
          <p className="text-sm text-gray-500 mt-1 capitalize">Priority: {ticket.priority} · {new Date(ticket.createdAt).toLocaleString()}</p>
        </div>
        <span className="inline-flex items-center px-3 py-1 rounded-full text-xs font-medium bg-primary/10 text-primary">{ticket.status}</span>
      </div>

      <div className="space-y-4">
        <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-6">
          <p className="text-sm text-gray-800 whitespace-pre-wrap">{ticket.message}</p>
        </div>

        {(ticket.replies ?? []).map((r) => (
          <div key={r.id} className={`rounded-xl border p-4 ${r.fromClient ? 'bg-primary/5 border-primary/20' : 'bg-white border-gray-100'}`}>
            <p className="text-xs text-gray-500 mb-2">
              {r.author?.name ?? (r.fromClient ? 'You' : 'Support')} · {new Date(r.createdAt).toLocaleString()}
            </p>
            <p className="text-sm text-gray-800 whitespace-pre-wrap">{r.message}</p>
          </div>
        ))}
      </div>

      {ticket.status !== 'closed' && (
        <form onSubmit={sendReply} className="mt-6 bg-white rounded-xl border border-gray-100 shadow-sm p-4">
          <label className="block text-xs font-medium text-gray-600 mb-2">Reply</label>
          <textarea
            rows={4}
            value={reply}
            onChange={(e) => setReply(e.target.value)}
            className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary/30"
            placeholder="Type your message…"
          />
          <div className="flex justify-end mt-3">
            <button type="submit" disabled={sending || !reply.trim()} className="px-4 py-2 bg-primary text-white text-sm font-medium rounded-lg hover:bg-primary/90 disabled:opacity-50">
              {sending ? 'Sending…' : 'Send Reply'}
            </button>
          </div>
        </form>
      )}
    </div>
  );
}
