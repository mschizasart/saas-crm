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
} from 'recharts';
import {
  API_BASE,
  authHeaders,
  formatCurrency,
  defaultDateRange,
  StatCard,
  SkeletonCard,
  ErrorBanner,
  PageHeader,
  DateRangeFilter,
  ExportMenu,
  CHART_COLORS,
} from '../_shared';

interface SalesReport {
  totalRevenue: number;
  totalPaid: number;
  totalOutstanding: number;
  totalOverdue: number;
  byMonth: Array<{ period: string; revenue: number; count: number }>;
  topClients: Array<{
    clientId: string;
    company: string;
    totalRevenue: number;
    invoiceCount: number;
  }>;
}

export default function SalesReportPage() {
  const [range, setRange] = useState(defaultDateRange());
  const [data, setData] = useState<SalesReport | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    setError(null);
    const qs = new URLSearchParams({ from: range.from, to: range.to });
    fetch(`${API_BASE}/api/v1/reports/sales?${qs}`, { headers: authHeaders() })
      .then(async (res) => {
        if (!res.ok) throw new Error('Failed to load sales report');
        return res.json();
      })
      .then((json: SalesReport) => {
        if (alive) setData(json);
      })
      .catch((e) => alive && setError(e.message))
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
  }, [range]);

  return (
    <div>
      <PageHeader
        title="Sales Report"
        description="Revenue by month, outstanding balances and top paying clients."
        right={
          <div className="flex items-center gap-3 flex-wrap">
            <DateRangeFilter
              from={range.from}
              to={range.to}
              onChange={setRange}
            />
            <ExportMenu resource="invoices" filter={range} />
          </div>
        }
      />

      {error && <ErrorBanner message={error} />}

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
        {loading || !data ? (
          <>
            <SkeletonCard />
            <SkeletonCard />
            <SkeletonCard />
            <SkeletonCard />
          </>
        ) : (
          <>
            <StatCard
              label="Total Revenue"
              value={formatCurrency(data.totalRevenue)}
              accent="text-blue-600"
            />
            <StatCard
              label="Total Paid"
              value={formatCurrency(data.totalPaid)}
              accent="text-green-600"
            />
            <StatCard
              label="Outstanding"
              value={formatCurrency(data.totalOutstanding)}
              accent="text-amber-600"
            />
            <StatCard
              label="Overdue"
              value={formatCurrency(data.totalOverdue)}
              accent="text-red-600"
            />
          </>
        )}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 bg-white dark:bg-gray-900 rounded-xl border border-gray-100 dark:border-gray-800 shadow-sm p-5">
          <h2 className="font-semibold text-gray-900 dark:text-gray-100 mb-4">Revenue by Month</h2>
          <div style={{ width: '100%', height: 320 }}>
            {loading || !data ? (
              <div className="h-full bg-gray-50 dark:bg-gray-900 rounded animate-pulse" />
            ) : (
              <ResponsiveContainer>
                <BarChart data={data.byMonth}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                  <XAxis dataKey="period" tick={{ fontSize: 12 }} />
                  <YAxis tick={{ fontSize: 12 }} />
                  <Tooltip
                    formatter={(v: number) => formatCurrency(v)}
                    cursor={{ fill: '#f9fafb' }}
                  />
                  <Bar
                    dataKey="revenue"
                    fill={CHART_COLORS.blue}
                    radius={[4, 4, 0, 0]}
                  />
                </BarChart>
              </ResponsiveContainer>
            )}
          </div>
        </div>

        <div className="bg-white dark:bg-gray-900 rounded-xl border border-gray-100 dark:border-gray-800 shadow-sm p-5">
          <h2 className="font-semibold text-gray-900 dark:text-gray-100 mb-4">Top Clients</h2>
          {loading || !data ? (
            <div className="space-y-2">
              {Array.from({ length: 6 }).map((_, i) => (
                <div
                  key={i}
                  className="h-8 bg-gray-50 dark:bg-gray-900 rounded animate-pulse"
                />
              ))}
            </div>
          ) : data.topClients.length === 0 ? (
            <p className="text-sm text-gray-400 dark:text-gray-500 py-4 text-center">
              No paid invoices in range.
            </p>
          ) : (
            <ul className="divide-y divide-gray-100 dark:divide-gray-800">
              {data.topClients.map((c) => (
                <li
                  key={c.clientId}
                  className="py-2 flex items-center justify-between gap-2"
                >
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-gray-800 dark:text-gray-200 truncate">
                      {c.company}
                    </p>
                    <p className="text-xs text-gray-400 dark:text-gray-500">
                      {c.invoiceCount} invoice
                      {c.invoiceCount !== 1 ? 's' : ''}
                    </p>
                  </div>
                  <p className="text-sm font-semibold text-gray-900 dark:text-gray-100 whitespace-nowrap">
                    {formatCurrency(c.totalRevenue)}
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
