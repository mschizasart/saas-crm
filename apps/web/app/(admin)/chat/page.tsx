'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { io, Socket } from 'socket.io-client';
import { PageHeader } from '@/components/ui/page-header';
import { Button } from '@/components/ui/button';
import { Badge, type BadgeVariant } from '@/components/ui/badge';
import { Spinner } from '@/components/ui/spinner';
import { inputClass } from '@/components/ui/form-field';

const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001';

function getToken(): string | null {
  if (typeof window === 'undefined') return null;
  return localStorage.getItem('access_token');
}

function authHeaders(): HeadersInit {
  return { Authorization: `Bearer ${getToken()}`, 'Content-Type': 'application/json' };
}

interface ChatSession {
  id: string;
  subject: string;
  status: string;
  service: string | null;
  lastReplyAt: string | null;
  createdAt: string;
  replies: Array<{
    id: string;
    message: string;
    userId: string | null;
    createdAt: string;
  }>;
  message: string | null;
}

const STATUS_VARIANT: Record<string, BadgeVariant> = {
  closed: 'muted',
  open: 'success',
};

export default function LiveChatPage() {
  const [sessions, setSessions] = useState<ChatSession[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [replyText, setReplyText] = useState('');
  const [sending, setSending] = useState(false);
  const [orgId, setOrgId] = useState('');
  const socketRef = useRef<Socket | null>(null);
  const msgsEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch(`${API_BASE}/api/v1/organizations/current`, {
          headers: authHeaders(),
        });
        if (!res.ok) return;
        const data = await res.json();
        setOrgId(data.id);
      } catch { /* ignore */ }
    })();
  }, []);

  const fetchSessions = useCallback(async () => {
    try {
      const res = await fetch(`${API_BASE}/api/v1/tickets?source=chat&limit=50`, {
        headers: authHeaders(),
      });
      if (!res.ok) return;
      const data = await res.json();
      const tickets = data.data ?? [];
      const detailed = await Promise.all(
        tickets.map(async (t: any) => {
          try {
            const r = await fetch(`${API_BASE}/api/v1/tickets/${t.id}`, { headers: authHeaders() });
            if (!r.ok) return null;
            return r.json();
          } catch { return null; }
        }),
      );
      setSessions(detailed.filter(Boolean) as ChatSession[]);
    } catch { /* ignore */ } finally { setLoading(false); }
  }, []);

  useEffect(() => { fetchSessions(); }, [fetchSessions]);

  useEffect(() => {
    if (!orgId) return;
    const socket = io(`${API_BASE}/chat`, {
      transports: ['websocket', 'polling'],
    });
    socketRef.current = socket;

    socket.on('connect', () => {
      socket.emit('joinStaff', { orgId });
    });

    socket.on('newChatMessage', (data: any) => {
      fetchSessions();
    });

    return () => { socket.disconnect(); };
  }, [orgId, fetchSessions]);

  useEffect(() => {
    msgsEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [selected, sessions]);

  const selectedSession = sessions.find((s) => s.id === selected);

  async function handleReply(e: React.FormEvent) {
    e.preventDefault();
    if (!replyText.trim() || !selected) return;
    setSending(true);
    try {
      const res = await fetch(`${API_BASE}/api/v1/tickets/${selected}/replies`, {
        method: 'POST',
        headers: authHeaders(),
        body: JSON.stringify({ message: replyText, isStaff: true }),
      });
      if (!res.ok) throw new Error('Failed');

      if (socketRef.current) {
        socketRef.current.emit('staffReply', {
          ticketId: selected,
          message: replyText,
          orgId,
        });
      }

      setReplyText('');
      await fetchSessions();
    } catch { /* ignore */ } finally { setSending(false); }
  }

  async function closeConversation(ticketId: string) {
    try {
      await fetch(`${API_BASE}/api/v1/tickets/${ticketId}/status`, {
        method: 'PATCH',
        headers: authHeaders(),
        body: JSON.stringify({ status: 'closed' }),
      });
      await fetchSessions();
      if (selected === ticketId) setSelected(null);
    } catch { /* ignore */ }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-96">
        <Spinner size="md" label="Loading" />
      </div>
    );
  }

  return (
    <div className="h-[calc(100vh-120px)]">
      <PageHeader title="Live Chat" />
      <div className="flex h-[calc(100%-48px)] bg-white dark:bg-gray-900 rounded-xl border border-gray-100 dark:border-gray-800 shadow-sm overflow-hidden">
        {/* Left panel */}
        <div className="w-80 border-r border-gray-100 dark:border-gray-800 flex flex-col">
          <div className="px-4 py-3 border-b border-gray-100 dark:border-gray-800">
            <h2 className="text-sm font-semibold text-gray-700 dark:text-gray-300">Conversations</h2>
          </div>
          <div className="flex-1 overflow-y-auto">
            {sessions.length === 0 ? (
              <p className="text-sm text-gray-400 dark:text-gray-500 text-center py-12">No chat conversations yet</p>
            ) : (
              sessions.map((s) => (
                <button
                  key={s.id}
                  onClick={() => setSelected(s.id)}
                  className={`w-full text-left px-4 py-3 border-b border-gray-50 dark:border-gray-800 transition-colors hover:bg-gray-50 dark:hover:bg-gray-800 ${
                    selected === s.id ? 'bg-primary/5 border-l-2 border-l-primary' : ''
                  }`}
                >
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-sm font-medium text-gray-900 dark:text-gray-100 truncate max-w-[180px]">
                      {s.subject}
                    </span>
                    <Badge variant={STATUS_VARIANT[s.status] ?? 'info'}>
                      {s.status}
                    </Badge>
                  </div>
                  <p className="text-xs text-gray-500 dark:text-gray-400 truncate">
                    {s.replies?.length > 0
                      ? s.replies[s.replies.length - 1].message
                      : s.message ?? 'No messages'}
                  </p>
                  <p className="text-[10px] text-gray-400 dark:text-gray-500 mt-1">
                    {s.lastReplyAt
                      ? new Date(s.lastReplyAt).toLocaleString()
                      : new Date(s.createdAt).toLocaleString()}
                  </p>
                </button>
              ))
            )}
          </div>
        </div>

        {/* Right panel */}
        <div className="flex-1 flex flex-col">
          {!selectedSession ? (
            <div className="flex-1 flex items-center justify-center text-gray-400 dark:text-gray-500 text-sm">
              Select a conversation to view messages
            </div>
          ) : (
            <>
              <div className="px-4 py-3 border-b border-gray-100 dark:border-gray-800 flex items-center justify-between">
                <div>
                  <h3 className="text-sm font-semibold text-gray-900 dark:text-gray-100">{selectedSession.subject}</h3>
                  <p className="text-xs text-gray-500 dark:text-gray-400">
                    Visitor: {selectedSession.service ?? 'Unknown'}
                  </p>
                </div>
                {selectedSession.status !== 'closed' && (
                  <Button variant="secondary" size="sm" onClick={() => closeConversation(selectedSession.id)}>
                    Close Conversation
                  </Button>
                )}
              </div>

              <div className="flex-1 overflow-y-auto p-4 space-y-3">
                {selectedSession.message && (
                  <div className="flex justify-start">
                    <div className="max-w-xs bg-gray-100 dark:bg-gray-800 text-gray-800 dark:text-gray-200 rounded-xl px-4 py-2 text-sm">
                      <p className="text-[10px] text-gray-500 dark:text-gray-400 mb-1">Visitor</p>
                      <p className="whitespace-pre-wrap">{selectedSession.message}</p>
                    </div>
                  </div>
                )}
                {(selectedSession.replies ?? []).map((r) => {
                  const isStaff = !!r.userId;
                  return (
                    <div key={r.id} className={`flex ${isStaff ? 'justify-end' : 'justify-start'}`}>
                      <div
                        className={`max-w-xs rounded-xl px-4 py-2 text-sm ${
                          isStaff
                            ? 'bg-primary text-white'
                            : 'bg-gray-100 text-gray-800'
                        }`}
                      >
                        <p className={`text-[10px] mb-1 ${isStaff ? 'text-white/70' : 'text-gray-500 dark:text-gray-400'}`}>
                          {isStaff ? 'Staff' : 'Visitor'}
                        </p>
                        <p className="whitespace-pre-wrap">{r.message}</p>
                        <p className={`text-[10px] mt-1 ${isStaff ? 'text-white/50' : 'text-gray-400 dark:text-gray-500'}`}>
                          {new Date(r.createdAt).toLocaleTimeString()}
                        </p>
                      </div>
                    </div>
                  );
                })}
                <div ref={msgsEndRef} />
              </div>

              {selectedSession.status !== 'closed' && (
                <form onSubmit={handleReply} className="p-4 border-t border-gray-100 dark:border-gray-800 flex gap-3">
                  <input
                    aria-label="Reply message"
                    type="text"
                    value={replyText}
                    onChange={(e) => setReplyText(e.target.value)}
                    placeholder="Type your reply..."
                    className={`${inputClass} flex-1`}
                  />
                  <Button
                    type="submit"
                    variant="primary"
                    disabled={sending || !replyText.trim()}
                    loading={sending}
                  >
                    {sending ? 'Sending...' : 'Send'}
                  </Button>
                </form>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
