'use client';

import { useEffect, useState, useCallback } from 'react';
import Link from 'next/link';
import { PhoneIncoming, PhoneOutgoing } from 'lucide-react';
import { ListPageLayout } from '@/components/layouts/list-page-layout';
import { Card } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/empty-state';
import { Badge, type BadgeVariant } from '@/components/ui/badge';
import { apiFetch } from '@/lib/api';

interface Call {
  id: string;
  relType: 'lead' | 'client' | null;
  relId: string | null;
  direction: 'outbound' | 'inbound';
  fromNumber: string | null;
  toNumber: string | null;
  status: string | null;
  outcome: string | null;
  durationSeconds: number | null;
  notes: string | null;
  recordingUrl: string | null;
  loggedById: string | null;
  occurredAt: string | null;
  createdAt: string;
}

interface CallsResponse {
  data: Call[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

const OUTCOME_LABELS: Record<string, string> = {
  connected: 'Connected',
  voicemail: 'Voicemail',
  no_answer: 'No answer',
  busy: 'Busy',
  wrong_number: 'Wrong number',
  callback_requested: 'Callback requested',
};

const OUTCOME_VARIANT: Record<string, BadgeVariant> = {
  connected: 'success',
  voicemail: 'info',
  callback_requested: 'info',
  no_answer: 'warning',
  busy: 'warning',
  wrong_number: 'error',
  failed: 'error',
};

function formatDuration(seconds: number | null): string {
  if (!seconds || seconds <= 0) return '0:00';
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

export default function CallsPage() {
  const [calls, setCalls] = useState<Call[]>([]);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const limit = 25;

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await apiFetch(`/api/v1/calls?page=${page}&limit=${limit}`);
      if (res.ok) {
        const json: CallsResponse = await res.json();
        setCalls(json.data ?? []);
        setTotalPages(json.totalPages ?? 1);
      }
    } finally {
      setLoading(false);
    }
  }, [page]);

  useEffect(() => {
    load();
  }, [load]);

  return (
    <ListPageLayout
      title="Calls"
      subtitle="Every logged and placed call across your CRM"
      pagination={
        !loading && calls.length > 0 && totalPages > 1 ? (
          <div className="flex items-center justify-between text-sm text-gray-500 dark:text-gray-400">
            <span>
              Page {page} of {totalPages}
            </span>
            <div className="flex gap-2">
              <button
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                disabled={page <= 1}
                className="px-3 py-1.5 border border-gray-200 dark:border-gray-700 rounded-lg disabled:opacity-50 hover:bg-gray-50 dark:hover:bg-gray-800"
              >
                Previous
              </button>
              <button
                onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                disabled={page >= totalPages}
                className="px-3 py-1.5 border border-gray-200 dark:border-gray-700 rounded-lg disabled:opacity-50 hover:bg-gray-50 dark:hover:bg-gray-800"
              >
                Next
              </button>
            </div>
          </div>
        ) : undefined
      }
    >
      {loading ? (
        <p className="text-sm text-gray-500">Loading…</p>
      ) : calls.length === 0 ? (
        <Card>
          <EmptyState
            title="No calls yet"
            description="Calls you log or place from a lead or client will appear here."
          />
        </Card>
      ) : (
        <Card>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs uppercase text-gray-500 dark:text-gray-400 border-b border-gray-100 dark:border-gray-800">
                  <th className="px-4 py-3 font-medium">Direction</th>
                  <th className="px-4 py-3 font-medium">Related to</th>
                  <th className="px-4 py-3 font-medium">Number</th>
                  <th className="px-4 py-3 font-medium">Outcome</th>
                  <th className="px-4 py-3 font-medium text-right">Duration</th>
                  <th className="px-4 py-3 font-medium">When</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
                {calls.map((c) => {
                  const inbound = c.direction === 'inbound';
                  const Icon = inbound ? PhoneIncoming : PhoneOutgoing;
                  const variant: BadgeVariant =
                    (c.outcome ? OUTCOME_VARIANT[c.outcome] : undefined) ??
                    (c.status ? OUTCOME_VARIANT[c.status] : undefined) ??
                    'default';
                  return (
                    <tr
                      key={c.id}
                      className="hover:bg-gray-50 dark:hover:bg-gray-800/50"
                    >
                      <td className="px-4 py-3">
                        <span className="inline-flex items-center gap-1.5 capitalize">
                          <Icon
                            className={`w-4 h-4 ${
                              inbound ? 'text-green-500' : 'text-blue-500'
                            }`}
                          />
                          {c.direction}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        {c.relType && c.relId ? (
                          <Link
                            href={
                              c.relType === 'lead'
                                ? `/leads/${c.relId}`
                                : `/clients/${c.relId}`
                            }
                            className="text-primary hover:underline capitalize"
                          >
                            {c.relType}
                          </Link>
                        ) : (
                          <span className="text-gray-400 dark:text-gray-500">—</span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-gray-600 dark:text-gray-400">
                        {c.toNumber ?? c.fromNumber ?? '—'}
                      </td>
                      <td className="px-4 py-3">
                        {c.outcome ? (
                          <Badge variant={variant}>
                            {OUTCOME_LABELS[c.outcome] ?? c.outcome}
                          </Badge>
                        ) : c.status ? (
                          <Badge variant={variant}>{c.status}</Badge>
                        ) : (
                          <span className="text-gray-400 dark:text-gray-500">—</span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-right tabular-nums">
                        {formatDuration(c.durationSeconds)}
                      </td>
                      <td className="px-4 py-3 text-gray-500 dark:text-gray-400">
                        {new Date(c.occurredAt ?? c.createdAt).toLocaleString()}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </Card>
      )}
    </ListPageLayout>
  );
}
