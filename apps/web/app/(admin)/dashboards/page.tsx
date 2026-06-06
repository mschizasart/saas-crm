'use client';

/**
 * Dashboards list (Wave D2).
 *
 * Each row links to /dashboards/:id which fetches the dashboard + all
 * widget data in a single round-trip.
 */
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { Plus, LayoutDashboard, Trash2 } from 'lucide-react';
import { apiFetch } from '@/lib/api';

interface DashboardRow {
  id: string;
  name: string;
  description: string | null;
  updatedAt: string;
  _count?: { widgets: number };
}

interface ListResponse {
  data: DashboardRow[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

export default function DashboardsListPage() {
  const [rows, setRows] = useState<DashboardRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Inline create form
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState('');
  const [savingNew, setSavingNew] = useState(false);

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await apiFetch('/api/v1/dashboards?limit=100');
      if (!res.ok) {
        throw new Error(`Failed to load (${res.status})`);
      }
      const body = (await res.json()) as ListResponse;
      setRows(body.data ?? []);
    } catch (err: any) {
      setError(err?.message ?? 'Failed to load');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, []);

  const create = async () => {
    if (!newName.trim()) return;
    setSavingNew(true);
    try {
      const res = await apiFetch('/api/v1/dashboards', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: newName.trim() }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.message ?? 'Failed');
      }
      const created = (await res.json()) as DashboardRow;
      setRows((r) => [created, ...r]);
      setNewName('');
      setCreating(false);
    } catch (err: any) {
      alert(err?.message ?? 'Failed to create');
    } finally {
      setSavingNew(false);
    }
  };

  const remove = async (id: string) => {
    if (!confirm('Delete this dashboard?')) return;
    const res = await apiFetch(`/api/v1/dashboards/${id}`, { method: 'DELETE' });
    if (res.ok || res.status === 204) {
      setRows((r) => r.filter((x) => x.id !== id));
    } else {
      alert('Failed to delete');
    }
  };

  return (
    <div>
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">
            Dashboards
          </h1>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
            Compose grid layouts of saved reports.
          </p>
        </div>
        <button
          onClick={() => setCreating((v) => !v)}
          className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-blue-600 text-white text-sm font-medium hover:bg-blue-700"
        >
          <Plus className="w-4 h-4" />
          New Dashboard
        </button>
      </div>

      {creating && (
        <div className="mb-4 bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-xl p-4 flex items-center gap-2">
          <input
            type="text"
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') create();
              if (e.key === 'Escape') setCreating(false);
            }}
            autoFocus
            placeholder="Dashboard name"
            className="flex-1 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 px-3 py-2 text-sm"
          />
          <button
            onClick={create}
            disabled={savingNew || !newName.trim()}
            className="px-4 py-2 rounded-lg bg-blue-600 text-white text-sm disabled:opacity-50"
          >
            {savingNew ? 'Creating…' : 'Create'}
          </button>
          <button
            onClick={() => setCreating(false)}
            className="px-4 py-2 rounded-lg border border-gray-200 dark:border-gray-700 text-sm"
          >
            Cancel
          </button>
        </div>
      )}

      {error && (
        <div className="mb-4 px-4 py-3 rounded-lg bg-red-50 border border-red-200 text-sm text-red-800">
          {error}
        </div>
      )}

      {loading ? (
        <div className="text-sm text-gray-500 py-12 text-center">Loading…</div>
      ) : rows.length === 0 ? (
        <div className="bg-white dark:bg-gray-900 border border-dashed border-gray-200 dark:border-gray-700 rounded-xl p-12 text-center">
          <LayoutDashboard className="w-10 h-10 mx-auto text-gray-300 dark:text-gray-600 mb-3" />
          <h3 className="text-base font-semibold text-gray-900 dark:text-gray-100 mb-1">
            No dashboards yet
          </h3>
          <p className="text-sm text-gray-500 dark:text-gray-400">
            Create one and drop your saved reports into it.
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {rows.map((d) => (
            <div
              key={d.id}
              className="group bg-white dark:bg-gray-900 rounded-xl border border-gray-100 dark:border-gray-800 shadow-sm p-5 hover:shadow-md transition-all relative"
            >
              <Link href={`/dashboards/${d.id}`} className="block">
                <div className="w-10 h-10 rounded-lg flex items-center justify-center mb-4 bg-blue-50 text-blue-600">
                  <LayoutDashboard className="w-5 h-5" />
                </div>
                <h2 className="font-semibold text-gray-900 dark:text-gray-100 mb-1 group-hover:text-primary">
                  {d.name}
                </h2>
                <p className="text-xs text-gray-500 dark:text-gray-400">
                  {d._count?.widgets ?? 0} widget
                  {(d._count?.widgets ?? 0) === 1 ? '' : 's'}
                </p>
              </Link>
              <button
                onClick={() => remove(d.id)}
                className="absolute top-3 right-3 p-1.5 text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20 rounded opacity-0 group-hover:opacity-100 transition-opacity"
                title="Delete dashboard"
              >
                <Trash2 className="w-4 h-4" />
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
