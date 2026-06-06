'use client';

/**
 * Dashboard composer/viewer (Wave D2).
 *
 * Loads `GET /dashboards/:id` which executes every widget's report on
 * the server in parallel and returns each widget's data inline. Layout
 * uses CSS Grid (no react-grid-layout dependency); each widget honors
 * its `position: { x, y, w, h }`.
 */
import { useEffect, useMemo, useState } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import { ArrowLeft, Plus, RefreshCw, Trash2, X } from 'lucide-react';
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

interface WidgetData {
  id: string;
  reportId: string;
  title: string | null;
  position: { x: number; y: number; w: number; h: number } | null;
  data: any[] | null;
  meta: any | null;
  error: string | null;
}

interface DashboardWithData {
  dashboard: {
    id: string;
    name: string;
    description: string | null;
  };
  widgets: WidgetData[];
}

interface ReportPickRow {
  id: string;
  name: string;
  entityType: string;
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

export default function DashboardViewerPage() {
  const params = useParams<{ id: string }>();
  const dashboardId = params?.id;

  const [data, setData] = useState<DashboardWithData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [picking, setPicking] = useState(false);
  const [reports, setReports] = useState<ReportPickRow[]>([]);

  const load = async () => {
    if (!dashboardId) return;
    setLoading(true);
    setError(null);
    try {
      const res = await apiFetch(`/api/v1/dashboards/${dashboardId}`);
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.message ?? `Failed (${res.status})`);
      }
      setData((await res.json()) as DashboardWithData);
    } catch (err: any) {
      setError(err?.message ?? 'Failed to load');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dashboardId]);

  const openPicker = async () => {
    setPicking(true);
    try {
      const res = await apiFetch('/api/v1/report-defs?limit=100');
      if (res.ok) {
        const body = await res.json();
        setReports(body.data ?? []);
      }
    } catch {
      /* ignore */
    }
  };

  const addWidget = async (reportId: string) => {
    if (!dashboardId) return;
    try {
      const res = await apiFetch(`/api/v1/dashboards/${dashboardId}/widgets`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          reportId,
          // Pick a sensible starting tile size. The user can resize
          // later by editing widget.position via PUT.
          position: { x: 0, y: 0, w: 6, h: 4 },
        }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.message ?? 'Failed');
      }
      setPicking(false);
      await load();
    } catch (err: any) {
      alert(err?.message ?? 'Failed to add widget');
    }
  };

  const removeWidget = async (widgetId: string) => {
    if (!confirm('Remove this widget?')) return;
    const res = await apiFetch(
      `/api/v1/dashboards/${dashboardId}/widgets/${widgetId}`,
      { method: 'DELETE' },
    );
    if (res.ok || res.status === 204) {
      await load();
    } else {
      alert('Failed to remove');
    }
  };

  return (
    <div>
      <div className="mb-6 flex items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <Link
            href="/dashboards"
            className="inline-flex items-center gap-1 text-sm text-gray-500 hover:text-gray-700"
          >
            <ArrowLeft className="w-4 h-4" />
            Back
          </Link>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">
            {data?.dashboard.name ?? 'Dashboard'}
          </h1>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={load}
            disabled={loading}
            className="inline-flex items-center gap-2 px-3 py-2 rounded-lg border border-gray-200 dark:border-gray-700 text-sm hover:bg-gray-50 disabled:opacity-50"
          >
            <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
            Refresh
          </button>
          <button
            onClick={openPicker}
            className="inline-flex items-center gap-2 px-3 py-2 rounded-lg bg-blue-600 text-white text-sm font-medium hover:bg-blue-700"
          >
            <Plus className="w-4 h-4" />
            Add Widget
          </button>
        </div>
      </div>

      {error && (
        <div className="mb-4 px-4 py-3 rounded-lg bg-red-50 border border-red-200 text-sm text-red-800">
          {error}
        </div>
      )}

      {loading && !data ? (
        <div className="text-sm text-gray-500 py-12 text-center">Loading…</div>
      ) : data && data.widgets.length === 0 ? (
        <div className="bg-white dark:bg-gray-900 border border-dashed border-gray-200 dark:border-gray-700 rounded-xl p-12 text-center">
          <p className="text-sm text-gray-500 dark:text-gray-400 mb-3">
            No widgets yet — add a report to get started.
          </p>
          <button
            onClick={openPicker}
            className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-blue-600 text-white text-sm font-medium hover:bg-blue-700"
          >
            <Plus className="w-4 h-4" />
            Add Widget
          </button>
        </div>
      ) : data ? (
        <DashboardGrid widgets={data.widgets} onRemove={removeWidget} />
      ) : null}

      {picking && (
        <ReportPickerModal
          reports={reports}
          onPick={addWidget}
          onClose={() => setPicking(false)}
        />
      )}
    </div>
  );
}

function DashboardGrid({
  widgets,
  onRemove,
}: {
  widgets: WidgetData[];
  onRemove: (id: string) => void;
}) {
  // 12-column CSS grid. Each widget consumes `w` cols and `h` rows.
  return (
    <div
      className="grid gap-4"
      style={{
        gridTemplateColumns: 'repeat(12, minmax(0, 1fr))',
        gridAutoRows: '90px',
      }}
    >
      {widgets.map((w) => {
        const colSpan = Math.max(1, Math.min(12, w.position?.w ?? 6));
        const rowSpan = Math.max(1, w.position?.h ?? 4);
        return (
          <div
            key={w.id}
            className="bg-white dark:bg-gray-900 border border-gray-100 dark:border-gray-800 rounded-xl shadow-sm overflow-hidden flex flex-col"
            style={{
              gridColumn: `span ${colSpan} / span ${colSpan}`,
              gridRow: `span ${rowSpan} / span ${rowSpan}`,
            }}
          >
            <div className="flex items-center justify-between px-4 py-2 border-b border-gray-100 dark:border-gray-800">
              <h3 className="text-sm font-semibold text-gray-900 dark:text-gray-100 truncate">
                {w.title ?? 'Widget'}
              </h3>
              <button
                onClick={() => onRemove(w.id)}
                className="p-1 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded"
                title="Remove widget"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="flex-1 min-h-0 p-3 overflow-hidden">
              <WidgetBody widget={w} />
            </div>
          </div>
        );
      })}
    </div>
  );
}

function WidgetBody({ widget }: { widget: WidgetData }) {
  // Always call hooks unconditionally.
  const chartData = useMemo(() => {
    if (!widget.data || !widget.meta?.groupBy) return [];
    const agg = widget.meta.aggregations?.[0];
    return widget.data
      .map((r: any) => {
        const label = String(r[widget.meta.groupBy] ?? '—');
        let value = 0;
        if (!agg) value = 1;
        else if (agg.fn === 'count') value = Number(r._count?._all ?? r._count ?? 0);
        else value = Number(r[`_${agg.fn}`]?.[agg.field] ?? 0);
        return { label, value };
      })
      .filter((d) => Number.isFinite(d.value));
  }, [widget]);

  if (widget.error) {
    return (
      <div className="text-xs text-red-600 p-2 bg-red-50 rounded">
        {widget.error}
      </div>
    );
  }
  if (!widget.data || widget.data.length === 0) {
    return <div className="text-xs text-gray-400">No data.</div>;
  }

  const chartType = widget.meta?.chartType ?? 'table';
  if (chartType === 'table' || chartData.length === 0) {
    return <MiniTable rows={widget.data} />;
  }

  return (
    <div style={{ width: '100%', height: '100%' }}>
      <ResponsiveContainer>
        {chartType === 'bar' ? (
          <BarChart data={chartData}>
            <CartesianGrid strokeDasharray="3 3" />
            <XAxis dataKey="label" tick={{ fontSize: 10 }} />
            <YAxis tick={{ fontSize: 10 }} />
            <Tooltip />
            <Bar dataKey="value" fill="#3b82f6" />
          </BarChart>
        ) : chartType === 'line' ? (
          <LineChart data={chartData}>
            <CartesianGrid strokeDasharray="3 3" />
            <XAxis dataKey="label" tick={{ fontSize: 10 }} />
            <YAxis tick={{ fontSize: 10 }} />
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
              outerRadius="80%"
              label={{ fontSize: 10 } as any}
            >
              {chartData.map((_, idx) => (
                <Cell key={idx} fill={CHART_COLORS[idx % CHART_COLORS.length]} />
              ))}
            </Pie>
          </PieChart>
        )}
      </ResponsiveContainer>
    </div>
  );
}

function MiniTable({ rows }: { rows: any[] }) {
  const columns = useMemo(() => {
    const set = new Set<string>();
    for (const r of rows.slice(0, 3)) {
      if (r && typeof r === 'object') Object.keys(r).forEach((k) => set.add(k));
    }
    return [...set].slice(0, 6);
  }, [rows]);

  return (
    <div className="overflow-auto h-full text-xs">
      <table className="w-full">
        <thead className="bg-gray-50 dark:bg-gray-800/40 text-gray-500">
          <tr>
            {columns.map((c) => (
              <th key={c} className="px-2 py-1 text-left font-medium">
                {c}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.slice(0, 50).map((r, idx) => (
            <tr key={idx} className="border-t border-gray-100 dark:border-gray-800">
              {columns.map((c) => (
                <td key={c} className="px-2 py-1 text-gray-700 dark:text-gray-200 whitespace-nowrap">
                  {formatCell(r[c])}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
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

function ReportPickerModal({
  reports,
  onPick,
  onClose,
}: {
  reports: ReportPickRow[];
  onPick: (id: string) => void;
  onClose: () => void;
}) {
  return (
    <div
      className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4"
      onClick={onClose}
    >
      <div
        className="bg-white dark:bg-gray-900 rounded-xl shadow-xl w-full max-w-md max-h-[70vh] overflow-hidden flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="px-4 py-3 border-b border-gray-100 dark:border-gray-800 flex items-center justify-between">
          <h3 className="font-semibold text-gray-900 dark:text-gray-100">Pick a report</h3>
          <button onClick={onClose} className="p-1 hover:bg-gray-100 dark:hover:bg-gray-800 rounded">
            <X className="w-4 h-4" />
          </button>
        </div>
        <div className="overflow-y-auto">
          {reports.length === 0 ? (
            <div className="p-6 text-sm text-gray-500 text-center">
              No saved reports yet.{' '}
              <Link href="/reports/builder/new" className="text-blue-600 hover:underline">
                Create one
              </Link>
            </div>
          ) : (
            <ul className="divide-y divide-gray-100 dark:divide-gray-800">
              {reports.map((r) => (
                <li key={r.id}>
                  <button
                    onClick={() => onPick(r.id)}
                    className="w-full text-left px-4 py-3 hover:bg-gray-50 dark:hover:bg-gray-800"
                  >
                    <div className="font-medium text-sm text-gray-900 dark:text-gray-100">
                      {r.name}
                    </div>
                    <div className="text-xs text-gray-500 dark:text-gray-400 capitalize">
                      {r.entityType}
                    </div>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}
