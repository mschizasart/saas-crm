'use client';

import { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';

interface Task {
  id: string;
  name: string;
  status: string;
  assignee?: { name?: string } | null;
  dueDate?: string;
}

interface Member {
  id: string;
  name?: string;
  email?: string;
  role?: string;
}

interface TimeEntry {
  id: string;
  description?: string;
  hours: number;
  date: string;
  user?: { name?: string } | null;
}

interface Project {
  id: string;
  name: string;
  description: string | null;
  status: string;
  startDate?: string;
  deadline?: string;
  billingType?: string;
  estimatedHours?: number;
  client?: { id: string; company?: string; company_name?: string } | null;
  tasks?: Task[];
  members?: Member[];
  timeEntries?: TimeEntry[];
}

const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001';

function getToken(): string | null {
  if (typeof window === 'undefined') return null;
  return localStorage.getItem('access_token');
}

type Tab = 'overview' | 'tasks' | 'members' | 'time';

export default function ProjectDetailPage() {
  const { id } = useParams() as { id: string };
  const [p, setP] = useState<Project | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>('overview');

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`${API_BASE}/api/v1/projects/${id}`, { headers: { Authorization: `Bearer ${getToken()}` } });
      if (!res.ok) throw new Error(`Failed (${res.status})`);
      const json = await res.json();
      setP(json.data ?? json);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed');
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => { if (id) fetchData(); }, [id, fetchData]);

  if (loading) return <div className="max-w-4xl animate-pulse h-96 bg-gray-100 rounded-xl" />;
  if (error || !p) return <div className="text-red-600">{error ?? 'Not found'}</div>;

  return (
    <div className="max-w-5xl">
      <div className="mb-4"><Link href="/projects" className="text-sm text-gray-500 hover:text-primary">← Back to projects</Link></div>

      <div className="flex items-start justify-between mb-6 gap-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">{p.name}</h1>
          <p className="text-sm text-gray-500 mt-1">{p.client?.company ?? p.client?.company_name ?? '—'}</p>
        </div>
        <span className="inline-flex items-center px-2 py-1 rounded-full text-xs font-medium bg-primary/10 text-primary">{p.status}</span>
      </div>

      <div className="border-b border-gray-200 mb-6">
        <nav className="flex gap-6">
          {(['overview', 'tasks', 'members', 'time'] as Tab[]).map((t) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={`py-2 text-sm font-medium border-b-2 transition-colors capitalize ${
                tab === t ? 'border-primary text-primary' : 'border-transparent text-gray-500 hover:text-gray-900'
              }`}
            >
              {t === 'time' ? 'Time Entries' : t}
            </button>
          ))}
        </nav>
      </div>

      {tab === 'overview' && (
        <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-6">
          <dl className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-sm">
            <Detail label="Start Date">{p.startDate ? new Date(p.startDate).toLocaleDateString() : '—'}</Detail>
            <Detail label="Deadline">{p.deadline ? new Date(p.deadline).toLocaleDateString() : '—'}</Detail>
            <Detail label="Billing Type">{p.billingType ?? '—'}</Detail>
            <Detail label="Estimated Hours">{p.estimatedHours ?? '—'}</Detail>
            <Detail label="Description" wide>{p.description ?? '—'}</Detail>
          </dl>
        </div>
      )}

      {tab === 'tasks' && (
        <div className="bg-white rounded-xl border border-gray-100 shadow-sm overflow-hidden">
          {(p.tasks ?? []).length === 0 ? (
            <div className="py-12 text-center text-sm text-gray-400">No tasks yet</div>
          ) : (
            <table className="min-w-full text-sm">
              <thead className="bg-gray-50 text-left text-xs text-gray-500 uppercase">
                <tr>
                  <th className="px-4 py-3">Task</th>
                  <th className="px-4 py-3">Assignee</th>
                  <th className="px-4 py-3">Due</th>
                  <th className="px-4 py-3">Status</th>
                </tr>
              </thead>
              <tbody>
                {(p.tasks ?? []).map((t) => (
                  <tr key={t.id} className="border-t border-gray-100">
                    <td className="px-4 py-3 text-gray-900">{t.name}</td>
                    <td className="px-4 py-3 text-gray-600">{t.assignee?.name ?? '—'}</td>
                    <td className="px-4 py-3 text-gray-600">{t.dueDate ? new Date(t.dueDate).toLocaleDateString() : '—'}</td>
                    <td className="px-4 py-3">
                      <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-gray-100 text-gray-700">{t.status}</span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}

      {tab === 'members' && (
        <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-6">
          {(p.members ?? []).length === 0 ? (
            <div className="text-sm text-gray-400 text-center py-8">No members</div>
          ) : (
            <ul className="divide-y divide-gray-100">
              {(p.members ?? []).map((m) => (
                <li key={m.id} className="py-3 flex items-center justify-between">
                  <div>
                    <p className="text-sm font-medium text-gray-900">{m.name ?? m.email}</p>
                    <p className="text-xs text-gray-500">{m.email}</p>
                  </div>
                  <span className="text-xs text-gray-500">{m.role ?? 'member'}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {tab === 'time' && (
        <div className="bg-white rounded-xl border border-gray-100 shadow-sm overflow-hidden">
          {(p.timeEntries ?? []).length === 0 ? (
            <div className="py-12 text-center text-sm text-gray-400">No time entries yet</div>
          ) : (
            <table className="min-w-full text-sm">
              <thead className="bg-gray-50 text-left text-xs text-gray-500 uppercase">
                <tr>
                  <th className="px-4 py-3">Date</th>
                  <th className="px-4 py-3">User</th>
                  <th className="px-4 py-3">Description</th>
                  <th className="px-4 py-3 text-right">Hours</th>
                </tr>
              </thead>
              <tbody>
                {(p.timeEntries ?? []).map((t) => (
                  <tr key={t.id} className="border-t border-gray-100">
                    <td className="px-4 py-3">{new Date(t.date).toLocaleDateString()}</td>
                    <td className="px-4 py-3">{t.user?.name ?? '—'}</td>
                    <td className="px-4 py-3">{t.description ?? '—'}</td>
                    <td className="px-4 py-3 text-right tabular-nums">{t.hours}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}
    </div>
  );
}

function Detail({ label, children, wide }: { label: string; children: React.ReactNode; wide?: boolean }) {
  return (
    <div className={wide ? 'sm:col-span-2' : ''}>
      <dt className="text-xs text-gray-500 mb-1">{label}</dt>
      <dd className="text-gray-900">{children}</dd>
    </div>
  );
}
