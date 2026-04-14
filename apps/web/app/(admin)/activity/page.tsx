'use client';

import { useCallback, useEffect, useState } from 'react';

const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001';
const getToken = () =>
  typeof window === 'undefined' ? null : localStorage.getItem('access_token');

interface ActivityItem {
  id: string;
  action: string;
  relType: string | null;
  relId: string | null;
  description: string | null;
  createdAt: string;
  user?: { id: string; firstName: string; lastName: string; avatar: string | null } | null;
}

function relativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const s = Math.floor(diff / 1000);
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  return `${d}d ago`;
}

function initials(first = '', last = '') {
  return ((first[0] ?? '') + (last[0] ?? '')).toUpperCase() || '?';
}

export default function ActivityPage() {
  const [items, setItems] = useState<ActivityItem[]>([]);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [loading, setLoading] = useState(true);
  const [userFilter, setUserFilter] = useState('');
  const [actionFilter, setActionFilter] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ page: String(page), limit: '25' });
      if (userFilter) params.set('userId', userFilter);
      if (actionFilter) params.set('action', actionFilter);
      if (from) params.set('from', from);
      if (to) params.set('to', to);

      const res = await fetch(`${API_BASE}/api/v1/activity-log?${params}`, {
        headers: { Authorization: `Bearer ${getToken()}` },
      });
      const data = await res.json();
      setItems(data.data ?? []);
      setTotalPages(data.totalPages ?? 1);
    } finally {
      setLoading(false);
    }
  }, [page, userFilter, actionFilter, from, to]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    const t = setInterval(load, 30000);
    return () => clearInterval(t);
  }, [load]);

  return (
    <div>
      <h1 className="text-2xl font-bold text-gray-900 mb-6">Activity</h1>

      <div className="flex flex-wrap gap-3 mb-4">
        <input
          placeholder="Filter by user ID"
          value={userFilter}
          onChange={(e) => setUserFilter(e.target.value)}
          className="px-3 py-2 border border-gray-200 rounded-lg text-sm"
        />
        <input
          placeholder="Filter by action"
          value={actionFilter}
          onChange={(e) => setActionFilter(e.target.value)}
          className="px-3 py-2 border border-gray-200 rounded-lg text-sm"
        />
        <input
          type="date"
          value={from}
          onChange={(e) => setFrom(e.target.value)}
          className="px-3 py-2 border border-gray-200 rounded-lg text-sm"
        />
        <input
          type="date"
          value={to}
          onChange={(e) => setTo(e.target.value)}
          className="px-3 py-2 border border-gray-200 rounded-lg text-sm"
        />
      </div>

      <div className="bg-white rounded-xl border border-gray-100 shadow-sm">
        {loading ? (
          <p className="p-6 text-sm text-gray-400">Loading…</p>
        ) : items.length === 0 ? (
          <p className="p-6 text-sm text-gray-400">No activity yet.</p>
        ) : (
          <ul className="divide-y divide-gray-100">
            {items.map((a) => (
              <li key={a.id} className="p-4 flex items-start gap-3">
                <div className="w-8 h-8 rounded-full bg-primary/10 text-primary flex items-center justify-center text-xs font-semibold flex-shrink-0">
                  {a.user ? initials(a.user.firstName, a.user.lastName) : '•'}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm text-gray-800">
                    {a.user && (
                      <span className="font-medium">
                        {a.user.firstName} {a.user.lastName}{' '}
                      </span>
                    )}
                    {a.description ?? a.action}
                  </p>
                  <p className="text-xs text-gray-400 mt-0.5">
                    {relativeTime(a.createdAt)}
                    {a.relType && a.relId && (
                      <>
                        {' · '}
                        <a
                          href={`/${a.relType}s/${a.relId}`}
                          className="text-primary hover:underline"
                        >
                          View {a.relType}
                        </a>
                      </>
                    )}
                  </p>
                </div>
              </li>
            ))}
          </ul>
        )}
        <div className="flex items-center justify-between p-4 border-t border-gray-100">
          <span className="text-xs text-gray-500">
            Page {page} of {totalPages}
          </span>
          <div className="flex gap-2">
            <button
              disabled={page <= 1}
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              className="px-3 py-1.5 text-xs border border-gray-200 rounded-md disabled:opacity-40"
            >
              Previous
            </button>
            <button
              disabled={page >= totalPages}
              onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
              className="px-3 py-1.5 text-xs border border-gray-200 rounded-md disabled:opacity-40"
            >
              Next
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
