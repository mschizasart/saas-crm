'use client';

/**
 * Saved report viewer (Wave D2).
 *
 * Executes POST /report-defs/:id/run on mount, then renders the result
 * according to the report's chartType. recharts ships with the web app
 * (^2.15.3 in apps/web/package.json) so we use it directly.
 *
 * Pie charts only render when the report's aggregations include `count`
 * (or another single numeric aggregation) on a groupBy field; otherwise
 * we fall back to a table.
 */
import { useEffect, useMemo, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import { ArrowLeft, RefreshCw, Trash2 } from 'lucide-react';
import {
  BarChart,
  Bar,
  LineChart,
  Line,
  PieChart,
  Pie,
  Cell,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  CartesianGrid,
} from 'recharts';
import { apiFetch } from '@/lib/api';

interface ReportMeta {
  entity: string;
  groupBy: string | null;
  aggregations: Array<{ fn: string; field?: string }>;
  count: number;
  capped: boolean;
  reportId: string;
  chartType: 'table' | 'bar' | 'line' | 'pie';
  name: string;
}

interface RunResponse {
  data: any[];
  meta: ReportMeta;
}

const CHART_COLORS = [
  '#3b82f6',
  '#10b981',
  '#f59e0b',
  '#ef4444',
  '#8b5cf6',
  '#06b6d4',
  '#ec4899',
  '#84cc16',
];

export default function ReportViewerPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const reportId = params?.id;

  const [result, setResult] = useState<RunResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const run = async () => {
    if (!reportId) return;
    setLoading(true);
    setError(null);
    try {
      const res = await apiFetch(`/api/v1/report-defs/${reportId}/run`, {
        method: 'POST',
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.message ?? `Run failed (${res.status})`);
      }
      setResult((await res.json()) as RunResponse);
    } catch (err: any) {
      setError(err?.message ?? 'Failed to run');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    run();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reportId]);

  const remove = async () => {
    if (!confirm('Delete this report?')) return;
    const res = await apiFetch(`/api/v1/report-defs/${reportId}`, {
      method: 'DELETE',
    });
    if (res.ok || res.status === 204) {
      router.push('/reports/builder');
    } else {
      alert('Delete failed');
    }
  };

  return (
    <div>
      <div className="mb-6 flex items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <Link
            href="/reports/builder"
            className="inline-flex items-center gap-1 text-sm text-gray-500 hover:text-gray-700"
          >
            <ArrowLeft className="w-4 h-4" />
            Back
          </Link>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">
            {result?.meta?.name ?? 'Report'}
          </h1>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={run}
            disabled={loading}
            className="inline-flex items-center gap-2 px-3 py-2 rounded-lg border border-gray-200 dark:border-gray-700 text-sm hover:bg-gray-50 disabled:opacity-50"
          >
            <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
            Refresh
          </button>
          <button
            onClick={remove}
            className="inline-flex items-center gap-2 px-3 py-2 rounded-lg border border-red-200 text-sm text-red-600 hover:bg-red-50"
          >
            <Trash2 className="w-4 h-4" />
            Delete
          </button>
        </div>
      </div>

      {error && (
        <div className="mb-4 px-4 py-3 rounded-lg bg-red-50 border border-red-200 text-sm text-red-800">
          {error}
        </div>
      )}

      {loading && !result ? (
        <div className="text-sm text-gray-500 py-12 text-center">Running…</div>
      ) : result ? (
        <ReportResult result={result} />
      ) : null}
    </div>
  );
}

function ReportResult({ result }: { result: RunResponse }) {
  const { data, meta } = result;
  const chartType = meta.chartType;
  // Always compute chartData — hooks must not be conditional.
  const chartData = useChartData(data ?? [], meta);

  if (!data || data.length === 0) {
    return (
      <div className="bg-white dark:bg-gray-900 border border-gray-100 dark:border-gray-800 rounded-xl p-12 text-center text-sm text-gray-500">
        No data.
      </div>
    );
  }

  if (chartType === 'table' || chartData.length === 0) {
    // Fall back to a table when chart-friendly data couldn't be derived.
    return <ResultTable rows={data} />;
  }

  return (
    <div className="bg-white dark:bg-gray-900 border border-gray-100 dark:border-gray-800 rounded-xl p-5">
      <div className="text-xs text-gray-500 mb-3">
        {meta.count} row{meta.count === 1 ? '' : 's'}
        {meta.capped && ' (capped)'}
      </div>
      <div style={{ width: '100%', height: 380 }}>
        <ResponsiveContainer>
          {chartType === 'bar' ? (
            <BarChart data={chartData}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="label" />
              <YAxis />
              <Tooltip />
              <Bar dataKey="value" fill="#3b82f6" />
            </BarChart>
          ) : chartType === 'line' ? (
            <LineChart data={chartData}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="label" />
              <YAxis />
              <Tooltip />
              <Line type="monotone" dataKey="value" stroke="#3b82f6" />
            </LineChart>
          ) : (
            <PieChart>
              <Tooltip />
              <Pie
                data={chartData}
                dataKey="value"
                nameKey="label"
                outerRadius={140}
                label
              >
                {chartData.map((_, idx) => (
                  <Cell key={idx} fill={CHART_COLORS[idx % CHART_COLORS.length]} />
                ))}
              </Pie>
            </PieChart>
          )}
        </ResponsiveContainer>
      </div>
    </div>
  );
}

function useChartData(rows: any[], meta: ReportMeta) {
  return useMemo(() => {
    if (!meta.groupBy) return [];
    const agg = meta.aggregations[0];
    return rows
      .map((r) => {
        const label = String(r[meta.groupBy as string] ?? '—');
        let value = 0;
        if (!agg) {
          value = 1;
        } else if (agg.fn === 'count') {
          value = Number(r._count?._all ?? r._count ?? 0);
        } else {
          const bucket = r[`_${agg.fn}`];
          value = Number(bucket?.[agg.field as string] ?? 0);
        }
        return { label, value };
      })
      .filter((d) => Number.isFinite(d.value));
  }, [rows, meta]);
}

function ResultTable({ rows }: { rows: any[] }) {
  // Derive columns from the union of keys in the first ~5 rows.
  const columns = useMemo(() => {
    const set = new Set<string>();
    for (const r of rows.slice(0, 5)) {
      if (r && typeof r === 'object') {
        Object.keys(r).forEach((k) => set.add(k));
      }
    }
    return [...set];
  }, [rows]);

  return (
    <div className="bg-white dark:bg-gray-900 border border-gray-100 dark:border-gray-800 rounded-xl overflow-hidden">
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 dark:bg-gray-800/40 text-xs uppercase text-gray-500 dark:text-gray-400">
            <tr>
              {columns.map((c) => (
                <th key={c} className="px-4 py-2 text-left font-medium whitespace-nowrap">
                  {c}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
            {rows.map((r, idx) => (
              <tr key={idx} className="hover:bg-gray-50 dark:hover:bg-gray-800/40">
                {columns.map((c) => (
                  <td key={c} className="px-4 py-2 text-gray-700 dark:text-gray-200 whitespace-nowrap">
                    {formatCell(r[c])}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function formatCell(v: unknown): string {
  if (v === null || v === undefined) return '—';
  if (typeof v === 'object') return JSON.stringify(v);
  if (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}T/.test(v)) {
    return new Date(v).toLocaleDateString();
  }
  return String(v);
}
