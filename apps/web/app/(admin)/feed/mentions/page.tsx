'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { ListPageLayout } from '@/components/layouts/list-page-layout';
import { Card } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/empty-state';
import { apiFetch } from '@/lib/api';

/**
 * "My Mentions" inbox (Wave G3) — paged list of recent @mentions in
 * record feeds. Each row links to the source record's feed and scrolls
 * the relevant post into view via a `#post-<id>` hash that
 * `RecordFeed` reads.
 *
 * Uses `apiFetch` so token refresh + 401 redirect just work.
 */

type EntityType = 'client' | 'lead' | 'opportunity' | 'ticket';

interface MentionRow {
  id: string;
  createdAt: string;
  notifiedAt: string | null;
  post: {
    id: string;
    bodyPreview: string;
    entityType: EntityType;
    entityId: string;
    parentPostId: string | null;
    createdAt: string;
    author: {
      id: string;
      firstName: string | null;
      lastName: string | null;
      email: string | null;
    } | null;
  };
}

interface ListResponse {
  data: MentionRow[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

function relativeTime(iso: string): string {
  const s = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}

function entityPath(t: EntityType, id: string, postId: string): string {
  // Hash matches the `id="post-<id>"` set on each rendered post in
  // RecordFeed so the browser scrolls to it automatically.
  switch (t) {
    case 'client':
      return `/clients/${id}#post-${postId}`;
    case 'lead':
      return `/leads/${id}#post-${postId}`;
    case 'opportunity':
      return `/opportunities/${id}#post-${postId}`;
    case 'ticket':
      return `/tickets/${id}#post-${postId}`;
  }
}

function authorName(row: MentionRow): string {
  const a = row.post.author;
  if (!a) return '[former member]';
  const n = `${a.firstName ?? ''} ${a.lastName ?? ''}`.trim();
  return n || a.email || '[unknown]';
}

export default function MyMentionsPage() {
  const [items, setItems] = useState<MentionRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const limit = 25;

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const qs = new URLSearchParams({
        page: String(page),
        limit: String(limit),
      });
      const res = await apiFetch(`/api/v1/feed/mentions/my?${qs.toString()}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json: ListResponse = await res.json();
      setItems(json.data ?? []);
      setTotal(json.total ?? 0);
    } catch (e) {
      setError((e as Error).message ?? 'Failed to load mentions');
    } finally {
      setLoading(false);
    }
  }, [page]);

  useEffect(() => {
    load();
  }, [load]);

  const totalPages = Math.max(1, Math.ceil(total / limit));

  return (
    <ListPageLayout
      title="My Mentions"
      subtitle="Recent @mentions across every record's feed."
    >
      {error && (
        <div className="px-3 py-2 mb-4 text-xs bg-red-50 dark:bg-red-900/20 text-red-700 dark:text-red-300 border border-red-200 dark:border-red-800 rounded-md">
          {error}
        </div>
      )}

      {loading ? (
        <Card className="p-6 text-sm text-gray-500">Loading…</Card>
      ) : items.length === 0 ? (
        <EmptyState
          title="No mentions yet"
          description="When a teammate @mentions you on any record's feed, it'll show up here."
        />
      ) : (
        <Card className="divide-y divide-gray-100 dark:divide-gray-800">
          {items.map((m) => (
            <Link
              key={m.id}
              href={entityPath(m.post.entityType, m.post.entityId, m.post.id)}
              className="block px-4 py-3 hover:bg-gray-50 dark:hover:bg-gray-900/50"
            >
              <div className="flex items-baseline justify-between gap-2">
                <span className="text-sm font-medium">
                  {authorName(m)}{' '}
                  <span className="text-gray-400 font-normal">
                    mentioned you in {m.post.entityType}
                  </span>
                </span>
                <span className="text-[11px] text-gray-400 flex-shrink-0">
                  {relativeTime(m.createdAt)}
                </span>
              </div>
              <p className="mt-1 text-xs text-gray-600 dark:text-gray-300 line-clamp-2 whitespace-pre-wrap">
                {m.post.bodyPreview}
              </p>
            </Link>
          ))}
        </Card>
      )}

      {totalPages > 1 && (
        <div className="mt-4 flex items-center justify-between text-xs text-gray-500">
          <span>
            Page {page} of {totalPages} ({total} total)
          </span>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              disabled={page <= 1}
              className="px-3 py-1.5 rounded-md border border-gray-200 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-800 disabled:opacity-40"
            >
              Previous
            </button>
            <button
              type="button"
              onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
              disabled={page >= totalPages}
              className="px-3 py-1.5 rounded-md border border-gray-200 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-800 disabled:opacity-40"
            >
              Next
            </button>
          </div>
        </div>
      )}
    </ListPageLayout>
  );
}
