'use client';

import { useEffect, useState } from 'react';
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Cell,
} from 'recharts';
import {
  API_BASE,
  authHeaders,
  defaultDateRange,
  StatCard,
  SkeletonCard,
  ErrorBanner,
  PageHeader,
  DateRangeFilter,
  CHART_COLORS,
} from '../_shared';

interface TicketsReport {
  totalTickets: number;
  byStatus: Record<string, number>;
  byPriority: Record<string, number>;
  avgResolutionTime: number;
  byAssignee: Array<{
    userId: string;
    name: string;
    count: number;
    avgResolution: number;
  }>;
}

const PRIORITY_COLORS: Record<string, string> = {
  low: CHART_COLORS.slate,
  medium: CHART_COLORS.amber,
  high: CHART_COLORS.orange,
  urgent: CHART_COLORS.red,
};

export default function TicketsReportPage() {
  const [range, setRange] = useState(defaultDateRange());
  const [data, setData] = useState<TicketsReport | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    setError(null);
    const qs = new URLSearchParams(range);
    fetch(`${API_BASE}/api/v1/reports/tickets?${qs}`, {
      headers: authHeaders(),
    })
      .then(async (res) => {
        if (!res.ok) throw new Error('Failed to load report');
        return res.json();
      })
      .then((json: TicketsReport) => alive && setData(json))
      .catch((e) => alive && setError(e.message))
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
  }, [range]);

  const priorityChart = data
    ? (['low', 'medium', 'high', 'urgent'] as const).map((p) => ({
        priority: p,
        count: data.byPriority[p] ?? 0,
      }))
    : [];

  return (
    <div>
      <PageHeader
        title="Support Tickets Report"
        description="Ticket volume, priority mix and resolution performance."
        right={
          <DateRangeFilter
            from={range.from}
            to={range.to}
            onChange={setRange}
          />
        }
      />

      {error && <ErrorBanner message={error} />}

      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-4 mb-6">
        {loading || !data ? (
          Array.from({ length: 6 }).map((_, i) => <SkeletonCard key={i} />)
        ) : (
          <>
            <StatCard
              label="Open"
              value={String(data.byStatus.open ?? 0)}
              accent="text-blue-600"
            />
            <StatCard
              label="In Progress"
              value={String(data.byStatus.in_progress ?? 0)}
              accent="text-amber-600"
            />
            <StatCard
              label="Answered"
              value={String(data.byStatus.answered ?? 0)}
              accent="text-violet-600"
            />
            <StatCard
              label="On Hold"
              value={String(data.byStatus.on_hold ?? 0)}
              accent="text-gray-600"
            />
            <StatCard
              label="Closed"
              value={String(data.byStatus.closed ?? 0)}
              accent="text-green-600"
            />
            <StatCard
              label="Avg Resolution"
              value={`${data.avgResolutionTime.toFixed(1)} h`}
              accent="text-rose-600"
            />
          </>
        )}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="bg-white dark:bg-gray-900 rounded-xl border border-gray-100 dark:border-gray-800 shadow-sm p-5">
          <h2 className="font-semibold text-gray-900 dark:text-gray-100 mb-4">Tickets by Priority</h2>
          <div style={{ width: '100%', height: 320 }}>
            {loading || !data ? (
              <div className="h-full bg-gray-50 dark:bg-gray-900 rounded animate-pulse" />
            ) : (
              <ResponsiveContainer>
                <BarChart data={priorityChart}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                  <XAxis dataKey="priority" tick={{ fontSize: 12 }} />
                  <YAxis tick={{ fontSize: 12 }} />
                  <Tooltip cursor={{ fill: '#f9fafb' }} />
                  <Bar dataKey="count" radius={[4, 4, 0, 0]}>
                    {priorityChart.map((p) => (
                      <Cell
                        key={p.priority}
                        fill={PRIORITY_COLORS[p.priority]}
                      />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            )}
          </div>
        </div>

        <div className="bg-white dark:bg-gray-900 rounded-xl border border-gray-100 dark:border-gray-800 shadow-sm p-5">
          <h2 className="font-semibold text-gray-900 dark:text-gray-100 mb-4">By Assignee</h2>
          {loading || !data ? (
            <div className="space-y-2">
              {Array.from({ length: 6 }).map((_, i) => (
                <div
                  key={i}
                  className="h-8 bg-gray-50 dark:bg-gray-900 rounded animate-pulse"
                />
              ))}
            </div>
          ) : data.byAssignee.length === 0 ? (
            <p className="text-sm text-gray-400 dark:text-gray-500 py-4 text-center">
              No assigned tickets.
            </p>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs font-semibold text-gray-400 dark:text-gray-500 uppercase border-b border-gray-100 dark:border-gray-800">
                  <th className="py-2">Assignee</th>
                  <th className="py-2 text-right">Count</th>
                  <th className="py-2 text-right">Avg Res.</th>
                </tr>
              </thead>
              <tbody>
                {data.byAssignee.map((a) => (
                  <tr
                    key={a.userId}
                    className="border-b border-gray-100 dark:border-gray-800 last:border-0"
                  >
                    <td className="py-2 text-gray-800 dark:text-gray-200 truncate max-w-[160px]">
                      {a.name}
                    </td>
                    <td className="py-2 text-right font-semibold text-gray-900 dark:text-gray-100">
                      {a.count}
                    </td>
                    <td className="py-2 text-right text-gray-500 dark:text-gray-400">
                      {a.avgResolution.toFixed(1)} h
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  );
}
