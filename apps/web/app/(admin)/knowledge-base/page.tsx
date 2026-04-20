'use client';

import { useState, useEffect, useCallback } from 'react';
import { ListPageLayout } from '@/components/layouts/list-page-layout';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { TableSkeleton } from '@/components/ui/table-skeleton';
import { ErrorBanner } from '@/components/ui/error-banner';
import { inputClass } from '@/components/ui/form-field';

interface Article {
  id: string;
  title: string;
  slug: string;
  active: boolean;
  group?: { id: string; name: string } | null;
  updatedAt?: string;
}

interface Group { id: string; name: string; }

const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001';

function getToken(): string | null {
  if (typeof window === 'undefined') return null;
  return localStorage.getItem('access_token');
}

export default function KnowledgeBasePage() {
  const [articles, setArticles] = useState<Article[]>([]);
  const [groups, setGroups] = useState<Group[]>([]);
  const [groupId, setGroupId] = useState('');
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchArticles = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (groupId) params.set('groupId', groupId);
      if (search) params.set('search', search);
      const res = await fetch(`${API_BASE}/api/v1/knowledge-base?${params}`, { headers: { Authorization: `Bearer ${getToken()}` } });
      if (!res.ok) throw new Error(`Failed (${res.status})`);
      const json = await res.json();
      setArticles(json.data ?? json ?? []);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed');
    } finally {
      setLoading(false);
    }
  }, [groupId, search]);

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch(`${API_BASE}/api/v1/knowledge-base/groups`, { headers: { Authorization: `Bearer ${getToken()}` } });
        if (res.ok) {
          const json = await res.json();
          setGroups(Array.isArray(json) ? json : json.data ?? []);
        }
      } catch { /* ignore */ }
    })();
  }, []);

  useEffect(() => {
    const t = setTimeout(fetchArticles, 300);
    return () => clearTimeout(t);
  }, [fetchArticles]);

  const filtersNode = (
    <div className="flex gap-3">
      <input
        aria-label="Search articles"
        placeholder="Search articles…"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        className={`${inputClass} flex-1 max-w-sm`}
      />
      <select
        aria-label="Filter by group"
        value={groupId}
        onChange={(e) => setGroupId(e.target.value)}
        className={`${inputClass} w-auto`}
      >
        <option value="">All groups</option>
        {groups.map((g) => (
          <option key={g.id} value={g.id}>{g.name}</option>
        ))}
      </select>
    </div>
  );

  return (
    <ListPageLayout
      title="Knowledge Base"
      primaryAction={{ label: 'New Article', href: '/knowledge-base/new' }}
      filters={filtersNode}
    >
      {error && (
        <div className="mb-4">
          <ErrorBanner message={error} onRetry={fetchArticles} onDismiss={() => setError(null)} />
        </div>
      )}

      <Card>
        <table className="min-w-full text-sm">
          <thead>
            <tr className="bg-gray-50 dark:bg-gray-900 border-b border-gray-100 dark:border-gray-800 text-left text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase">
              <th className="px-4 py-3">Title</th>
              <th className="px-4 py-3">Group</th>
              <th className="px-4 py-3">Active</th>
              <th className="px-4 py-3">Updated</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <TableSkeleton rows={5} columns={4} />
            ) : articles.length === 0 ? (
              <tr><td colSpan={4} className="px-4 py-12 text-center text-sm text-gray-400 dark:text-gray-500">No articles</td></tr>
            ) : articles.map((a) => (
              <tr key={a.id} className="border-b border-gray-100 dark:border-gray-800 hover:bg-gray-50/60">
                <td className="px-4 py-3 font-medium text-gray-900 dark:text-gray-100">{a.title}</td>
                <td className="px-4 py-3 text-gray-600 dark:text-gray-400">{a.group?.name ?? '—'}</td>
                <td className="px-4 py-3">
                  <Badge variant={a.active ? 'success' : 'muted'}>
                    {a.active ? 'Active' : 'Draft'}
                  </Badge>
                </td>
                <td className="px-4 py-3 text-gray-500 dark:text-gray-400 text-xs">{a.updatedAt ? new Date(a.updatedAt).toLocaleDateString() : '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
    </ListPageLayout>
  );
}
