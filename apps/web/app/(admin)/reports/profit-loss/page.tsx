'use client';

import { useEffect, useState } from 'react';
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  PieChart,
  Pie,
  Cell,
  Legend,
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
  PIE_PALETTE,
} from '../_shared';

interface ProfitLossReport {
  revenue: number;
  expenses: number;
  netProfit: number;
  taxEstimate: number;
  taxPercent: number;
  byMonth: Array<{
    period: string;
    revenue: number;
    expenses: number;
    profit: number;
  }>;
  expensesByCategory: Array<{
    category: string;
    amount: number;
  }>;
}

export default function ProfitLossPage() {
  const [range, setRange] = useState(defaultDateRange());
  const [data, setData] = useState<ProfitLossReport | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    setError(null);
    const qs = new URLSearchParams({ from: range.from, to: range.to });
    fetch(`${API_BASE}/api/v1/reports/profit-loss?${qs}`, {
      headers: authHeaders(),
    })
      .then(async (res) => {
        if (!res.ok) throw new Error('Failed to load P&L report');
        return res.json();
      })
      .then((json: ProfitLossReport) => {
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
        title="Profit & Loss"
        description="Revenue vs expenses, net profit and tax liability estimate."
        right={
          <div className="flex items-center gap-3 flex-wrap">
            <DateRangeFilter
              from={range.from}
              to={range.to}
              onChange={setRange}
            />
            <ExportMenu resource="expenses" filter={range} />
          </div>
        }
      />

      {error && <ErrorBanner message={error} />}

      {/* Stat cards */}
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
              value={formatCurrency(data.revenue)}
              accent="text-blue-600"
            />
            <StatCard
              label="Total Expenses"
              value={formatCurrency(data.expenses)}
              accent="text-amber-600"
            />
            <StatCard
              label="Net Profit"
              value={formatCurrency(data.netProfit)}
              accent={data.netProfit >= 0 ? 'text-green-600' : 'text-red-600'}
            />
            <StatCard
              label={`Tax Estimate (${data.taxPercent}%)`}
              value={formatCurrency(data.taxEstimate)}
              accent="text-gray-700"
            />
          </>
        )}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Line chart: Revenue vs Expenses by month */}
        <div className="lg:col-span-2 bg-white rounded-xl border border-gray-100 shadow-sm p-5">
          <h2 className="font-semibold text-gray-900 mb-4">Revenue vs Expenses by Month</h2>
          <div style={{ width: '100%', height: 320 }}>
            {loading || !data ? (
              <div className="h-full bg-gray-50 rounded animate-pulse" />
            ) : (
              <ResponsiveContainer>
                <LineChart data={data.byMonth}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                  <XAxis dataKey="period" tick={{ fontSize: 12 }} />
                  <YAxis tick={{ fontSize: 12 }} />
                  <Tooltip
                    formatter={(v: number) => formatCurrency(v)}
                    cursor={{ stroke: '#e0e0e0' }}
                  />
                  <Legend />
                  <Line
                    type="monotone"
                    dataKey="revenue"
                    stroke={CHART_COLORS.blue}
                    strokeWidth={2}
                    dot={{ r: 4 }}
                    name="Revenue"
                  />
                  <Line
                    type="monotone"
                    dataKey="expenses"
                    stroke={CHART_COLORS.red}
                    strokeWidth={2}
                    dot={{ r: 4 }}
                    name="Expenses"
                  />
                </LineChart>
              </ResponsiveContainer>
            )}
          </div>
        </div>

        {/* Pie chart: Expenses by category */}
        <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-5">
          <h2 className="font-semibold text-gray-900 mb-4">Expenses by Category</h2>
          <div style={{ width: '100%', height: 320 }}>
            {loading || !data ? (
              <div className="h-full bg-gray-50 rounded animate-pulse" />
            ) : data.expensesByCategory.length === 0 ? (
              <p className="text-sm text-gray-400 py-8 text-center">
                No expenses in this period.
              </p>
            ) : (
              <ResponsiveContainer>
                <PieChart>
                  <Pie
                    data={data.expensesByCategory}
                    dataKey="amount"
                    nameKey="category"
                    cx="50%"
                    cy="50%"
                    outerRadius={100}
                    label={({ category, percent }) =>
                      `${category} (${(percent * 100).toFixed(0)}%)`
                    }
                    labelLine={false}
                  >
                    {data.expensesByCategory.map((_, idx) => (
                      <Cell
                        key={idx}
                        fill={PIE_PALETTE[idx % PIE_PALETTE.length]}
                      />
                    ))}
                  </Pie>
                  <Tooltip
                    formatter={(v: number) => formatCurrency(v)}
                  />
                </PieChart>
              </ResponsiveContainer>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
