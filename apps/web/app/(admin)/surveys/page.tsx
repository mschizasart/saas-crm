'use client';

import { useEffect, useState, useCallback } from 'react';
import Link from 'next/link';
import { ListPageLayout } from '@/components/layouts/list-page-layout';
import { Card } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/empty-state';
import { inputClass } from '@/components/ui/form-field';

const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001';

interface Survey {
  id: string;
  name: string;
  description?: string | null;
  active: boolean;
  hash: string;
  createdAt: string;
  _count?: { submissions: number; questions: number };
}

function getToken() {
  if (typeof window === 'undefined') return null;
  return localStorage.getItem('access_token');
}

export default function SurveysPage() {
  const [data, setData] = useState<Survey[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    const token = getToken();
    const res = await fetch(
      `${API_BASE}/api/v1/surveys?search=${encodeURIComponent(search)}`,
      { headers: { Authorization: `Bearer ${token}` } },
    );
    const json = await res.json();
    setData(json.data ?? []);
    setLoading(false);
  }, [search]);

  useEffect(() => {
    load();
  }, [load]);

  async function handleDelete(id: string) {
    if (!confirm('Delete this survey?')) return;
    const token = getToken();
    await fetch(`${API_BASE}/api/v1/surveys/${id}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${token}` },
    });
    load();
  }

  const filtersNode = (
    <input
      aria-label="Search surveys"
      type="text"
      placeholder="Search surveys..."
      value={search}
      onChange={(e) => setSearch(e.target.value)}
      className={`${inputClass} max-w-md`}
    />
  );

  return (
    <ListPageLayout
      title="Surveys"
      primaryAction={{ label: 'New Survey', href: '/surveys/new' }}
      filters={filtersNode}
    >
      {loading ? (
        <p>Loading…</p>
      ) : data.length === 0 ? (
        <Card>
          <EmptyState
            title="No surveys yet"
            action={{ label: 'New Survey', href: '/surveys/new' }}
          />
        </Card>
      ) : (
        <Card>
          <div className="divide-y divide-gray-100 dark:divide-gray-800">
            {data.map((s) => (
              <div
                key={s.id}
                className="p-4 flex items-center justify-between"
              >
                <div>
                  <Link
                    href={`/surveys/${s.id}`}
                    className="font-semibold text-primary hover:underline"
                  >
                    {s.name}
                  </Link>
                  {s.description && (
                    <p className="text-sm text-gray-600 dark:text-gray-400">{s.description}</p>
                  )}
                  <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                    {s._count?.questions ?? 0} questions ·{' '}
                    {s._count?.submissions ?? 0} submissions ·{' '}
                    {s.active ? 'Active' : 'Inactive'}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <a
                    href={`/survey/${s.hash}`}
                    target="_blank"
                    rel="noreferrer"
                    className="text-sm text-primary hover:underline"
                  >
                    Public link
                  </a>
                  <button
                    onClick={() => handleDelete(s.id)}
                    className="text-sm text-red-600 hover:underline"
                  >
                    Delete
                  </button>
                </div>
              </div>
            ))}
          </div>
        </Card>
      )}
    </ListPageLayout>
  );
}
