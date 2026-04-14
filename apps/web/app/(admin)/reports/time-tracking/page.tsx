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
  Legend,
} from 'recharts';
import {
  API_BASE,
  authHeaders,
  defaultDateRange,
  formatHours,
  StatCard,
  SkeletonCard,
  ErrorBanner,
  PageHeader,
  DateRangeFilter,
  CHART_COLORS,
} from '../_shared';

interface TimeReport {
  totalHours: number;
  billableHours: number;
  byUser: Array<{
    userId: string;
    name: string;
    hours: number;
    billableHours: number;
  }>;
  byProject: Array<{ projectId: string; name: string; hours: number }>;
}

export default function TimeTrackingReportPage() {
  const [range, setRange] = useState(defaultDateRange());
  const [projectId, setProjectId] = useState('');
  const [userId, setUserId] = useState('');
  const [data, setData] = useState<TimeReport | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    setError(null);
    const qs = new URLSearchParams();
    if (range.from) qs.set('from', range.from);
    if (range.to) qs.set('to', range.to);
    if (projectId) qs.set('projectId', projectId);
    if (userId) qs.set('userId', userId);
    fetch(`${API_BASE}/api/v1/reports/time-tracking?${qs}`, {
      headers: authHeaders(),
    })
      .then(async (res) => {
        if (!res.ok) throw new Error('Failed to load report');
        return res.json();
      })
      .then((json: TimeReport) => alive && setData(json))
      .catch((e) => alive && setError(e.message))
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
  }, [range, projectId, userId]);

  return (
    <div>
      <PageHeader
        title="Time Tracking Report"
        description="Hours logged by team members and projects."
        right={
          <div className="flex items-center gap-2 flex-wrap">
            <input
              type="text"
              placeholder="Project ID"
              value={projectId}
              onChange={(e) => setProjectId(e.target.value)}
              className="rounded-lg border border-gray-200 px-3 py-1.5 text-sm w-36"
            />
            <input
              type="text"
              placeholder="User ID"
              value={userId}
              onChange={(e) => setUserId(e.target.value)}
              className="rounded-lg border border-gray-200 px-3 py-1.5 text-sm w-32"
            />
            <DateRangeFilter
              from={range.from}
              to={range.to}
              onChange={setRange}
            />
          </div>
        }
      />

      {error && <ErrorBanner message={error} />}

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-6">
        {loading || !data ? (
          <>
            <SkeletonCard />
            <SkeletonCard />
          </>
        ) : (
          <>
            <StatCard
              label="Total Hours"
              value={formatHours(data.totalHours)}
              accent="text-cyan-600"
            />
            <StatCard
              label="Billable Hours"
              value={formatHours(data.billableHours)}
              accent="text-green-600"
            />
          </>
        )}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-5">
          <h2 className="font-semibold text-gray-900 mb-4">Hours by User</h2>
          <div style={{ width: '100%', height: 340 }}>
            {loading || !data ? (
              <div className="h-full bg-gray-50 rounded animate-pulse" />
            ) : data.byUser.length === 0 ? (
              <p className="text-sm text-gray-400 text-center py-10">
                No time entries.
              </p>
            ) : (
              <ResponsiveContainer>
                <BarChart data={data.byUser}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                  <XAxis dataKey="name" tick={{ fontSize: 11 }} />
                  <YAxis tick={{ fontSize: 12 }} />
                  <Tooltip />
                  <Legend wrapperStyle={{ fontSize: 12 }} />
                  <Bar dataKey="hours" fill={CHART_COLORS.cyan} />
                  <Bar dataKey="billableHours" fill={CHART_COLORS.green} />
                </BarChart>
              </ResponsiveContainer>
            )}
          </div>
        </div>

        <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-5">
          <h2 className="font-semibold text-gray-900 mb-4">Hours by Project</h2>
          <div style={{ width: '100%', height: 340 }}>
            {loading || !data ? (
              <div className="h-full bg-gray-50 rounded animate-pulse" />
            ) : data.byProject.length === 0 ? (
              <p className="text-sm text-gray-400 text-center py-10">
                No time entries.
              </p>
            ) : (
              <ResponsiveContainer>
                <BarChart data={data.byProject}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                  <XAxis dataKey="name" tick={{ fontSize: 11 }} />
                  <YAxis tick={{ fontSize: 12 }} />
                  <Tooltip />
                  <Bar
                    dataKey="hours"
                    fill={CHART_COLORS.indigo}
                    radius={[4, 4, 0, 0]}
                  />
                </BarChart>
              </ResponsiveContainer>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
