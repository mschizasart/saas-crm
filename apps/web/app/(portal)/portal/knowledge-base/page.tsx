'use client';

import { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';

interface Article {
  id: string;
  title: string;
  slug: string;
  group?: { id: string; name: string } | null;
  excerpt?: string;
}

const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001';

function getToken(): string | null {
  if (typeof window === 'undefined') return null;
  return localStorage.getItem('access_token');
}

export default function PortalKnowledgeBasePage() {
  const [articles, setArticles] = useState<Article[]>([]);
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchArticles = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
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
  }, [search]);

  useEffect(() => {
    const t = setTimeout(fetchArticles, 300);
    return () => clearTimeout(t);
  }, [fetchArticles]);

  // Group by group.name
  const grouped = articles.reduce<Record<string, Article[]>>((acc, a) => {
    const key = a.group?.name ?? 'General';
    (acc[key] ??= []).push(a);
    return acc;
  }, {});

  return (
    <div>
      <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100 mb-2">Knowledge Base</h1>
      <p className="text-sm text-gray-500 dark:text-gray-400 mb-6">Browse helpful articles or search for what you need.</p>

      <div className="mb-6">
        <input
          placeholder="Search articles…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="w-full max-w-md px-4 py-3 text-sm border border-gray-200 dark:border-gray-700 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary bg-white dark:bg-gray-900"
        />
      </div>

      {error && <div className="mb-4 px-4 py-3 bg-red-50 border border-red-100 text-sm text-red-600 rounded-lg">{error}</div>}

      {loading ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="h-28 bg-gray-100 dark:bg-gray-800 rounded-xl animate-pulse" />
          ))}
        </div>
      ) : Object.keys(grouped).length === 0 ? (
        <div className="bg-white dark:bg-gray-900 rounded-xl border border-gray-100 dark:border-gray-800 p-12 text-center text-sm text-gray-400 dark:text-gray-500">No articles found</div>
      ) : (
        Object.entries(grouped).map(([groupName, arts]) => (
          <section key={groupName} className="mb-8">
            <h2 className="text-sm font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide mb-3">{groupName}</h2>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              {arts.map((a) => (
                <Link key={a.id} href={`/knowledge-base/${a.slug}`} className="bg-white dark:bg-gray-900 rounded-xl border border-gray-100 dark:border-gray-800 shadow-sm p-4 hover:shadow-md transition-shadow">
                  <h3 className="font-semibold text-gray-900 dark:text-gray-100 mb-1">{a.title}</h3>
                  {a.excerpt && <p className="text-sm text-gray-600 dark:text-gray-400 line-clamp-2">{a.excerpt}</p>}
                </Link>
              ))}
            </div>
          </section>
        ))
      )}
    </div>
  );
}
