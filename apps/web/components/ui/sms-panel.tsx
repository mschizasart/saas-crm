'use client';

/**
 * Reusable SMS thread + compose panel for a CRM record (ticket | lead |
 * client). Renders an "SMS" card that:
 *   - loads the message thread via GET /api/v1/sms/thread (both directions)
 *   - shows a chat-style log (outbound right, inbound left)
 *   - provides a compose box + send button → POST /api/v1/sms/send
 *
 * The to-number is prefilled from the record's phone when available; the user
 * can edit it. Mirrors the visual style of DocumentPanel so it mounts
 * consistently next to it on the detail pages.
 */

import { useState, useEffect, useCallback } from 'react';
import { toast } from 'sonner';
import { apiFetch } from '@/lib/api';

export type SmsEntityType = 'ticket' | 'lead' | 'client';

interface SmsMessage {
  id: string;
  direction: 'outbound' | 'inbound';
  toNumber: string;
  fromNumber: string;
  body: string;
  status: string;
  providerSid: string | null;
  errorMessage: string | null;
  createdAt: string;
}

interface Props {
  entityType: SmsEntityType;
  entityId: string;
  /** Prefill for the recipient number (e.g. the lead/client phone). */
  defaultTo?: string | null;
}

export function SmsPanel({ entityType, entityId, defaultTo }: Props) {
  const [messages, setMessages] = useState<SmsMessage[]>([]);
  const [loading, setLoading] = useState(true);
  const [to, setTo] = useState(defaultTo ?? '');
  const [body, setBody] = useState('');
  const [sending, setSending] = useState(false);

  // Keep the recipient prefill in sync when the parent resolves the phone late.
  useEffect(() => {
    if (defaultTo && !to) setTo(defaultTo);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [defaultTo]);

  const fetchThread = useCallback(async () => {
    setLoading(true);
    try {
      const res = await apiFetch(
        `/api/v1/sms/thread?entityType=${encodeURIComponent(entityType)}&entityId=${encodeURIComponent(entityId)}`,
      );
      if (!res.ok) throw new Error(`Failed (${res.status})`);
      const json = await res.json();
      setMessages(Array.isArray(json) ? json : json.data ?? []);
    } catch {
      setMessages([]);
    } finally {
      setLoading(false);
    }
  }, [entityType, entityId]);

  useEffect(() => {
    if (entityId) fetchThread();
  }, [fetchThread, entityId]);

  async function send() {
    if (!to.trim()) {
      toast.error('Enter a recipient phone number');
      return;
    }
    if (!body.trim()) {
      toast.error('Enter a message');
      return;
    }
    setSending(true);
    try {
      const res = await apiFetch('/api/v1/sms/send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          to: to.trim(),
          body: body.trim(),
          entityType,
          entityId,
        }),
      });
      const data: { ok?: boolean; error?: string; sid?: string } = await res
        .json()
        .catch(() => ({}));
      if (res.ok && data.ok) {
        toast.success('SMS sent');
        setBody('');
        await fetchThread();
      } else {
        toast.error(`Send failed: ${data.error ?? `HTTP ${res.status}`}`);
        // Still refresh — a failed send is logged so it shows in the thread.
        await fetchThread();
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Send failed');
    } finally {
      setSending(false);
    }
  }

  return (
    <div className="bg-white dark:bg-gray-900 rounded-xl border border-gray-100 dark:border-gray-800 shadow-sm overflow-hidden">
      <div className="flex items-center justify-between px-4 py-3 border-b border-gray-100 dark:border-gray-800">
        <h2 className="text-sm font-semibold text-gray-700 dark:text-gray-300">
          SMS {messages.length > 0 && `(${messages.length})`}
        </h2>
      </div>

      {/* Thread */}
      {loading ? (
        <div className="p-6 space-y-2">
          {Array.from({ length: 2 }).map((_, i) => (
            <div
              key={i}
              className="h-10 bg-gray-50 dark:bg-gray-800 rounded animate-pulse"
            />
          ))}
        </div>
      ) : messages.length === 0 ? (
        <p className="px-4 py-8 text-center text-sm text-gray-400 dark:text-gray-500">
          No messages yet
        </p>
      ) : (
        <ul className="px-4 py-4 space-y-3 max-h-96 overflow-y-auto">
          {messages.map((m) => {
            const outbound = m.direction === 'outbound';
            const failed = m.status === 'failed';
            return (
              <li
                key={m.id}
                className={`flex ${outbound ? 'justify-end' : 'justify-start'}`}
              >
                <div
                  className={[
                    'max-w-[80%] rounded-2xl px-3 py-2 text-sm',
                    outbound
                      ? failed
                        ? 'bg-red-50 dark:bg-red-900/30 text-red-800 dark:text-red-200 border border-red-200 dark:border-red-800'
                        : 'bg-primary text-white'
                      : 'bg-gray-100 dark:bg-gray-800 text-gray-800 dark:text-gray-200',
                  ].join(' ')}
                >
                  <p className="whitespace-pre-wrap break-words">{m.body}</p>
                  <div
                    className={`mt-1 flex items-center gap-2 text-[11px] ${
                      outbound && !failed
                        ? 'text-white/70'
                        : 'text-gray-400 dark:text-gray-500'
                    }`}
                  >
                    <span>{new Date(m.createdAt).toLocaleString()}</span>
                    <span>·</span>
                    <span className="capitalize">{m.status}</span>
                    {failed && m.errorMessage && (
                      <span title={m.errorMessage}>· error</span>
                    )}
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
      )}

      {/* Compose */}
      <div className="border-t border-gray-100 dark:border-gray-800 p-4 space-y-2">
        <input
          type="text"
          value={to}
          onChange={(e) => setTo(e.target.value)}
          placeholder="Recipient number (E.164, e.g. +14155551234)"
          className="w-full px-3 py-2 border border-gray-200 dark:border-gray-700 rounded-lg text-sm bg-white dark:bg-gray-900 focus:outline-none focus:ring-2 focus:ring-primary/30"
        />
        <textarea
          value={body}
          onChange={(e) => setBody(e.target.value)}
          rows={2}
          placeholder="Type your message…"
          className="w-full px-3 py-2 border border-gray-200 dark:border-gray-700 rounded-lg text-sm bg-white dark:bg-gray-900 focus:outline-none focus:ring-2 focus:ring-primary/30 resize-y"
        />
        <div className="flex items-center justify-between">
          <span className="text-[11px] text-gray-400 dark:text-gray-500">
            {body.length} chars
          </span>
          <button
            onClick={send}
            disabled={sending}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium bg-primary text-white rounded-lg hover:bg-primary/90 disabled:opacity-50 transition-colors"
          >
            {sending ? 'Sending…' : 'Send SMS'}
          </button>
        </div>
      </div>
    </div>
  );
}

export default SmsPanel;
