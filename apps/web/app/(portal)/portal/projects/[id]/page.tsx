'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';

interface Task {
  id: string;
  name: string;
  status: string;
  dueDate?: string;
}

interface Project {
  id: string;
  name: string;
  description: string | null;
  status: string;
  startDate?: string;
  deadline?: string;
  tasks?: Task[];
}

const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001';

function getToken(): string | null {
  if (typeof window === 'undefined') return null;
  return localStorage.getItem('access_token');
}

export default function PortalProjectDetailPage() {
  const { id } = useParams() as { id: string };
  const [p, setP] = useState<Project | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch(`${API_BASE}/api/v1/portal/projects/${id}`, { headers: { Authorization: `Bearer ${getToken()}` } });
        if (!res.ok) throw new Error(`Failed (${res.status})`);
        const json = await res.json();
        setP(json.data ?? json);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed');
      } finally {
        setLoading(false);
      }
    })();
  }, [id]);

  if (loading) return <div className="animate-pulse h-96 bg-gray-100 rounded-xl" />;
  if (error || !p) return <div className="text-red-600">{error ?? 'Not found'}</div>;

  return (
    <div>
      <div className="mb-4"><Link href="/portal/projects" className="text-sm text-gray-500 hover:text-primary">← Back to projects</Link></div>

      <div className="flex items-start justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">{p.name}</h1>
          <p className="text-sm text-gray-500 mt-1">
            {p.startDate ? new Date(p.startDate).toLocaleDateString() : '—'} → {p.deadline ? new Date(p.deadline).toLocaleDateString() : '—'}
          </p>
        </div>
        <span className="inline-flex items-center px-3 py-1 rounded-full text-xs font-medium bg-primary/10 text-primary">{p.status}</span>
      </div>

      {p.description && (
        <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-6 mb-6">
          <p className="text-sm text-gray-700 whitespace-pre-wrap">{p.description}</p>
        </div>
      )}

      <h2 className="text-lg font-semibold text-gray-900 mb-3">Tasks</h2>
      <div className="bg-white rounded-xl border border-gray-100 shadow-sm overflow-hidden">
        {(p.tasks ?? []).length === 0 ? (
          <div className="py-12 text-center text-sm text-gray-400">No tasks yet</div>
        ) : (
          <ul className="divide-y divide-gray-100">
            {(p.tasks ?? []).map((t) => (
              <li key={t.id} className="flex items-center justify-between px-4 py-3">
                <span className="text-sm text-gray-900">{t.name}</span>
                <div className="flex items-center gap-3">
                  {t.dueDate && <span className="text-xs text-gray-500">{new Date(t.dueDate).toLocaleDateString()}</span>}
                  <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-gray-100 text-gray-700">{t.status}</span>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
