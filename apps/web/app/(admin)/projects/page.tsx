'use client';

import { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';

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
  client_name: string | null;
  client_id: string | null;
  status: ProjectStatus;
  progress: number;
  deadline: string | null;
  members_count: number;
}

interface ProjectsResponse {
  data: Project[];
  meta: {
    page: number;
    per_page: number;
    total: number;
    total_pages: number;
  };
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

const STATUS_BADGE: Record<ProjectStatus, { bg: string; text: string; label: string }> = {
  not_started: { bg: 'bg-gray-100', text: 'text-gray-600', label: 'Not Started' },
  in_progress:  { bg: 'bg-blue-100', text: 'text-blue-700', label: 'In Progress' },
  on_hold:      { bg: 'bg-yellow-100', text: 'text-yellow-700', label: 'On Hold' },
  finished:     { bg: 'bg-green-100', text: 'text-green-700', label: 'Finished' },
  cancelled:    { bg: 'bg-red-100', text: 'text-red-600', label: 'Cancelled' },
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
  return (
    <span
      className={[
        'inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium',
        s.bg,
        s.text,
      ].join(' ')}
    >
      {s.label}
    </span>
  );
}

function ProgressBar({ value }: { value: number }) {
  const pct = Math.max(0, Math.min(100, value));
  return (
    <div className="flex items-center gap-2 min-w-[100px]">
      <div className="w-full bg-gray-100 rounded-full h-1.5">
        <div
          className="bg-blue-500 h-1.5 rounded-full"
          style={{ width: `${pct}%` }}
        />
      </div>
      <span className="text-xs text-gray-500 w-8 shrink-0">{pct}%</span>
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
    <div className="bg-white rounded-xl border border-gray-100 shadow-sm px-4 py-3 flex flex-col gap-1">
      <span className={['text-2xl font-bold', colorClass].join(' ')}>
        {value ?? '—'}
      </span>
      <span className="text-xs text-gray-500">{label}</span>
    </div>
  );
}

function SkeletonRow() {
  return (
    <tr className="border-b border-gray-100 last:border-0">
      {Array.from({ length: 7 }).map((_, i) => (
        <td key={i} className="px-4 py-3">
          <div
            className="h-4 bg-gray-100 rounded animate-pulse"
            style={{ width: i === 0 ? '55%' : i === 4 ? '70%' : '40%' }}
          />
        </td>
      ))}
    </tr>
  );
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default function ProjectsPage() {
  const [statusFilter, setStatusFilter] = useState<ProjectStatus | 'all'>('all');
  const [page, setPage]                 = useState(1);
  const [projects, setProjects]         = useState<Project[]>([]);
  const [meta, setMeta]                 = useState<ProjectsResponse['meta'] | null>(null);
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
      setMeta(json.meta ?? null);
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

  const totalPages = meta?.total_pages ?? 1;

  return (
    <div>
      {/* ------------------------------------------------------------------ */}
      {/* Header                                                               */}
      {/* ------------------------------------------------------------------ */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mb-6">
        <h1 className="text-2xl font-bold text-gray-900">Projects</h1>
        <Link
          href="/projects/new"
          className="inline-flex items-center gap-1.5 bg-primary text-white text-sm font-medium px-4 py-2 rounded-lg hover:bg-primary/90 transition-colors"
        >
          <span className="text-lg leading-none">+</span>
          New Project
        </Link>
      </div>

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
      {/* Filter pills                                                         */}
      {/* ------------------------------------------------------------------ */}
      <div className="flex flex-wrap gap-2 mb-4">
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

      {/* ------------------------------------------------------------------ */}
      {/* Table card                                                           */}
      {/* ------------------------------------------------------------------ */}
      <div className="bg-white rounded-xl border border-gray-100 shadow-sm overflow-hidden">
        {error && (
          <div className="px-4 py-3 bg-red-50 border-b border-red-100 text-sm text-red-600">
            {error} —{' '}
            <button className="underline" onClick={fetchProjects}>
              retry
            </button>
          </div>
        )}

        <div className="overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead>
              <tr className="bg-gray-50 border-b border-gray-100 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide">
                <th className="px-4 py-3">Name</th>
                <th className="px-4 py-3">Client</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3">Progress</th>
                <th className="px-4 py-3">Deadline</th>
                <th className="px-4 py-3">Members</th>
                <th className="px-4 py-3 text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                Array.from({ length: 8 }).map((_, i) => <SkeletonRow key={i} />)
              ) : projects.length === 0 ? (
                <tr>
                  <td colSpan={7} className="px-4 py-16 text-center">
                    <div className="flex flex-col items-center gap-2 text-gray-400">
                      <svg
                        className="w-10 h-10 opacity-40"
                        xmlns="http://www.w3.org/2000/svg"
                        fill="none"
                        viewBox="0 0 24 24"
                        stroke="currentColor"
                      >
                        <path
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          strokeWidth={1.5}
                          d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2"
                        />
                      </svg>
                      <p className="text-sm font-medium">
                        {statusFilter !== 'all'
                          ? `No projects with status "${STATUS_BADGE[statusFilter as ProjectStatus]?.label ?? statusFilter}"`
                          : 'No projects found'}
                      </p>
                      {statusFilter === 'all' && (
                        <Link
                          href="/projects/new"
                          className="text-sm text-primary hover:underline"
                        >
                          Create your first project
                        </Link>
                      )}
                    </div>
                  </td>
                </tr>
              ) : (
                projects.map((project) => (
                  <tr
                    key={project.id}
                    className="border-b border-gray-100 last:border-0 hover:bg-gray-50/60 transition-colors"
                  >
                    <td className="px-4 py-3 font-medium text-gray-900">
                      <Link
                        href={`/projects/${project.id}`}
                        className="hover:text-primary transition-colors"
                      >
                        {project.name}
                      </Link>
                    </td>
                    <td className="px-4 py-3 text-gray-500">
                      {project.client_id ? (
                        <Link
                          href={`/clients/${project.client_id}`}
                          className="hover:text-primary transition-colors"
                        >
                          {project.client_name ?? project.client_id}
                        </Link>
                      ) : (
                        <span className="text-gray-300">—</span>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <StatusBadge status={project.status} />
                    </td>
                    <td className="px-4 py-3">
                      <ProgressBar value={project.progress} />
                    </td>
                    <td className="px-4 py-3 text-gray-500 whitespace-nowrap">
                      {formatDate(project.deadline)}
                    </td>
                    <td className="px-4 py-3 text-gray-500">
                      {project.members_count}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center justify-end gap-3">
                        <Link
                          href={`/projects/${project.id}`}
                          className="text-xs text-gray-500 hover:text-primary font-medium transition-colors"
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

        {/* ---------------------------------------------------------------- */}
        {/* Pagination                                                         */}
        {/* ---------------------------------------------------------------- */}
        {!loading && meta && meta.total > 0 && (
          <div className="flex items-center justify-between px-4 py-3 border-t border-gray-100 bg-gray-50/50">
            <p className="text-xs text-gray-500">
              {meta.total} project{meta.total !== 1 ? 's' : ''} total
            </p>
            <div className="flex items-center gap-2">
              <button
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                disabled={page <= 1}
                className="px-3 py-1.5 text-xs font-medium rounded-md border border-gray-200 bg-white hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
              >
                Previous
              </button>
              <span className="text-xs text-gray-600 min-w-[80px] text-center">
                Page {page} of {totalPages}
              </span>
              <button
                onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                disabled={page >= totalPages}
                className="px-3 py-1.5 text-xs font-medium rounded-md border border-gray-200 bg-white hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
              >
                Next
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
