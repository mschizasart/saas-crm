'use client';

import { useEffect, useState, useCallback } from 'react';
import Link from 'next/link';

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

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">Surveys</h1>
        <Link
          href="/surveys/new"
          className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700"
        >
          + New Survey
        </Link>
      </div>

      <input
        type="text"
        placeholder="Search surveys..."
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        className="w-full max-w-md px-3 py-2 border rounded"
      />

      {loading ? (
        <p>Loading…</p>
      ) : data.length === 0 ? (
        <p className="text-gray-500">No surveys yet.</p>
      ) : (
        <div className="bg-white rounded-lg shadow divide-y">
          {data.map((s) => (
            <div
              key={s.id}
              className="p-4 flex items-center justify-between"
            >
              <div>
                <Link
                  href={`/surveys/${s.id}`}
                  className="font-semibold text-blue-700 hover:underline"
                >
                  {s.name}
                </Link>
                {s.description && (
                  <p className="text-sm text-gray-600">{s.description}</p>
                )}
                <p className="text-xs text-gray-500 mt-1">
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
                  className="text-sm text-blue-600 hover:underline"
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
      )}
    </div>
  );
}
