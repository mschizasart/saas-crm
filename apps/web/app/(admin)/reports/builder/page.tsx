'use client';

/**
 * Saved report definitions (Wave D2 builder).
 *
 * Lists every report row created by the org and links to /new (the
 * builder) and /:id (the runner). The legacy canned reports hub at
 * /reports is unchanged — this surface lives one level deeper to keep
 * the two concepts visually separate.
 */
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { Plus, FileBarChart, Trash2 } from 'lucide-react';
import { apiFetch } from '@/lib/api';

interface ReportRow {
  id: string;
  name: string;
  description: string | null;
  entityType: string;
  chartType: string;
  updatedAt: string;
}

interface ListResponse {
  data: ReportRow[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

export default function ReportBuilderListPage() {
  const [rows, setRows] = useState<ReportRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await apiFetch('/api/v1/report-defs?limit=100');
      if (!res.ok) {
        throw new Error(`Failed to load reports (${res.status})`);
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

  const remove = async (id: string) => {
    if (!confirm('Delete this report?')) return;
    const res = await apiFetch(`/api/v1/report-defs/${id}`, {
      method: 'DELETE',
    });
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
            Report Builder
          </h1>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
            Build your own reports against any entity in the CRM.
          </p>
        </div>
        <Link
          href="/reports/builder/new"
          className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-blue-600 text-white text-sm font-medium hover:bg-blue-700 transition-colors"
        >
          <Plus className="w-4 h-4" />
          New Report
        </Link>
      </div>

      {error && (
        <div className="mb-4 px-4 py-3 rounded-lg bg-red-50 border border-red-200 text-sm text-red-800">
          {error}
        </div>
      )}

      {loading ? (
        <div className="text-sm text-gray-500 py-12 text-center">Loading…</div>
      ) : rows.length === 0 ? (
        <div className="bg-white dark:bg-gray-900 border border-dashed border-gray-200 dark:border-gray-700 rounded-xl p-12 text-center">
          <FileBarChart className="w-10 h-10 mx-auto text-gray-300 dark:text-gray-600 mb-3" />
          <h3 className="text-base font-semibold text-gray-900 dark:text-gray-100 mb-1">
            No saved reports yet
          </h3>
          <p className="text-sm text-gray-500 dark:text-gray-400 mb-4">
            Build your first report to slice CRM data the way you want.
          </p>
          <Link
            href="/reports/builder/new"
            className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-blue-600 text-white text-sm font-medium hover:bg-blue-700"
          >
            <Plus className="w-4 h-4" />
            Create a report
          </Link>
        </div>
      ) : (
        <div className="bg-white dark:bg-gray-900 rounded-xl border border-gray-100 dark:border-gray-800 shadow-sm overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 dark:bg-gray-800/40 text-xs uppercase text-gray-500 dark:text-gray-400">
              <tr>
                <th className="px-4 py-3 text-left font-medium">Name</th>
                <th className="px-4 py-3 text-left font-medium">Entity</th>
                <th className="px-4 py-3 text-left font-medium">Chart</th>
                <th className="px-4 py-3 text-left font-medium">Updated</th>
                <th className="px-4 py-3 text-right font-medium">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
              {rows.map((r) => (
                <tr key={r.id} className="hover:bg-gray-50 dark:hover:bg-gray-800/40">
                  <td className="px-4 py-3">
                    <Link
                      href={`/reports/builder/${r.id}`}
                      className="font-medium text-gray-900 dark:text-gray-100 hover:text-blue-600"
                    >
                      {r.name}
                    </Link>
                    {r.description && (
                      <div className="text-xs text-gray-500 dark:text-gray-400 mt-0.5 line-clamp-1">
                        {r.description}
                      </div>
                    )}
                  </td>
                  <td className="px-4 py-3 text-gray-600 dark:text-gray-300 capitalize">
                    {r.entityType}
                  </td>
                  <td className="px-4 py-3 text-gray-600 dark:text-gray-300 capitalize">
                    {r.chartType}
                  </td>
                  <td className="px-4 py-3 text-gray-500 dark:text-gray-400 whitespace-nowrap">
                    {new Date(r.updatedAt).toLocaleDateString()}
                  </td>
                  <td className="px-4 py-3 text-right">
                    <button
                      onClick={() => remove(r.id)}
                      className="inline-flex items-center gap-1 px-2 py-1 text-xs text-red-600 hover:bg-red-50 dark:hover:bg-red-900/20 rounded"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                      Delete
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
