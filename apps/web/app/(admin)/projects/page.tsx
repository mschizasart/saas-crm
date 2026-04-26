'use client';

import { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import { Briefcase } from 'lucide-react';
import { ListPageLayout } from '@/components/layouts/list-page-layout';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { TableSkeleton } from '@/components/ui/table-skeleton';
import { EmptyState } from '@/components/ui/empty-state';
import { ErrorBanner } from '@/components/ui/error-banner';
import { exportCsv } from '@/lib/export-csv';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type ProjectStatus =
  | 'not_started'
  | 'in_progress'
  | 'on_hold'
  | 'finished'
  | 'cancelled';

interface Project {
  id: string;
  name: string;
  client?: { id: string; company: string } | null;
  clientId: string | null;
  status: ProjectStatus;
  progress: number;
  deadline: string | null;
  _count?: { tasks: number; members: number; timeEntries: number };
}

interface ProjectsResponse {
  data: Project[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

interface ProjectStats {
  total: number;
  not_started: number;
  in_progress: number;
  on_hold: number;
  finished: number;
  cancelled: number;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001';

const STATUS_FILTERS: { label: string; value: ProjectStatus | 'all' }[] = [
  { label: 'All', value: 'all' },
  { label: 'Not Started', value: 'not_started' },
  { label: 'In Progress', value: 'in_progress' },
  { label: 'On Hold', value: 'on_hold' },
  { label: 'Finished', value: 'finished' },
  { label: 'Cancelled', value: 'cancelled' },
];

type BadgeVariant = 'default' | 'success' | 'warning' | 'error' | 'info' | 'muted';

const STATUS_BADGE: Record<ProjectStatus, { variant: BadgeVariant; label: string }> = {
  not_started: { variant: 'default', label: 'Not Started' },
  in_progress:  { variant: 'info', label: 'In Progress' },
  on_hold:      { variant: 'warning', label: 'On Hold' },
  finished:     { variant: 'success', label: 'Finished' },
  cancelled:    { variant: 'error', label: 'Cancelled' },
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function getToken(): string | null {
  if (typeof window === 'undefined') return null;
  return localStorage.getItem('access_token');
}

function formatDate(iso: string | null): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString('en-GB', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  });
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function StatusBadge({ status }: { status: ProjectStatus }) {
  const s = STATUS_BADGE[status] ?? STATUS_BADGE.not_started;
  return <Badge variant={s.variant}>{s.label}</Badge>;
}

function ProgressBar({ value }: { value: number }) {
  const pct = Math.max(0, Math.min(100, value));
  return (
    <div className="flex items-center gap-2 min-w-[100px]">
      <div className="w-full bg-gray-100 dark:bg-gray-800 rounded-full h-1.5">
        <div
          className="bg-blue-500 h-1.5 rounded-full"
          style={{ width: `${pct}%` }}
        />
      </div>
      <span className="text-xs text-gray-500 dark:text-gray-400 w-8 shrink-0">{pct}%</span>
    </div>
  );
}

function StatCard({
  label,
  value,
  colorClass,
}: {
  label: string;
  value: number | undefined;
  colorClass: string;
}) {
  return (
    <Card padding="md" className="flex flex-col gap-1">
      <span className={['text-2xl font-bold', colorClass].join(' ')}>
        {value ?? '—'}
      </span>
      <span className="text-xs text-gray-500 dark:text-gray-400">{label}</span>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default function ProjectsPage() {
  const [statusFilter, setStatusFilter] = useState<ProjectStatus | 'all'>('all');
  const [page, setPage]                 = useState(1);
  const [projects, setProjects]         = useState<Project[]>([]);
  const [meta, setMeta]                 = useState<{ total: number; totalPages: number } | null>(null);
  const [stats, setStats]               = useState<ProjectStats | null>(null);
  const [loading, setLoading]           = useState(true);
  const [error, setError]               = useState<string | null>(null);

  // Reset page when filter changes
  useEffect(() => {
    setPage(1);
  }, [statusFilter]);

  // Fetch stats once on mount
  useEffect(() => {
    const token = getToken();
    fetch(`${API_BASE}/api/v1/projects/stats`, {
      headers: { Authorization: `Bearer ${token}` },
    })
      .then((r) => (r.ok ? r.json() : Promise.reject(r.status)))
      .then((json: ProjectStats) => setStats(json))
      .catch(() => {/* non-critical, ignore */});
  }, []);

  const fetchProjects = useCallback(async () => {
    setLoading(true);
    setError(null);

    try {
      const token  = getToken();
      const params = new URLSearchParams({ page: String(page), limit: '20' });
      if (statusFilter !== 'all') params.set('status', statusFilter);

      const res = await fetch(`${API_BASE}/api/v1/projects?${params.toString()}`, {
        headers: { Authorization: `Bearer ${token}` },
      });

      if (!res.ok) throw new Error(`Server responded with ${res.status}`);

      const json: ProjectsResponse = await res.json();
      setProjects(json.data ?? []);
      setMeta({ total: json.total ?? 0, totalPages: json.totalPages ?? 1 });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load projects');
      setProjects([]);
    } finally {
      setLoading(false);
    }
  }, [statusFilter, page]);

  useEffect(() => {
    fetchProjects();
  }, [fetchProjects]);

  const totalPages = meta?.totalPages ?? 1;

  const filtersNode = (
    <div className="flex flex-wrap gap-2">
      {STATUS_FILTERS.map((f) => (
        <button
          key={f.value}
          onClick={() => setStatusFilter(f.value)}
          className={[
            'px-3 py-1.5 rounded-full text-xs font-medium border transition-colors',
            statusFilter === f.value
              ? 'bg-primary text-white border-primary'
              : 'bg-white text-gray-600 border-gray-200 hover:bg-gray-50',
          ].join(' ')}
        >
          {f.label}
        </button>
      ))}
    </div>
  );

  const paginationNode =
    !loading && meta && meta.total > 0 ? (
      <div className="flex items-center justify-between px-4 py-3 border border-gray-100 dark:border-gray-800 rounded-xl bg-gray-50/50 dark:bg-gray-800/50">
        <p className="text-xs text-gray-500 dark:text-gray-400">
          {meta.total} project{meta.total !== 1 ? 's' : ''} total
        </p>
        <div className="flex items-center gap-2">
          <Button variant="secondary" size="sm" onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={page <= 1}>Previous</Button>
          <span className="text-xs text-gray-600 dark:text-gray-400 min-w-[80px] text-center">
            Page {page} of {totalPages}
          </span>
          <Button variant="secondary" size="sm" onClick={() => setPage((p) => Math.min(totalPages, p + 1))} disabled={page >= totalPages}>Next</Button>
        </div>
      </div>
    ) : null;

  return (
    <ListPageLayout
      title="Projects"
      secondaryActions={[
        {
          label: 'Export CSV',
          onClick: () => {
            const params = new URLSearchParams();
            if (statusFilter !== 'all') params.set('status', statusFilter);
            const qs = params.toString();
            void exportCsv(
              `/api/v1/projects/export${qs ? `?${qs}` : ''}`,
              `projects-${new Date().toISOString().slice(0, 10)}.csv`,
              { entityLabel: 'projects' },
            );
          },
        },
      ]}
      primaryAction={{ label: 'New Project', href: '/projects/new', icon: <span className="text-lg leading-none">+</span> }}
      filters={filtersNode}
      pagination={paginationNode}
    >
      {/* ------------------------------------------------------------------ */}
      {/* Stats bar                                                            */}
      {/* ------------------------------------------------------------------ */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3 mb-6">
        <StatCard label="Total"       value={stats?.total}       colorClass="text-gray-900" />
        <StatCard label="Not Started" value={stats?.not_started} colorClass="text-gray-600" />
        <StatCard label="In Progress" value={stats?.in_progress} colorClass="text-blue-600" />
        <StatCard label="On Hold"     value={stats?.on_hold}     colorClass="text-yellow-600" />
        <StatCard label="Finished"    value={stats?.finished}    colorClass="text-green-600" />
        <StatCard label="Cancelled"   value={stats?.cancelled}   colorClass="text-red-500" />
      </div>

      {/* ------------------------------------------------------------------ */}
      {/* Mobile card view                                                     */}
      {/* ------------------------------------------------------------------ */}
      <div className="md:hidden space-y-3">
        {error && <ErrorBanner message={error} onRetry={fetchProjects} />}
        {loading ? (
          Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="bg-white dark:bg-gray-900 rounded-xl border border-gray-100 dark:border-gray-800 shadow-sm p-4 animate-pulse">
              <div className="h-4 bg-gray-100 dark:bg-gray-800 rounded w-3/4 mb-2" />
              <div className="h-3 bg-gray-100 dark:bg-gray-800 rounded w-1/2" />
            </div>
          ))
        ) : projects.length === 0 ? (
          <EmptyState
            icon={<Briefcase className="w-10 h-10" />}
            title={statusFilter !== 'all'
              ? `No projects with status "${STATUS_BADGE[statusFilter as ProjectStatus]?.label ?? statusFilter}"`
              : 'No projects found'}
            action={statusFilter === 'all' ? { label: 'Create your first project', href: '/projects/new' } : undefined}
          />
        ) : (
          projects.map((project) => (
            <Link
              key={project.id}
              href={`/projects/${project.id}`}
              className="block bg-white dark:bg-gray-900 rounded-xl border border-gray-100 dark:border-gray-800 shadow-sm p-4 hover:border-gray-200 transition-colors"
            >
              <div className="flex items-start justify-between gap-2 mb-2">
                <p className="font-medium text-gray-900 dark:text-gray-100 truncate flex-1">{project.name}</p>
                <StatusBadge status={project.status} />
              </div>
              <p className="text-xs text-gray-500 dark:text-gray-400 mb-2 truncate">
                {project.client?.company ?? 'No client'}
              </p>
              <ProgressBar value={project.progress} />
            </Link>
          ))
        )}
      </div>

      {/* ------------------------------------------------------------------ */}
      {/* Table card                                                           */}
      {/* ------------------------------------------------------------------ */}
      <Card className="hidden md:block">
        {error && (
          <ErrorBanner message={error} onRetry={fetchProjects} className="rounded-none border-0 border-b border-red-100" />
        )}

        <div className="overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead>
              <tr className="bg-gray-50 dark:bg-gray-900 border-b border-gray-100 dark:border-gray-800 text-left text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide">
                <th className="px-4 py-3">Name</th>
                <th className="px-4 py-3">Client</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3">Progress</th>
                <th className="px-4 py-3 hidden lg:table-cell">Deadline</th>
                <th className="px-4 py-3 hidden lg:table-cell">Members</th>
                <th className="px-4 py-3 text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <TableSkeleton rows={8} columns={7} columnWidths={['55%', '40%', '25%', '30%', '30%', '20%', '20%']} />
              ) : projects.length === 0 ? (
                <tr>
                  <td colSpan={7} className="px-4 py-8">
                    <EmptyState
                      icon={<Briefcase className="w-10 h-10" />}
                      title={statusFilter !== 'all'
                        ? `No projects with status "${STATUS_BADGE[statusFilter as ProjectStatus]?.label ?? statusFilter}"`
                        : 'No projects found'}
                      action={statusFilter === 'all' ? { label: 'Create your first project', href: '/projects/new' } : undefined}
                    />
                  </td>
                </tr>
              ) : (
                projects.map((project) => (
                  <tr
                    key={project.id}
                    className="border-b border-gray-100 dark:border-gray-800 last:border-0 hover:bg-gray-50/60 transition-colors"
                  >
                    <td className="px-4 py-3 font-medium text-gray-900 dark:text-gray-100">
                      <Link
                        href={`/projects/${project.id}`}
                        className="hover:text-primary transition-colors"
                      >
                        {project.name}
                      </Link>
                    </td>
                    <td className="px-4 py-3 text-gray-500 dark:text-gray-400">
                      {project.clientId ? (
                        <Link
                          href={`/clients/${project.clientId}`}
                          className="hover:text-primary transition-colors"
                        >
                          {project.client?.company ?? '—'}
                        </Link>
                      ) : (
                        <span className="text-gray-300 dark:text-gray-600">—</span>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <StatusBadge status={project.status} />
                    </td>
                    <td className="px-4 py-3">
                      <ProgressBar value={project.progress} />
                    </td>
                    <td className="px-4 py-3 text-gray-500 dark:text-gray-400 whitespace-nowrap hidden lg:table-cell">
                      {formatDate(project.deadline)}
                    </td>
                    <td className="px-4 py-3 text-gray-500 dark:text-gray-400 hidden lg:table-cell">
                      {project._count?.members ?? 0}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center justify-end gap-3">
                        <Link
                          href={`/projects/${project.id}`}
                          className="text-xs text-gray-500 dark:text-gray-400 hover:text-primary font-medium transition-colors"
                        >
                          View
                        </Link>
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

      </Card>
    </ListPageLayout>
  );
}
