'use client';

import { Fragment, useCallback, useEffect, useState } from 'react';
import { Card, CardHeader, CardBody } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';

const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001';

export type SentEmailsRoutedTo =
  | 'invoice'
  | 'estimate'
  | 'proposal'
  | 'ticket'
  | 'client'
  | 'lead'
  | 'statement';

export interface SentEmailsPanelProps {
  routedTo: SentEmailsRoutedTo;
  routedToId: string;
  /**
   * External hook to refetch — bumping `refreshKey` re-pulls the list.
   * Use when the parent page just sent a new email and wants the panel
   * to reflect the new row immediately.
   */
  refreshKey?: number;
}

interface ClickedUrl {
  url: string;
  at: string;
  ip?: string | null;
  userAgent?: string | null;
}

interface OutboundMessage {
  id: string;
  subject: string | null;
  recipientEmail: string | null;
  sentAt: string;
  openedAt: string | null;
  openCount: number;
  lastOpenedAt: string | null;
  clickedAt: string | null;
  clickCount: number;
  lastClickedAt: string | null;
  clickedUrls: ClickedUrl[];
  messageId: string | null;
}

function authHeaders(): HeadersInit {
  if (typeof window === 'undefined') return {};
  const token = localStorage.getItem('access_token');
  return token ? { Authorization: `Bearer ${token}` } : {};
}

function fmtDate(iso: string | null): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleString();
}

function relTime(iso: string | null): string {
  if (!iso) return '';
  const ms = Date.now() - new Date(iso).getTime();
  const m = Math.floor(ms / 60_000);
  if (m < 1) return 'just now';
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  return `${d}d ago`;
}

/**
 * "Sent emails" panel — shown on invoice / estimate / proposal etc.
 * detail pages. Pulls from /api/v1/outbound-messages, displays one row
 * per outbound mail with open / click counters; rows expand to show
 * the per-click URL log.
 *
 * Polls once on mount, plus whenever `refreshKey` changes. No live
 * websocket / polling — opens trickle in over hours/days; the user
 * can refresh the page if they care about freshness.
 */
export function SentEmailsPanel({
  routedTo,
  routedToId,
  refreshKey = 0,
}: SentEmailsPanelProps) {
  const [rows, setRows] = useState<OutboundMessage[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});

  const fetchRows = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const url =
        `${API_BASE}/api/v1/outbound-messages` +
        `?routedTo=${encodeURIComponent(routedTo)}` +
        `&routedToId=${encodeURIComponent(routedToId)}`;
      const res = await fetch(url, { headers: authHeaders() });
      if (!res.ok) throw new Error(`Failed (${res.status})`);
      const data = (await res.json()) as OutboundMessage[];
      setRows(Array.isArray(data) ? data : []);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed');
    } finally {
      setLoading(false);
    }
  }, [routedTo, routedToId]);

  useEffect(() => {
    if (routedToId) fetchRows();
  }, [fetchRows, routedToId, refreshKey]);

  return (
    <Card className="mt-6">
      <CardHeader>
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold text-gray-700 dark:text-gray-300">
            Sent emails
          </h2>
          <button
            onClick={fetchRows}
            className="text-xs text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200"
            disabled={loading}
          >
            {loading ? 'Refreshing…' : 'Refresh'}
          </button>
        </div>
      </CardHeader>
      <CardBody padding="none">
        {error && (
          <div className="px-4 py-3 text-sm text-red-600 bg-red-50 dark:bg-red-500/10">
            {error}
          </div>
        )}
        {!error && !loading && rows.length === 0 && (
          <div className="px-4 py-6 text-sm text-gray-400 dark:text-gray-500 text-center">
            No emails have been sent yet.
          </div>
        )}
        {!error && rows.length > 0 && (
          <table className="min-w-full text-sm">
            <thead>
              <tr className="bg-gray-50 dark:bg-gray-900 border-b border-gray-100 dark:border-gray-800 text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide">
                <th className="px-4 py-2.5 text-left">Recipient</th>
                <th className="px-4 py-2.5 text-left">Subject</th>
                <th className="px-4 py-2.5 text-left">Sent</th>
                <th className="px-4 py-2.5 text-left">Opens</th>
                <th className="px-4 py-2.5 text-left">Clicks</th>
                <th className="px-4 py-2.5 w-8" />
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const isOpen = expanded[r.id];
                return (
                  <Fragment key={r.id}>
                    <tr
                      className="border-b border-gray-100 dark:border-gray-800 last:border-0 hover:bg-gray-50/60 dark:hover:bg-gray-800/40 cursor-pointer"
                      onClick={() =>
                        setExpanded((m) => ({ ...m, [r.id]: !m[r.id] }))
                      }
                    >
                      <td className="px-4 py-2.5 text-gray-700 dark:text-gray-300">
                        {r.recipientEmail ?? '—'}
                      </td>
                      <td className="px-4 py-2.5 text-gray-700 dark:text-gray-300 truncate max-w-xs">
                        {r.subject ?? '—'}
                      </td>
                      <td className="px-4 py-2.5 text-gray-500 dark:text-gray-400 whitespace-nowrap">
                        {fmtDate(r.sentAt)}
                      </td>
                      <td className="px-4 py-2.5">
                        {r.openCount > 0 ? (
                          <Badge variant="success">
                            {r.openCount}
                            {r.lastOpenedAt
                              ? ` · ${relTime(r.lastOpenedAt)}`
                              : ''}
                          </Badge>
                        ) : (
                          <Badge variant="muted">0</Badge>
                        )}
                      </td>
                      <td className="px-4 py-2.5">
                        {r.clickCount > 0 ? (
                          <Badge variant="info">
                            {r.clickCount}
                            {r.lastClickedAt
                              ? ` · ${relTime(r.lastClickedAt)}`
                              : ''}
                          </Badge>
                        ) : (
                          <Badge variant="muted">0</Badge>
                        )}
                      </td>
                      <td className="px-2 py-2.5 text-gray-400">
                        <span
                          className={`inline-block transition-transform ${isOpen ? 'rotate-180' : ''}`}
                          aria-hidden
                        >
                          ▾
                        </span>
                      </td>
                    </tr>
                    {isOpen && (
                      <tr className="bg-gray-50/50 dark:bg-gray-900/40">
                        <td colSpan={6} className="px-6 py-3">
                          <div className="text-xs text-gray-500 dark:text-gray-400 grid grid-cols-1 sm:grid-cols-2 gap-3">
                            <div>
                              <span className="font-semibold text-gray-700 dark:text-gray-300">
                                First open:
                              </span>{' '}
                              {fmtDate(r.openedAt)}
                            </div>
                            <div>
                              <span className="font-semibold text-gray-700 dark:text-gray-300">
                                First click:
                              </span>{' '}
                              {fmtDate(r.clickedAt)}
                            </div>
                          </div>
                          <div className="mt-3">
                            <p className="text-xs font-semibold text-gray-700 dark:text-gray-300 mb-1">
                              Click log
                            </p>
                            {!r.clickedUrls?.length ? (
                              <p className="text-xs text-gray-400 dark:text-gray-500">
                                No clicks recorded.
                              </p>
                            ) : (
                              <ul className="space-y-1">
                                {r.clickedUrls.map((c, i) => (
                                  <li
                                    key={i}
                                    className="text-xs text-gray-600 dark:text-gray-400 flex flex-wrap gap-x-3"
                                  >
                                    <span className="text-gray-400 dark:text-gray-500 whitespace-nowrap">
                                      {fmtDate(c.at)}
                                    </span>
                                    <a
                                      href={c.url}
                                      target="_blank"
                                      rel="noreferrer"
                                      className="text-primary truncate max-w-md"
                                    >
                                      {c.url}
                                    </a>
                                    {c.ip && (
                                      <span className="text-gray-400 dark:text-gray-500">
                                        ip {c.ip}
                                      </span>
                                    )}
                                  </li>
                                ))}
                              </ul>
                            )}
                          </div>
                        </td>
                      </tr>
                    )}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        )}
      </CardBody>
    </Card>
  );
}

export default SentEmailsPanel;
