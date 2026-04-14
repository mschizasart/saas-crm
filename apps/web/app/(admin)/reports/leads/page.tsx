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
  PieChart,
  Pie,
  Cell,
  Legend,
  LineChart,
  Line,
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
  ExportMenu,
  CHART_COLORS,
  PIE_PALETTE,
} from '../_shared';

interface LeadsReport {
  totalLeads: number;
  byStatus: Record<string, number>;
  conversionRate: number;
  bySource: Array<{ source: string; count: number }>;
  byMonth: Array<{ period: string; total: number; won: number; lost: number }>;
  topAssignees: Array<{
    userId: string;
    name: string;
    leadCount: number;
    wonCount: number;
  }>;
}

const STAGE_ORDER = [
  'new',
  'contacted',
  'qualified',
  'proposal',
  'negotiation',
  'won',
  'lost',
];

export default function LeadsReportPage() {
  const [range, setRange] = useState(defaultDateRange());
  const [data, setData] = useState<LeadsReport | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    setError(null);
    const qs = new URLSearchParams(range);
    fetch(`${API_BASE}/api/v1/reports/leads?${qs}`, { headers: authHeaders() })
      .then(async (res) => {
        if (!res.ok) throw new Error('Failed to load leads report');
        return res.json();
      })
      .then((json: LeadsReport) => alive && setData(json))
      .catch((e) => alive && setError(e.message))
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
  }, [range]);

  const funnel = data
    ? STAGE_ORDER.map((stage) => ({
        stage: stage.charAt(0).toUpperCase() + stage.slice(1),
        count: data.byStatus[stage] ?? 0,
      }))
    : [];

  return (
    <div>
      <PageHeader
        title="Leads Report"
        description="Lead funnel, sources and assignee performance."
        right={
          <div className="flex items-center gap-3 flex-wrap">
            <DateRangeFilter
              from={range.from}
              to={range.to}
              onChange={setRange}
            />
            <ExportMenu resource="leads" />
          </div>
        }
      />

      {error && <ErrorBanner message={error} />}

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-6">
        {loading || !data ? (
          <>
            <SkeletonCard />
            <SkeletonCard />
            <SkeletonCard />
          </>
        ) : (
          <>
            <StatCard
              label="Total Leads"
              value={String(data.totalLeads)}
              accent="text-violet-600"
            />
            <StatCard
              label="Won"
              value={String(data.byStatus.won ?? 0)}
              accent="text-green-600"
            />
            <StatCard
              label="Conversion Rate"
              value={`${data.conversionRate.toFixed(1)}%`}
              accent="text-blue-600"
            />
          </>
        )}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-6">
        <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-5">
          <h2 className="font-semibold text-gray-900 mb-4">Conversion Funnel</h2>
          <div style={{ width: '100%', height: 320 }}>
            {loading || !data ? (
              <div className="h-full bg-gray-50 animate-pulse rounded" />
            ) : (
              <ResponsiveContainer>
                <BarChart data={funnel} layout="vertical">
                  <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                  <XAxis type="number" tick={{ fontSize: 12 }} />
                  <YAxis
                    type="category"
                    dataKey="stage"
                    tick={{ fontSize: 12 }}
                    width={90}
                  />
                  <Tooltip cursor={{ fill: '#f9fafb' }} />
                  <Bar
                    dataKey="count"
                    fill={CHART_COLORS.violet}
                    radius={[0, 4, 4, 0]}
                  />
                </BarChart>
              </ResponsiveContainer>
            )}
          </div>
        </div>

        <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-5">
          <h2 className="font-semibold text-gray-900 mb-4">Lead Sources</h2>
          <div style={{ width: '100%', height: 320 }}>
            {loading || !data ? (
              <div className="h-full bg-gray-50 animate-pulse rounded" />
            ) : data.bySource.length === 0 ? (
              <p className="text-sm text-gray-400 text-center py-10">
                No source data.
              </p>
            ) : (
              <ResponsiveContainer>
                <PieChart>
                  <Pie
                    data={data.bySource}
                    dataKey="count"
                    nameKey="source"
                    outerRadius={110}
                    label
                  >
                    {data.bySource.map((_, i) => (
                      <Cell
                        key={i}
                        fill={PIE_PALETTE[i % PIE_PALETTE.length]}
                      />
                    ))}
                  </Pie>
                  <Tooltip />
                  <Legend wrapperStyle={{ fontSize: 12 }} />
                </PieChart>
              </ResponsiveContainer>
            )}
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 bg-white rounded-xl border border-gray-100 shadow-sm p-5">
          <h2 className="font-semibold text-gray-900 mb-4">Won vs Lost Over Time</h2>
          <div style={{ width: '100%', height: 320 }}>
            {loading || !data ? (
              <div className="h-full bg-gray-50 animate-pulse rounded" />
            ) : (
              <ResponsiveContainer>
                <LineChart data={data.byMonth}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                  <XAxis dataKey="period" tick={{ fontSize: 12 }} />
                  <YAxis tick={{ fontSize: 12 }} />
                  <Tooltip />
                  <Legend wrapperStyle={{ fontSize: 12 }} />
                  <Line
                    type="monotone"
                    dataKey="won"
                    stroke={CHART_COLORS.green}
                    strokeWidth={2}
                  />
                  <Line
                    type="monotone"
                    dataKey="lost"
                    stroke={CHART_COLORS.red}
                    strokeWidth={2}
                  />
                </LineChart>
              </ResponsiveContainer>
            )}
          </div>
        </div>

        <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-5">
          <h2 className="font-semibold text-gray-900 mb-4">Top Assignees</h2>
          {loading || !data ? (
            <div className="space-y-2">
              {Array.from({ length: 6 }).map((_, i) => (
                <div
                  key={i}
                  className="h-8 bg-gray-50 rounded animate-pulse"
                />
              ))}
            </div>
          ) : data.topAssignees.length === 0 ? (
            <p className="text-sm text-gray-400 py-4 text-center">
              No assigned leads.
            </p>
          ) : (
            <ul className="divide-y divide-gray-100">
              {data.topAssignees.map((a) => (
                <li
                  key={a.userId}
                  className="py-2 flex items-center justify-between gap-2"
                >
                  <p className="text-sm text-gray-800 truncate">{a.name}</p>
                  <p className="text-xs text-gray-500 whitespace-nowrap">
                    {a.wonCount}/{a.leadCount}
                  </p>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}
