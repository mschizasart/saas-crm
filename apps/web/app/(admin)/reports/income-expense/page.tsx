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
  Legend,
  PieChart,
  Pie,
  Cell,
} from 'recharts';
import {
  API_BASE,
  authHeaders,
  defaultDateRange,
  formatCurrency,
  StatCard,
  SkeletonCard,
  ErrorBanner,
  PageHeader,
  DateRangeFilter,
  ExportMenu,
  CHART_COLORS,
  PIE_PALETTE,
} from '../_shared';

interface IncomeExpenseReport {
  totalIncome: number;
  totalExpenses: number;
  netProfit: number;
  byMonth: Array<{
    period: string;
    income: number;
    expenses: number;
    profit: number;
  }>;
  byCategory: Array<{ category: string; amount: number }>;
}

export default function IncomeExpensePage() {
  const [range, setRange] = useState(defaultDateRange());
  const [data, setData] = useState<IncomeExpenseReport | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    setError(null);
    const qs = new URLSearchParams(range);
    fetch(`${API_BASE}/api/v1/reports/income-expense?${qs}`, {
      headers: authHeaders(),
    })
      .then(async (res) => {
        if (!res.ok) throw new Error('Failed to load report');
        return res.json();
      })
      .then((json: IncomeExpenseReport) => alive && setData(json))
      .catch((e) => alive && setError(e.message))
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
  }, [range]);

  return (
    <div>
      <PageHeader
        title="Income & Expenses"
        description="Monthly income vs expenses with expense category breakdown."
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
              label="Total Income"
              value={formatCurrency(data.totalIncome)}
              accent="text-green-600"
            />
            <StatCard
              label="Total Expenses"
              value={formatCurrency(data.totalExpenses)}
              accent="text-red-600"
            />
            <StatCard
              label="Net Profit"
              value={formatCurrency(data.netProfit)}
              accent={data.netProfit >= 0 ? 'text-emerald-600' : 'text-red-600'}
            />
          </>
        )}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 bg-white rounded-xl border border-gray-100 shadow-sm p-5">
          <h2 className="font-semibold text-gray-900 mb-4">
            Income vs Expenses
          </h2>
          <div style={{ width: '100%', height: 340 }}>
            {loading || !data ? (
              <div className="h-full bg-gray-50 rounded animate-pulse" />
            ) : (
              <ResponsiveContainer>
                <LineChart data={data.byMonth}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                  <XAxis dataKey="period" tick={{ fontSize: 12 }} />
                  <YAxis tick={{ fontSize: 12 }} />
                  <Tooltip formatter={(v: number) => formatCurrency(v)} />
                  <Legend wrapperStyle={{ fontSize: 12 }} />
                  <Line
                    type="monotone"
                    dataKey="income"
                    stroke={CHART_COLORS.green}
                    strokeWidth={2}
                  />
                  <Line
                    type="monotone"
                    dataKey="expenses"
                    stroke={CHART_COLORS.red}
                    strokeWidth={2}
                  />
                </LineChart>
              </ResponsiveContainer>
            )}
          </div>
        </div>

        <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-5">
          <h2 className="font-semibold text-gray-900 mb-4">
            Expenses by Category
          </h2>
          <div style={{ width: '100%', height: 340 }}>
            {loading || !data ? (
              <div className="h-full bg-gray-50 rounded animate-pulse" />
            ) : data.byCategory.length === 0 ? (
              <p className="text-sm text-gray-400 text-center py-10">
                No expenses in range.
              </p>
            ) : (
              <ResponsiveContainer>
                <PieChart>
                  <Pie
                    data={data.byCategory}
                    dataKey="amount"
                    nameKey="category"
                    outerRadius={110}
                    label
                  >
                    {data.byCategory.map((_, i) => (
                      <Cell
                        key={i}
                        fill={PIE_PALETTE[i % PIE_PALETTE.length]}
                      />
                    ))}
                  </Pie>
                  <Tooltip formatter={(v: number) => formatCurrency(v)} />
                  <Legend wrapperStyle={{ fontSize: 11 }} />
                </PieChart>
              </ResponsiveContainer>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
