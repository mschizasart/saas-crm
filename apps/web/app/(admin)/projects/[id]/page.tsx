'use client';

import { useState, useEffect, useCallback, useRef, Suspense } from 'react';
import { useParams, useRouter, useSearchParams } from 'next/navigation';
import { FilePreviewModal } from '../../../../components/file-preview-modal';
import { apiFetch } from '../../../../lib/api';
import { DetailPageLayout } from '@/components/layouts/detail-page-layout';

// ────────────────────────────────────────────────────────────────
//  Types
// ────────────────────────────────────────────────────────────────

interface Task {
  id: string;
  name: string;
  status: string;
  priority?: string;
  assignee?: { name?: string } | null;
  startDate?: string;
  dueDate?: string;
  milestoneId?: string | null;
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

interface Milestone {
  id: string;
  name: string;
  description?: string | null;
  dueDate?: string | null;
  completed: boolean;
  status?: 'planned' | 'in_progress' | 'done' | 'cancelled' | null;
  completedAt?: string | null;
  color: string;
  order: number;
  createdAt?: string;
  tasks?: Task[];
}

interface ProjectFile {
  id: string;
  fileName: string;
  fileUrl: string;
  fileSize?: number | null;
  mimeType?: string | null;
  userId?: string | null;
  createdAt: string;
}

interface DiscussionComment {
  id: string;
  content: string;
  userId?: string | null;
  createdAt: string;
}

interface Discussion {
  id: string;
  subject: string;
  description?: string | null;
  userId?: string | null;
  createdAt: string;
  _count?: { comments: number };
  comments?: DiscussionComment[];
}

interface ProjectNote {
  id: string;
  content: string;
  userId?: string | null;
  createdAt: string;
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
  milestones?: Milestone[];
}

type Tab = 'overview' | 'milestones' | 'gantt' | 'discussions' | 'files' | 'notes';

const TABS: { key: Tab; label: string }[] = [
  { key: 'overview', label: 'Overview' },
  { key: 'milestones', label: 'Milestones' },
  { key: 'gantt', label: 'Gantt' },
  { key: 'discussions', label: 'Discussions' },
  { key: 'files', label: 'Files' },
  { key: 'notes', label: 'Notes' },
];

// Kanban columns: planned | in_progress | done. The Milestone model now has
// a persisted `status` column; we still fall back to `completed` + task state
// for older rows that pre-date the migration.
type KanbanStatus = 'planned' | 'in_progress' | 'done';
const KANBAN_COLUMNS: { key: KanbanStatus; label: string; tint: string }[] = [
  { key: 'planned', label: 'Planned', tint: 'bg-gray-50 dark:bg-gray-900 border-gray-200 dark:border-gray-700' },
  { key: 'in_progress', label: 'In Progress', tint: 'bg-blue-50 border-blue-200' },
  { key: 'done', label: 'Done', tint: 'bg-green-50 border-green-200' },
];

function deriveMilestoneStatus(ms: Milestone): KanbanStatus {
  if (ms.status === 'planned' || ms.status === 'in_progress' || ms.status === 'done') {
    return ms.status;
  }
  if (ms.completed) return 'done';
  const hasInProgress = (ms.tasks ?? []).some((t) => t.status === 'in_progress');
  const hasDone = (ms.tasks ?? []).some((t) => t.status === 'complete');
  if (hasInProgress || hasDone) return 'in_progress';
  return 'planned';
}

// ────────────────────────────────────────────────────────────────
//  Helpers
// ────────────────────────────────────────────────────────────────

function formatBytes(bytes: number | null | undefined): string {
  if (!bytes) return '—';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function statusColor(status: string): string {
  switch (status) {
    case 'complete':
    case 'finished':
      return 'bg-green-400';
    case 'in_progress':
      return 'bg-blue-400';
    case 'not_started':
      return 'bg-gray-300';
    case 'testing':
    case 'awaiting_feedback':
      return 'bg-yellow-400';
    default:
      return 'bg-gray-400';
  }
}

// ────────────────────────────────────────────────────────────────
//  Page (Suspense wrapper because we read search params)
// ────────────────────────────────────────────────────────────────

export default function ProjectDetailPageWrapper() {
  return (
    <Suspense fallback={<div className="max-w-5xl animate-pulse h-96 bg-gray-100 dark:bg-gray-800 rounded-xl" />}>
      <ProjectDetailPage />
    </Suspense>
  );
}

function ProjectDetailPage() {
  const { id } = useParams() as { id: string };
  const router = useRouter();
  const searchParams = useSearchParams();

  const initialTab = (() => {
    const q = searchParams.get('tab');
    return TABS.find((t) => t.key === q) ? (q as Tab) : 'overview';
  })();

  const [p, setP] = useState<Project | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTabState] = useState<Tab>(initialTab);

  const setTab = useCallback(
    (next: Tab) => {
      setTabState(next);
      const params = new URLSearchParams(searchParams.toString());
      params.set('tab', next);
      router.replace(`/projects/${id}?${params.toString()}`, { scroll: false });
    },
    [id, router, searchParams],
  );

  const fetchProject = useCallback(async () => {
    setLoading(true);
    try {
      const res = await apiFetch(`/api/v1/projects/${id}`);
      if (!res.ok) throw new Error(`Failed (${res.status})`);
      const json = await res.json();
      setP(json.data ?? json);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed');
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    if (id) fetchProject();
  }, [id, fetchProject]);

  if (loading) return <div className="max-w-5xl animate-pulse h-96 bg-gray-100 dark:bg-gray-800 rounded-xl" />;
  if (error || !p) return <div className="text-red-600">{error ?? 'Not found'}</div>;

  return (
    <DetailPageLayout
      title={p.name}
      subtitle={p.client?.company ?? p.client?.company_name ?? '—'}
      breadcrumbs={[
        { label: 'Projects', href: '/projects' },
        { label: p.name },
      ]}
      badge={
        <span className="inline-flex items-center px-2 py-1 rounded-full text-xs font-medium bg-primary/10 text-primary">
          {p.status}
        </span>
      }
    >
      {/* Tab bar */}
      <div className="border-b border-gray-200 dark:border-gray-700 mb-6">
        <nav className="flex gap-6 overflow-x-auto">
          {TABS.map((t) => (
            <button
              key={t.key}
              onClick={() => setTab(t.key)}
              className={`py-2 text-sm font-medium border-b-2 transition-colors whitespace-nowrap ${
                tab === t.key
                  ? 'border-primary text-primary'
                  : 'border-transparent text-gray-500 dark:text-gray-400 hover:text-gray-900 dark:text-gray-100'
              }`}
            >
              {t.label}
            </button>
          ))}
        </nav>
      </div>

      {tab === 'overview' && <OverviewTab project={p} />}
      {tab === 'milestones' && <MilestonesTab projectId={id} />}
      {tab === 'gantt' && <GanttTab projectId={id} project={p} />}
      {tab === 'discussions' && <DiscussionsTab projectId={id} />}
      {tab === 'files' && <FilesTab projectId={id} />}
      {tab === 'notes' && <NotesTab projectId={id} />}
    </DetailPageLayout>
  );
}

// ────────────────────────────────────────────────────────────────
//  Overview (existing content preserved)
// ────────────────────────────────────────────────────────────────

function OverviewTab({ project: p }: { project: Project }) {
  return (
    <div className="space-y-6">
      <div className="bg-white dark:bg-gray-900 rounded-xl border border-gray-100 dark:border-gray-800 shadow-sm p-6">
        <dl className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-sm">
          <Detail label="Start Date">
            {p.startDate ? new Date(p.startDate).toLocaleDateString() : '—'}
          </Detail>
          <Detail label="Deadline">
            {p.deadline ? new Date(p.deadline).toLocaleDateString() : '—'}
          </Detail>
          <Detail label="Billing Type">{p.billingType ?? '—'}</Detail>
          <Detail label="Estimated Hours">{p.estimatedHours ?? '—'}</Detail>
          <Detail label="Description" wide>
            {p.description ?? '—'}
          </Detail>
        </dl>
      </div>

      {/* Tasks quick list */}
      <div className="bg-white dark:bg-gray-900 rounded-xl border border-gray-100 dark:border-gray-800 shadow-sm overflow-hidden">
        <div className="px-4 py-3 border-b border-gray-100 dark:border-gray-800">
          <h2 className="text-sm font-semibold text-gray-900 dark:text-gray-100">Tasks</h2>
        </div>
        {(p.tasks ?? []).length === 0 ? (
          <div className="py-8 text-center text-sm text-gray-400 dark:text-gray-500">No tasks yet</div>
        ) : (
          <table className="min-w-full text-sm">
            <thead className="bg-gray-50 dark:bg-gray-900 text-left text-xs text-gray-500 dark:text-gray-400 uppercase">
              <tr>
                <th className="px-4 py-3">Task</th>
                <th className="px-4 py-3">Assignee</th>
                <th className="px-4 py-3">Due</th>
                <th className="px-4 py-3">Status</th>
              </tr>
            </thead>
            <tbody>
              {(p.tasks ?? []).map((t) => (
                <tr key={t.id} className="border-t border-gray-100 dark:border-gray-800">
                  <td className="px-4 py-3 text-gray-900 dark:text-gray-100">{t.name}</td>
                  <td className="px-4 py-3 text-gray-600 dark:text-gray-400">{t.assignee?.name ?? '—'}</td>
                  <td className="px-4 py-3 text-gray-600 dark:text-gray-400">
                    {t.dueDate ? new Date(t.dueDate).toLocaleDateString() : '—'}
                  </td>
                  <td className="px-4 py-3">
                    <span className="inline-flex items-center gap-1.5 text-xs text-gray-700 dark:text-gray-300">
                      <span className={`w-1.5 h-1.5 rounded-full ${statusColor(t.status)}`} />
                      {t.status}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* Members */}
      <div className="bg-white dark:bg-gray-900 rounded-xl border border-gray-100 dark:border-gray-800 shadow-sm p-6">
        <h2 className="text-sm font-semibold text-gray-900 dark:text-gray-100 mb-3">Members</h2>
        {(p.members ?? []).length === 0 ? (
          <div className="text-sm text-gray-400 dark:text-gray-500">No members</div>
        ) : (
          <ul className="divide-y divide-gray-100 dark:divide-gray-800">
            {(p.members ?? []).map((m) => (
              <li key={m.id} className="py-3 flex items-center justify-between">
                <div>
                  <p className="text-sm font-medium text-gray-900 dark:text-gray-100">{m.name ?? m.email}</p>
                  <p className="text-xs text-gray-500 dark:text-gray-400">{m.email}</p>
                </div>
                <span className="text-xs text-gray-500 dark:text-gray-400">{m.role ?? 'member'}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

// ────────────────────────────────────────────────────────────────
//  Milestones — Kanban (HTML5 drag & drop)
// ────────────────────────────────────────────────────────────────

function MilestonesTab({ projectId }: { projectId: string }) {
  const [milestones, setMilestones] = useState<Milestone[]>([]);
  const [loading, setLoading] = useState(false);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ name: '', description: '', dueDate: '' });
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [dragOverCol, setDragOverCol] = useState<KanbanStatus | null>(null);

  const fetchMilestones = useCallback(async () => {
    setLoading(true);
    try {
      const res = await apiFetch(`/api/v1/projects/${projectId}/milestones`);
      if (res.ok) {
        const json = await res.json();
        setMilestones(Array.isArray(json) ? json : json.data ?? []);
      }
    } finally {
      setLoading(false);
    }
  }, [projectId]);

  useEffect(() => {
    fetchMilestones();
  }, [fetchMilestones]);

  async function handleCreate() {
    if (!form.name.trim()) return;
    const res = await apiFetch(`/api/v1/projects/${projectId}/milestones`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(form),
    });
    if (res.ok) {
      setShowForm(false);
      setForm({ name: '', description: '', dueDate: '' });
      fetchMilestones();
    }
  }

  async function handleDelete(id: string) {
    if (!confirm('Delete this milestone?')) return;
    await apiFetch(`/api/v1/projects/${projectId}/milestones/${id}`, { method: 'DELETE' });
    fetchMilestones();
  }

  async function moveTo(milestoneId: string, status: KanbanStatus) {
    // Persist both `status` (new canonical column) and `completed` (legacy
    // mirror) so old readers keep working until the migration lands.
    const completed = status === 'done';
    const body: Record<string, unknown> = { status, completed };
    // Optimistic update
    setMilestones((prev) =>
      prev.map((m) =>
        m.id === milestoneId
          ? { ...m, status, completed }
          : m,
      ),
    );
    await apiFetch(`/api/v1/projects/${projectId}/milestones/${milestoneId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    fetchMilestones();
  }

  function onDragStart(e: React.DragEvent, milestoneId: string) {
    setDraggingId(milestoneId);
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', milestoneId);
  }

  function onDragOver(e: React.DragEvent, col: KanbanStatus) {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    if (dragOverCol !== col) setDragOverCol(col);
  }

  function onDrop(e: React.DragEvent, col: KanbanStatus) {
    e.preventDefault();
    const id = e.dataTransfer.getData('text/plain') || draggingId;
    setDraggingId(null);
    setDragOverCol(null);
    if (!id) return;
    const ms = milestones.find((m) => m.id === id);
    if (!ms) return;
    if (deriveMilestoneStatus(ms) === col) return;
    moveTo(id, col);
  }

  const grouped: Record<KanbanStatus, Milestone[]> = {
    planned: [],
    in_progress: [],
    done: [],
  };
  for (const ms of milestones) grouped[deriveMilestoneStatus(ms)].push(ms);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100">Milestones</h2>
        <button
          onClick={() => setShowForm(true)}
          className="inline-flex items-center gap-1 px-3 py-1.5 text-xs font-medium bg-primary text-white rounded-lg hover:bg-primary/90"
        >
          + Add Milestone
        </button>
      </div>

      {showForm && (
        <div className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-700 shadow-sm p-4 space-y-3">
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <input
              placeholder="Milestone name"
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              className="border border-gray-200 dark:border-gray-700 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/30"
            />
            <input
              type="date"
              value={form.dueDate}
              onChange={(e) => setForm({ ...form, dueDate: e.target.value })}
              className="border border-gray-200 dark:border-gray-700 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/30"
            />
            <input
              placeholder="Description (optional)"
              value={form.description}
              onChange={(e) => setForm({ ...form, description: e.target.value })}
              className="border border-gray-200 dark:border-gray-700 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/30"
            />
          </div>
          <div className="flex gap-2">
            <button
              onClick={handleCreate}
              className="px-3 py-1.5 text-xs font-medium bg-primary text-white rounded-lg hover:bg-primary/90"
            >
              Create
            </button>
            <button
              onClick={() => {
                setShowForm(false);
                setForm({ name: '', description: '', dueDate: '' });
              }}
              className="px-3 py-1.5 text-xs font-medium bg-gray-100 dark:bg-gray-800 text-gray-700 dark:text-gray-300 rounded-lg hover:bg-gray-200"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {loading ? (
        <div className="animate-pulse h-64 bg-gray-100 dark:bg-gray-800 rounded-xl" />
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {KANBAN_COLUMNS.map((col) => (
            <div
              key={col.key}
              onDragOver={(e) => onDragOver(e, col.key)}
              onDrop={(e) => onDrop(e, col.key)}
              className={`rounded-xl border ${col.tint} p-3 min-h-[300px] transition-colors ${
                dragOverCol === col.key ? 'ring-2 ring-primary/40' : ''
              }`}
            >
              <div className="flex items-center justify-between mb-3 px-1">
                <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-300">{col.label}</h3>
                <span className="text-xs text-gray-500 dark:text-gray-400">{grouped[col.key].length}</span>
              </div>
              <div className="space-y-2">
                {grouped[col.key].length === 0 && (
                  <div className="text-xs text-gray-400 dark:text-gray-500 italic py-4 text-center">Drop here</div>
                )}
                {grouped[col.key].map((ms) => {
                  const totalTasks = ms.tasks?.length ?? 0;
                  const doneTasks = ms.tasks?.filter((t) => t.status === 'complete').length ?? 0;
                  const pct = totalTasks > 0 ? Math.round((doneTasks / totalTasks) * 100) : 0;
                  return (
                    <div
                      key={ms.id}
                      draggable
                      onDragStart={(e) => onDragStart(e, ms.id)}
                      onDragEnd={() => {
                        setDraggingId(null);
                        setDragOverCol(null);
                      }}
                      className={`bg-white dark:bg-gray-900 rounded-lg border border-gray-200 dark:border-gray-700 shadow-sm p-3 cursor-move ${
                        draggingId === ms.id ? 'opacity-50' : ''
                      }`}
                    >
                      <div className="flex items-start gap-2">
                        <span
                          className="w-2 h-2 rounded-full flex-shrink-0 mt-1.5"
                          style={{ backgroundColor: ms.color }}
                        />
                        <div className="flex-1 min-w-0">
                          <h4 className="text-sm font-medium text-gray-900 dark:text-gray-100 truncate">{ms.name}</h4>
                          {ms.description && (
                            <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5 line-clamp-2">
                              {ms.description}
                            </p>
                          )}
                        </div>
                        <button
                          onClick={() => handleDelete(ms.id)}
                          className="text-gray-300 dark:text-gray-600 hover:text-red-500 flex-shrink-0"
                          title="Delete"
                        >
                          <svg
                            className="w-3.5 h-3.5"
                            fill="none"
                            viewBox="0 0 24 24"
                            stroke="currentColor"
                            strokeWidth={2}
                          >
                            <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                          </svg>
                        </button>
                      </div>
                      <div className="mt-2 flex items-center justify-between text-xs text-gray-500 dark:text-gray-400">
                        <span>
                          {doneTasks}/{totalTasks} tasks
                        </span>
                        {ms.dueDate && <span>{new Date(ms.dueDate).toLocaleDateString()}</span>}
                      </div>
                      {totalTasks > 0 && (
                        <div className="mt-2 w-full h-1 bg-gray-100 dark:bg-gray-800 rounded-full overflow-hidden">
                          <div
                            className="h-full bg-green-500 rounded-full transition-all"
                            style={{ width: `${pct}%` }}
                          />
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ────────────────────────────────────────────────────────────────
//  Gantt — pure CSS grid (months × milestones)
// ────────────────────────────────────────────────────────────────

function GanttTab({ projectId, project }: { projectId: string; project: Project }) {
  const [milestones, setMilestones] = useState<Milestone[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    let cancel = false;
    (async () => {
      setLoading(true);
      try {
        const res = await apiFetch(`/api/v1/projects/${projectId}/milestones`);
        if (res.ok) {
          const json = await res.json();
          const data = Array.isArray(json) ? json : json.data ?? [];
          if (!cancel) setMilestones(data);
        }
      } finally {
        if (!cancel) setLoading(false);
      }
    })();
    return () => {
      cancel = true;
    };
  }, [projectId]);

  if (loading) return <div className="animate-pulse h-64 bg-gray-100 dark:bg-gray-800 rounded-xl" />;

  // Compute span: from earliest start / project.startDate to latest due / project.deadline
  const bars = milestones.map((ms) => {
    const start = ms.createdAt ? new Date(ms.createdAt) : new Date();
    const end = ms.dueDate ? new Date(ms.dueDate) : new Date(start.getTime() + 1000 * 60 * 60 * 24 * 7);
    return { ms, start, end };
  });

  if (bars.length === 0) {
    return (
      <div className="bg-white dark:bg-gray-900 rounded-xl border border-gray-100 dark:border-gray-800 shadow-sm py-12 text-center text-sm text-gray-400 dark:text-gray-500">
        No milestones with dates to display on Gantt chart
      </div>
    );
  }

  const projectStart = project.startDate ? new Date(project.startDate) : bars.reduce((m, b) => (b.start < m ? b.start : m), bars[0].start);
  const projectEnd = project.deadline ? new Date(project.deadline) : bars.reduce((m, b) => (b.end > m ? b.end : m), bars[0].end);

  // Normalize to month grid.
  const gridStart = new Date(projectStart.getFullYear(), projectStart.getMonth(), 1);
  const gridEnd = new Date(projectEnd.getFullYear(), projectEnd.getMonth() + 1, 0);
  const totalDays = Math.max(1, (gridEnd.getTime() - gridStart.getTime()) / (1000 * 60 * 60 * 24));

  // Build month columns
  const months: { label: string; widthPct: number }[] = [];
  const cursor = new Date(gridStart);
  while (cursor <= gridEnd) {
    const monthStart = new Date(cursor.getFullYear(), cursor.getMonth(), 1);
    const monthEnd = new Date(cursor.getFullYear(), cursor.getMonth() + 1, 0);
    const mDays = (monthEnd.getTime() - monthStart.getTime()) / (1000 * 60 * 60 * 24) + 1;
    months.push({
      label: monthStart.toLocaleDateString(undefined, { month: 'short', year: '2-digit' }),
      widthPct: (mDays / totalDays) * 100,
    });
    cursor.setMonth(cursor.getMonth() + 1);
  }

  function pct(d: Date): number {
    const days = (d.getTime() - gridStart.getTime()) / (1000 * 60 * 60 * 24);
    return Math.max(0, Math.min(100, (days / totalDays) * 100));
  }

  const todayPct = pct(new Date());

  return (
    <div className="bg-white dark:bg-gray-900 rounded-xl border border-gray-100 dark:border-gray-800 shadow-sm overflow-hidden">
      <div className="overflow-x-auto">
        <div className="min-w-[800px]">
          {/* Months header */}
          <div className="flex h-9 bg-gray-50 dark:bg-gray-900 border-b border-gray-200 dark:border-gray-700">
            <div className="w-48 flex-shrink-0 px-3 flex items-center text-xs font-semibold text-gray-600 dark:text-gray-400 border-r border-gray-200 dark:border-gray-700">
              Milestone
            </div>
            <div className="flex-1 flex">
              {months.map((m, i) => (
                <div
                  key={i}
                  style={{ width: `${m.widthPct}%` }}
                  className="border-r border-gray-200 dark:border-gray-700 flex items-center px-2 text-[11px] text-gray-500 dark:text-gray-400"
                >
                  {m.label}
                </div>
              ))}
            </div>
          </div>

          {/* Rows */}
          <div className="relative">
            {bars.map(({ ms, start, end }) => {
              const left = pct(start);
              const right = pct(end);
              const width = Math.max(1, right - left);
              const status = deriveMilestoneStatus(ms);
              const bar =
                status === 'done'
                  ? 'bg-green-400'
                  : ms.dueDate && new Date(ms.dueDate) < new Date() && !ms.completed
                    ? 'bg-red-400'
                    : status === 'in_progress'
                      ? 'bg-blue-400'
                      : 'bg-gray-300';

              return (
                <div key={ms.id} className="flex items-center h-10 border-b border-gray-50 relative">
                  <div className="w-48 flex-shrink-0 px-3 text-xs text-gray-700 dark:text-gray-300 truncate border-r border-gray-100 dark:border-gray-800 bg-white dark:bg-gray-900 z-20">
                    {ms.name}
                  </div>
                  <div className="flex-1 relative h-full">
                    {todayPct >= 0 && todayPct <= 100 && (
                      <div
                        className="absolute top-0 bottom-0 w-0.5 bg-red-400/70 z-10"
                        style={{ left: `${todayPct}%` }}
                      />
                    )}
                    <div
                      className={`absolute top-2 h-6 rounded ${bar} opacity-90`}
                      style={{ left: `${left}%`, width: `${width}%`, minWidth: '4px' }}
                      title={`${ms.name} · ${start.toLocaleDateString()} → ${end.toLocaleDateString()}`}
                    />
                  </div>
                </div>
              );
            })}
          </div>

          <div className="flex items-center gap-4 px-4 py-2 border-t border-gray-100 dark:border-gray-800 bg-gray-50 dark:bg-gray-900">
            <span className="flex items-center gap-1 text-[10px] text-gray-500 dark:text-gray-400">
              <span className="w-3 h-2 rounded bg-gray-300" /> Planned
            </span>
            <span className="flex items-center gap-1 text-[10px] text-gray-500 dark:text-gray-400">
              <span className="w-3 h-2 rounded bg-blue-400" /> In progress
            </span>
            <span className="flex items-center gap-1 text-[10px] text-gray-500 dark:text-gray-400">
              <span className="w-3 h-2 rounded bg-green-400" /> Done
            </span>
            <span className="flex items-center gap-1 text-[10px] text-gray-500 dark:text-gray-400">
              <span className="w-3 h-2 rounded bg-red-400" /> Overdue
            </span>
            <span className="flex items-center gap-1 text-[10px] text-gray-500 dark:text-gray-400">
              <span className="w-3 h-0.5 bg-red-400" /> Today
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}

// ────────────────────────────────────────────────────────────────
//  Discussions — threaded-ish list
// ────────────────────────────────────────────────────────────────

function DiscussionsTab({ projectId }: { projectId: string }) {
  const [discussions, setDiscussions] = useState<Discussion[]>([]);
  const [loading, setLoading] = useState(false);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ subject: '', description: '' });
  const [expanded, setExpanded] = useState<string | null>(null);
  const [comments, setComments] = useState<Record<string, DiscussionComment[]>>({});
  const [replyText, setReplyText] = useState<Record<string, string>>({});

  const fetchList = useCallback(async () => {
    setLoading(true);
    try {
      const res = await apiFetch(`/api/v1/projects/${projectId}/discussions`);
      if (res.ok) {
        const json = await res.json();
        setDiscussions(Array.isArray(json) ? json : json.data ?? []);
      }
    } finally {
      setLoading(false);
    }
  }, [projectId]);

  useEffect(() => {
    fetchList();
  }, [fetchList]);

  async function handleCreate() {
    if (!form.subject.trim()) return;
    const res = await apiFetch(`/api/v1/projects/${projectId}/discussions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(form),
    });
    if (res.ok) {
      setShowForm(false);
      setForm({ subject: '', description: '' });
      fetchList();
    }
  }

  async function handleExpand(discussionId: string) {
    if (expanded === discussionId) {
      setExpanded(null);
      return;
    }
    setExpanded(discussionId);
    const res = await apiFetch(`/api/v1/projects/${projectId}/discussions/${discussionId}`);
    if (res.ok) {
      const json = await res.json();
      const d = json.data ?? json;
      setComments((prev) => ({ ...prev, [discussionId]: d.comments ?? [] }));
    }
  }

  async function handleReply(discussionId: string) {
    const text = replyText[discussionId]?.trim();
    if (!text) return;
    const res = await apiFetch(
      `/api/v1/projects/${projectId}/discussions/${discussionId}/comments`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: text }),
      },
    );
    if (res.ok) {
      setReplyText((prev) => ({ ...prev, [discussionId]: '' }));
      handleExpand(discussionId); // refresh
      fetchList();
    }
  }

  return (
    <div className="space-y-4">
      <div className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-700 shadow-sm p-4 space-y-3">
        {!showForm ? (
          <button
            onClick={() => setShowForm(true)}
            className="w-full text-left text-sm text-gray-500 dark:text-gray-400 hover:text-gray-900 dark:hover:text-gray-100 dark:text-gray-100"
          >
            Start a new discussion…
          </button>
        ) : (
          <>
            <input
              placeholder="Subject"
              value={form.subject}
              onChange={(e) => setForm({ ...form, subject: e.target.value })}
              className="w-full border border-gray-200 dark:border-gray-700 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/30"
            />
            <textarea
              placeholder="Body (optional)"
              value={form.description}
              onChange={(e) => setForm({ ...form, description: e.target.value })}
              rows={3}
              className="w-full border border-gray-200 dark:border-gray-700 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/30 resize-none"
            />
            <div className="flex gap-2">
              <button
                onClick={handleCreate}
                className="px-3 py-1.5 text-xs font-medium bg-primary text-white rounded-lg hover:bg-primary/90"
              >
                Create
              </button>
              <button
                onClick={() => {
                  setShowForm(false);
                  setForm({ subject: '', description: '' });
                }}
                className="px-3 py-1.5 text-xs font-medium bg-gray-100 dark:bg-gray-800 text-gray-700 dark:text-gray-300 rounded-lg hover:bg-gray-200"
              >
                Cancel
              </button>
            </div>
          </>
        )}
      </div>

      {loading ? (
        <div className="animate-pulse h-32 bg-gray-100 dark:bg-gray-800 rounded-xl" />
      ) : discussions.length === 0 ? (
        <div className="bg-white dark:bg-gray-900 rounded-xl border border-gray-100 dark:border-gray-800 shadow-sm py-12 text-center text-sm text-gray-400 dark:text-gray-500">
          No discussions yet
        </div>
      ) : (
        <div className="space-y-2">
          {discussions.map((d) => (
            <div key={d.id} className="bg-white dark:bg-gray-900 rounded-xl border border-gray-100 dark:border-gray-800 shadow-sm">
              <button
                onClick={() => handleExpand(d.id)}
                className="w-full px-4 py-3 flex items-center justify-between text-left hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors rounded-xl"
              >
                <div>
                  <h3 className="text-sm font-semibold text-gray-900 dark:text-gray-100">{d.subject}</h3>
                  <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
                    {new Date(d.createdAt).toLocaleDateString()} · {d._count?.comments ?? 0} replies
                  </p>
                </div>
                <svg
                  className={`w-4 h-4 text-gray-400 dark:text-gray-500 transition-transform ${
                    expanded === d.id ? 'rotate-180' : ''
                  }`}
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                  strokeWidth={2}
                >
                  <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 8.25l-7.5 7.5-7.5-7.5" />
                </svg>
              </button>

              {expanded === d.id && (
                <div className="border-t border-gray-100 dark:border-gray-800 px-4 py-3 space-y-3">
                  {d.description && (
                    <p className="text-sm text-gray-700 dark:text-gray-300 bg-gray-50 dark:bg-gray-900 rounded-lg p-3">{d.description}</p>
                  )}
                  <div className="space-y-2">
                    {(comments[d.id] ?? []).map((c) => (
                      <div key={c.id} className="pl-4 border-l-2 border-gray-200 dark:border-gray-700">
                        <p className="text-sm text-gray-700 dark:text-gray-300">{c.content}</p>
                        <p className="text-xs text-gray-400 dark:text-gray-500 mt-0.5">
                          {new Date(c.createdAt).toLocaleDateString()}
                        </p>
                      </div>
                    ))}
                  </div>
                  <div className="flex gap-2">
                    <input
                      placeholder="Write a reply..."
                      value={replyText[d.id] ?? ''}
                      onChange={(e) =>
                        setReplyText((prev) => ({ ...prev, [d.id]: e.target.value }))
                      }
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') handleReply(d.id);
                      }}
                      className="flex-1 border border-gray-200 dark:border-gray-700 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary/30"
                    />
                    <button
                      onClick={() => handleReply(d.id)}
                      className="px-3 py-1.5 text-xs font-medium bg-primary text-white rounded-lg hover:bg-primary/90"
                    >
                      Reply
                    </button>
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ────────────────────────────────────────────────────────────────
//  Files — upload + list
// ────────────────────────────────────────────────────────────────

function FilesTab({ projectId }: { projectId: string }) {
  const [files, setFiles] = useState<ProjectFile[]>([]);
  const [loading, setLoading] = useState(false);
  const [uploading, setUploading] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const [preview, setPreview] = useState<{ url: string; fileName: string; mimeType: string } | null>(
    null,
  );

  const fetchFiles = useCallback(async () => {
    setLoading(true);
    try {
      const res = await apiFetch(`/api/v1/projects/${projectId}/files`);
      if (res.ok) {
        const json = await res.json();
        setFiles(Array.isArray(json) ? json : json.data ?? []);
      }
    } finally {
      setLoading(false);
    }
  }, [projectId]);

  useEffect(() => {
    fetchFiles();
  }, [fetchFiles]);

  async function handleUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    try {
      const form = new FormData();
      form.append('file', file);
      form.append('folder', `projects/${projectId}`);
      const up = await apiFetch(`/api/v1/storage/upload`, { method: 'POST', body: form });
      if (!up.ok) throw new Error('Upload failed');
      const uploaded = await up.json();
      const data = uploaded.data ?? uploaded;
      await apiFetch(`/api/v1/projects/${projectId}/files`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          fileName: file.name,
          fileUrl: data.url ?? data.path ?? '',
          fileSize: file.size,
          mimeType: file.type || null,
        }),
      });
      fetchFiles();
    } catch {
      alert('File upload failed');
    } finally {
      setUploading(false);
      if (inputRef.current) inputRef.current.value = '';
    }
  }

  async function handleDelete(id: string) {
    if (!confirm('Delete this file?')) return;
    await apiFetch(`/api/v1/projects/${projectId}/files/${id}`, { method: 'DELETE' });
    fetchFiles();
  }

  async function handleDownload(f: ProjectFile) {
    try {
      const res = await apiFetch(`/api/v1/storage/url?path=${encodeURIComponent(f.fileUrl)}`);
      if (res.ok) {
        const json = await res.json();
        const url = json.url ?? json.data?.url;
        if (url) return window.open(url, '_blank');
      }
    } catch {
      /* ignore */
    }
    window.open(f.fileUrl, '_blank');
  }

  async function handlePreview(f: ProjectFile) {
    try {
      const res = await apiFetch(`/api/v1/storage/url?path=${encodeURIComponent(f.fileUrl)}`);
      if (res.ok) {
        const json = await res.json();
        const url = json.url ?? json.data?.url ?? f.fileUrl;
        setPreview({ url, fileName: f.fileName, mimeType: f.mimeType ?? 'application/octet-stream' });
        return;
      }
    } catch {
      /* ignore */
    }
    setPreview({ url: f.fileUrl, fileName: f.fileName, mimeType: f.mimeType ?? 'application/octet-stream' });
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100">Files</h2>
        <div>
          <input ref={inputRef} type="file" onChange={handleUpload} className="hidden" />
          <button
            onClick={() => inputRef.current?.click()}
            disabled={uploading}
            className="inline-flex items-center gap-1 px-3 py-1.5 text-xs font-medium bg-primary text-white rounded-lg hover:bg-primary/90 disabled:opacity-50"
          >
            {uploading ? 'Uploading...' : 'Upload File'}
          </button>
        </div>
      </div>

      {loading ? (
        <div className="animate-pulse h-32 bg-gray-100 dark:bg-gray-800 rounded-xl" />
      ) : files.length === 0 ? (
        <div className="bg-white dark:bg-gray-900 rounded-xl border border-gray-100 dark:border-gray-800 shadow-sm py-12 text-center text-sm text-gray-400 dark:text-gray-500">
          No files uploaded yet
        </div>
      ) : (
        <div className="bg-white dark:bg-gray-900 rounded-xl border border-gray-100 dark:border-gray-800 shadow-sm overflow-hidden">
          <table className="min-w-full text-sm">
            <thead className="bg-gray-50 dark:bg-gray-900 text-left text-xs text-gray-500 dark:text-gray-400 uppercase">
              <tr>
                <th className="px-4 py-3">Filename</th>
                <th className="px-4 py-3">Size</th>
                <th className="px-4 py-3">Uploaded By</th>
                <th className="px-4 py-3">Uploaded At</th>
                <th className="px-4 py-3 text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {files.map((f) => (
                <tr key={f.id} className="border-t border-gray-100 dark:border-gray-800">
                  <td className="px-4 py-3 text-gray-900 dark:text-gray-100 font-medium">
                    <button
                      onClick={() => handlePreview(f)}
                      className="text-left hover:text-primary transition-colors"
                    >
                      {f.fileName}
                    </button>
                  </td>
                  <td className="px-4 py-3 text-gray-600 dark:text-gray-400">{formatBytes(f.fileSize)}</td>
                  <td className="px-4 py-3 text-gray-600 dark:text-gray-400">{f.userId ?? '—'}</td>
                  <td className="px-4 py-3 text-gray-600 dark:text-gray-400">
                    {new Date(f.createdAt).toLocaleDateString()}
                  </td>
                  <td className="px-4 py-3 text-right">
                    <div className="flex items-center justify-end gap-2">
                      <button
                        onClick={() => handleDownload(f)}
                        className="text-xs text-primary hover:underline"
                      >
                        Download
                      </button>
                      <button
                        onClick={() => handleDelete(f.id)}
                        className="text-xs text-red-500 hover:underline"
                      >
                        Delete
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {preview && (
        <FilePreviewModal
          url={preview.url}
          fileName={preview.fileName}
          mimeType={preview.mimeType}
          onClose={() => setPreview(null)}
        />
      )}
    </div>
  );
}

// ────────────────────────────────────────────────────────────────
//  Notes
// ────────────────────────────────────────────────────────────────

function NotesTab({ projectId }: { projectId: string }) {
  const [notes, setNotes] = useState<ProjectNote[]>([]);
  const [loading, setLoading] = useState(false);
  const [draft, setDraft] = useState('');
  const [posting, setPosting] = useState(false);
  const [currentUserId, setCurrentUserId] = useState<string | null>(null);

  const fetchNotes = useCallback(async () => {
    setLoading(true);
    try {
      const res = await apiFetch(`/api/v1/projects/${projectId}/notes`);
      if (res.ok) {
        const json = await res.json();
        setNotes(Array.isArray(json) ? json : json.data ?? []);
      }
    } finally {
      setLoading(false);
    }
  }, [projectId]);

  useEffect(() => {
    fetchNotes();
  }, [fetchNotes]);

  useEffect(() => {
    (async () => {
      try {
        const res = await apiFetch('/api/v1/auth/me');
        if (res.ok) {
          const json = await res.json();
          const me = json.data ?? json;
          setCurrentUserId(me?.id ?? null);
        }
      } catch {
        /* ignore */
      }
    })();
  }, []);

  async function handleCreate() {
    const content = draft.trim();
    if (!content) return;
    setPosting(true);
    try {
      const res = await apiFetch(`/api/v1/projects/${projectId}/notes`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content }),
      });
      if (res.ok) {
        setDraft('');
        fetchNotes();
      }
    } finally {
      setPosting(false);
    }
  }

  async function handleDelete(noteId: string) {
    if (!confirm('Delete this note?')) return;
    await apiFetch(`/api/v1/projects/${projectId}/notes/${noteId}`, { method: 'DELETE' });
    fetchNotes();
  }

  return (
    <div className="space-y-4">
      <div className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-700 shadow-sm p-4 space-y-2">
        <textarea
          placeholder="Add a note..."
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          rows={3}
          className="w-full border border-gray-200 dark:border-gray-700 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/30 resize-none"
        />
        <div className="flex justify-end">
          <button
            onClick={handleCreate}
            disabled={posting || !draft.trim()}
            className="px-3 py-1.5 text-xs font-medium bg-primary text-white rounded-lg hover:bg-primary/90 disabled:opacity-50"
          >
            {posting ? 'Saving...' : 'Add Note'}
          </button>
        </div>
      </div>

      {loading ? (
        <div className="animate-pulse h-32 bg-gray-100 dark:bg-gray-800 rounded-xl" />
      ) : notes.length === 0 ? (
        <div className="bg-white dark:bg-gray-900 rounded-xl border border-gray-100 dark:border-gray-800 shadow-sm py-12 text-center text-sm text-gray-400 dark:text-gray-500">
          No notes yet
        </div>
      ) : (
        <div className="space-y-2">
          {notes.map((n) => {
            const canDelete = !n.userId || !currentUserId || n.userId === currentUserId;
            return (
              <div
                key={n.id}
                className="bg-white dark:bg-gray-900 rounded-xl border border-gray-100 dark:border-gray-800 shadow-sm p-4"
              >
                <p className="text-sm text-gray-800 dark:text-gray-200 whitespace-pre-wrap">{n.content}</p>
                <div className="mt-2 flex items-center justify-between text-xs text-gray-400 dark:text-gray-500">
                  <span>
                    {n.userId ? `By ${n.userId}` : 'Anonymous'} ·{' '}
                    {new Date(n.createdAt).toLocaleString()}
                  </span>
                  {canDelete && (
                    <button
                      onClick={() => handleDelete(n.id)}
                      className="text-red-500 hover:underline"
                    >
                      Delete
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ────────────────────────────────────────────────────────────────
//  Detail helper
// ────────────────────────────────────────────────────────────────

function Detail({
  label,
  children,
  wide,
}: {
  label: string;
  children: React.ReactNode;
  wide?: boolean;
}) {
  return (
    <div className={wide ? 'sm:col-span-2' : ''}>
      <dt className="text-xs text-gray-500 dark:text-gray-400 mb-1">{label}</dt>
      <dd className="text-gray-900 dark:text-gray-100">{children}</dd>
    </div>
  );
}
