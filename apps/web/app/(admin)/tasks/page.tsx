'use client';

import { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import { CheckSquare } from 'lucide-react';
import { ListPageLayout } from '@/components/layouts/list-page-layout';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { TableSkeleton } from '@/components/ui/table-skeleton';
import { EmptyState } from '@/components/ui/empty-state';
import { inputClass } from '@/components/ui/form-field';
import { exportCsv } from '@/lib/export-csv';

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

type BadgeVariant = 'default' | 'success' | 'warning' | 'error' | 'info' | 'muted';

const STATUS_VARIANTS: Record<string, BadgeVariant> = {
  not_started: 'default',
  in_progress: 'info',
  testing: 'warning',
  awaiting_feedback: 'info',
  complete: 'success',
};

function StatusBadge({ status }: { status: string }) {
  return (
    <Badge variant={STATUS_VARIANTS[status] ?? 'muted'}>
      {status.replace(/_/g, ' ')}
    </Badge>
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

  const filtersNode = (
    <>
      <div className="flex gap-2 mb-4 border-b border-gray-200 dark:border-gray-700" role="tablist" aria-label="Tasks view">
        {(['all', 'my'] as const).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            role="tab"
            aria-selected={tab === t}
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
        <div className="flex flex-wrap gap-2">
          <input
            type="text"
            placeholder="Search..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            aria-label="Search tasks"
            className={`${inputClass} max-w-xs`}
          />
          <select
            value={status}
            onChange={(e) => setStatus(e.target.value)}
            aria-label="Filter by status"
            className={`${inputClass} max-w-xs`}
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
            aria-label="Due before"
            className={`${inputClass} max-w-xs`}
          />
        </div>
      )}
    </>
  );

  return (
    <ListPageLayout
      title="Tasks"
      secondaryActions={[
        {
          label: 'Export CSV',
          onClick: () => {
            const params = new URLSearchParams();
            if (status) params.set('status', status);
            if (search) params.set('search', search);
            if (dueBefore) params.set('dueBefore', dueBefore);
            const qs = params.toString();
            void exportCsv(
              `/api/v1/tasks/export${qs ? `?${qs}` : ''}`,
              `tasks-${new Date().toISOString().slice(0, 10)}.csv`,
              { entityLabel: 'tasks' },
            );
          },
        },
        { label: 'Kanban', href: '/tasks/kanban' },
      ]}
      primaryAction={{ label: 'New Task', href: '/tasks/new', icon: <span className="text-lg leading-none">+</span> }}
      filters={filtersNode}
    >
      <Card>
        <table className="min-w-full text-sm">
          <thead>
            <tr className="bg-gray-50 dark:bg-gray-900 border-b border-gray-100 dark:border-gray-800 text-left text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase">
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
              <TableSkeleton rows={6} columns={6} columnWidths={['50%', '40%', '25%', '20%', '25%', '40%']} />
            ) : tasks.length === 0 ? (
              <tr>
                <td colSpan={6} className="px-4 py-8">
                  <EmptyState
                    icon={<CheckSquare className="w-10 h-10" />}
                    title="No tasks found"
                    action={{ label: 'Create your first task', href: '/tasks/new' }}
                  />
                </td>
              </tr>
            ) : (
              tasks.map((t) => (
                <tr
                  key={t.id}
                  className="border-b border-gray-100 dark:border-gray-800 last:border-0 hover:bg-gray-50/60"
                >
                  <td className="px-4 py-3 font-medium">
                    <Link href={`/tasks/${t.id}`} className="hover:text-primary">
                      {t.name}
                    </Link>
                  </td>
                  <td className="px-4 py-3 text-gray-500 dark:text-gray-400">
                    {t.project?.name ?? '—'}
                  </td>
                  <td className="px-4 py-3">
                    <StatusBadge status={t.status} />
                  </td>
                  <td className="px-4 py-3 text-gray-500 dark:text-gray-400 capitalize">
                    {t.priority}
                  </td>
                  <td className="px-4 py-3 text-gray-500 dark:text-gray-400">
                    {t.dueDate ? new Date(t.dueDate).toLocaleDateString() : '—'}
                  </td>
                  <td className="px-4 py-3 text-gray-500 dark:text-gray-400 text-xs">
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
      </Card>
    </ListPageLayout>
  );
}
