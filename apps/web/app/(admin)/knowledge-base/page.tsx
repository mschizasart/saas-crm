'use client';

import { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';

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

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold text-gray-900">Knowledge Base</h1>
        <Link href="/knowledge-base/new" className="inline-flex items-center gap-1.5 bg-primary text-white text-sm font-medium px-4 py-2 rounded-lg hover:bg-primary/90">
          <span className="text-lg leading-none">+</span>New Article
        </Link>
      </div>

      <div className="flex gap-3 mb-4">
        <input
          placeholder="Search articles…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="flex-1 max-w-sm px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary bg-white"
        />
        <select
          value={groupId}
          onChange={(e) => setGroupId(e.target.value)}
          className="px-3 py-2 text-sm border border-gray-200 rounded-lg bg-white"
        >
          <option value="">All groups</option>
          {groups.map((g) => (
            <option key={g.id} value={g.id}>{g.name}</option>
          ))}
        </select>
      </div>

      <div className="bg-white rounded-xl border border-gray-100 shadow-sm overflow-hidden">
        {error && <div className="px-4 py-3 bg-red-50 text-sm text-red-600">{error}</div>}
        <table className="min-w-full text-sm">
          <thead>
            <tr className="bg-gray-50 border-b border-gray-100 text-left text-xs font-semibold text-gray-500 uppercase">
              <th className="px-4 py-3">Title</th>
              <th className="px-4 py-3">Group</th>
              <th className="px-4 py-3">Active</th>
              <th className="px-4 py-3">Updated</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              Array.from({ length: 5 }).map((_, i) => (
                <tr key={i} className="border-b border-gray-100">
                  {Array.from({ length: 4 }).map((__, j) => (
                    <td key={j} className="px-4 py-3"><div className="h-4 bg-gray-100 rounded animate-pulse" /></td>
                  ))}
                </tr>
              ))
            ) : articles.length === 0 ? (
              <tr><td colSpan={4} className="px-4 py-12 text-center text-sm text-gray-400">No articles</td></tr>
            ) : articles.map((a) => (
              <tr key={a.id} className="border-b border-gray-100 hover:bg-gray-50/60">
                <td className="px-4 py-3 font-medium text-gray-900">{a.title}</td>
                <td className="px-4 py-3 text-gray-600">{a.group?.name ?? '—'}</td>
                <td className="px-4 py-3">
                  <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${a.active ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-500'}`}>
                    {a.active ? 'Active' : 'Draft'}
                  </span>
                </td>
                <td className="px-4 py-3 text-gray-500 text-xs">{a.updatedAt ? new Date(a.updatedAt).toLocaleDateString() : '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
