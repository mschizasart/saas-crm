'use client';

import { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';

interface Task {
  id: string;
  name: string;
  status: string;
  priority: string;
  dueDate: string | null;
  project?: { id: string; name: string } | null;
  assignments?: Array<{
    user: { id: string; firstName: string; lastName: string } | null;
  }>;
}

const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001';

function getToken() {
  if (typeof window === 'undefined') return null;
  return localStorage.getItem('access_token');
}

const STATUSES = [
  '',
  'not_started',
  'in_progress',
  'testing',
  'awaiting_feedback',
  'complete',
];

function StatusBadge({ status }: { status: string }) {
  const colors: Record<string, string> = {
    not_started: 'bg-gray-100 text-gray-600',
    in_progress: 'bg-blue-100 text-blue-700',
    testing: 'bg-yellow-100 text-yellow-700',
    awaiting_feedback: 'bg-purple-100 text-purple-700',
    complete: 'bg-green-100 text-green-700',
  };
  return (
    <span
      className={`text-xs font-medium px-2 py-0.5 rounded-full ${colors[status] ?? 'bg-gray-100 text-gray-500'}`}
    >
      {status.replace(/_/g, ' ')}
    </span>
  );
}

export default function TasksPage() {
  const [tab, setTab] = useState<'all' | 'my'>('all');
  const [tasks, setTasks] = useState<Task[]>([]);
  const [status, setStatus] = useState('');
  const [search, setSearch] = useState('');
  const [dueBefore, setDueBefore] = useState('');
  const [loading, setLoading] = useState(true);

  const fetchTasks = useCallback(async () => {
    setLoading(true);
    try {
      const token = getToken();
      const params = new URLSearchParams();
      if (status) params.set('status', status);
      if (search) params.set('search', search);
      if (dueBefore) params.set('dueBefore', dueBefore);
      const url =
        tab === 'my'
          ? `${API_BASE}/api/v1/tasks/my`
          : `${API_BASE}/api/v1/tasks?${params.toString()}`;
      const res = await fetch(url, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.ok) {
        const json = await res.json();
        setTasks(Array.isArray(json) ? json : json.data ?? []);
      }
    } finally {
      setLoading(false);
    }
  }, [tab, status, search, dueBefore]);

  useEffect(() => {
    fetchTasks();
  }, [fetchTasks]);

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold text-gray-900">Tasks</h1>
        <div className="flex items-center gap-2">
          <Link
            href="/tasks/kanban"
            className="inline-flex items-center gap-1.5 border border-gray-200 text-gray-700 text-sm font-medium px-4 py-2 rounded-lg hover:bg-gray-50 transition-colors"
          >
            Kanban
          </Link>
          <Link
            href="/tasks/new"
            className="inline-flex items-center gap-1.5 bg-primary text-white text-sm font-medium px-4 py-2 rounded-lg hover:bg-primary/90"
          >
            <span className="text-lg leading-none">+</span>New Task
          </Link>
        </div>
      </div>

      <div className="flex gap-2 mb-4 border-b border-gray-200">
        {(['all', 'my'] as const).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={[
              'px-4 py-2 text-sm font-medium -mb-px border-b-2',
              tab === t
                ? 'border-primary text-primary'
                : 'border-transparent text-gray-500 hover:text-gray-700',
            ].join(' ')}
          >
            {t === 'all' ? 'All Tasks' : 'My Tasks'}
          </button>
        ))}
      </div>

      {tab === 'all' && (
        <div className="flex flex-wrap gap-2 mb-4">
          <input
            type="text"
            placeholder="Search..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="border border-gray-200 rounded-lg px-3 py-2 text-sm"
          />
          <select
            value={status}
            onChange={(e) => setStatus(e.target.value)}
            className="border border-gray-200 rounded-lg px-3 py-2 text-sm bg-white"
          >
            {STATUSES.map((s) => (
              <option key={s} value={s}>
                {s ? s.replace(/_/g, ' ') : 'All statuses'}
              </option>
            ))}
          </select>
          <input
            type="date"
            value={dueBefore}
            onChange={(e) => setDueBefore(e.target.value)}
            className="border border-gray-200 rounded-lg px-3 py-2 text-sm"
          />
        </div>
      )}

      <div className="bg-white rounded-xl border border-gray-100 shadow-sm overflow-hidden">
        <table className="min-w-full text-sm">
          <thead>
            <tr className="bg-gray-50 border-b border-gray-100 text-left text-xs font-semibold text-gray-500 uppercase">
              <th className="px-4 py-3">Name</th>
              <th className="px-4 py-3">Project</th>
              <th className="px-4 py-3">Status</th>
              <th className="px-4 py-3">Priority</th>
              <th className="px-4 py-3">Due</th>
              <th className="px-4 py-3">Assignees</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr>
                <td colSpan={6} className="px-4 py-10 text-center text-gray-400">
                  Loading...
                </td>
              </tr>
            ) : tasks.length === 0 ? (
              <tr>
                <td colSpan={6} className="px-4 py-10 text-center text-gray-400">
                  No tasks found
                </td>
              </tr>
            ) : (
              tasks.map((t) => (
                <tr
                  key={t.id}
                  className="border-b border-gray-100 last:border-0 hover:bg-gray-50/60"
                >
                  <td className="px-4 py-3 font-medium">
                    <Link href={`/tasks/${t.id}`} className="hover:text-primary">
                      {t.name}
                    </Link>
                  </td>
                  <td className="px-4 py-3 text-gray-500">
                    {t.project?.name ?? '—'}
                  </td>
                  <td className="px-4 py-3">
                    <StatusBadge status={t.status} />
                  </td>
                  <td className="px-4 py-3 text-gray-500 capitalize">
                    {t.priority}
                  </td>
                  <td className="px-4 py-3 text-gray-500">
                    {t.dueDate ? new Date(t.dueDate).toLocaleDateString() : '—'}
                  </td>
                  <td className="px-4 py-3 text-gray-500 text-xs">
                    {t.assignments?.length
                      ? t.assignments
                          .map((a) =>
                            a.user
                              ? `${a.user.firstName} ${a.user.lastName}`
                              : '',
                          )
                          .filter(Boolean)
                          .join(', ')
                      : '—'}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
