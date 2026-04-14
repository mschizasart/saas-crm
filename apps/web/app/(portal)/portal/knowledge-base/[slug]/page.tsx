'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';

interface Article {
  id: string;
  title: string;
  slug: string;
  content: string;
  group?: { id: string; name: string } | null;
  updatedAt?: string;
}

const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001';

function getToken(): string | null {
  if (typeof window === 'undefined') return null;
  return localStorage.getItem('access_token');
}

export default function PortalArticlePage() {
  const { slug } = useParams() as { slug: string };
  const [article, setArticle] = useState<Article | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch(`${API_BASE}/api/v1/knowledge-base/${slug}`, { headers: { Authorization: `Bearer ${getToken()}` } });
        if (!res.ok) throw new Error(`Failed (${res.status})`);
        const json = await res.json();
        setArticle(json.data ?? json);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed');
      } finally {
        setLoading(false);
      }
    })();
  }, [slug]);

  if (loading) return <div className="animate-pulse h-96 bg-gray-100 rounded-xl" />;
  if (error || !article) return <div className="text-red-600">{error ?? 'Not found'}</div>;

  return (
    <article className="max-w-3xl mx-auto">
      <div className="mb-4"><Link href="/portal/knowledge-base" className="text-sm text-gray-500 hover:text-primary">← Back to knowledge base</Link></div>
      <h1 className="text-3xl font-bold text-gray-900 mb-2">{article.title}</h1>
      {article.group && <p className="text-sm text-gray-500 mb-6">in {article.group.name}</p>}
      <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-8">
        <div className="prose max-w-none" dangerouslySetInnerHTML={{ __html: article.content }} />
      </div>
    </article>
  );
}
