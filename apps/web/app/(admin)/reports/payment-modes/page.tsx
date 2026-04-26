'use client';

import { useEffect, useState } from 'react';
import {
  PieChart,
  Pie,
  Cell,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from 'recharts';
import { ListPageLayout } from '@/components/layouts/list-page-layout';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { ErrorBanner } from '@/components/ui/error-banner';
import { EmptyState } from '@/components/ui/empty-state';
import { TableSkeleton } from '@/components/ui/table-skeleton';
import { apiFetch } from '@/lib/api';
import {
  DateRangeFilter,
  defaultDateRange,
  formatCurrency,
  PIE_PALETTE,
} from '../_shared';

interface PaymentModeRow {
  paymentModeId: string | null;
  name: string;
  amount: number;
  count: number;
}

interface PaymentModesReport {
  totalAmount: number;
  totalTransactions: number;
  byMode: PaymentModeRow[];
}

export default function PaymentModesReportPage() {
  const [range, setRange] = useState(defaultDateRange());
  const [data, setData] = useState<PaymentModesReport | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    setError(null);
    const params = new URLSearchParams({ from: range.from, to: range.to });
    apiFetch(`/api/v1/reports/payment-modes?${params.toString()}`)
      .then(async (res) => {
        if (!res.ok) throw new Error('Failed to load payment modes report');
        return res.json();
      })
      .then((json: PaymentModesReport) => {
        if (alive) setData(json);
      })
      .catch((e) => alive && setError(e.message))
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
  }, [range]);

  function exportCsv() {
    if (!data) return;
    const header = ['Payment mode', 'Amount', 'Transactions'];
    const escape = (v: unknown) => {
      const s = v == null ? '' : String(v);
      if (s.includes(',') || s.includes('"') || s.includes('\n')) {
        return `"${s.replace(/"/g, '""')}"`;
      }
      return s;
    };
    const body = data.byMode.map((r) =>
      [r.name, r.amount.toFixed(2), r.count].map(escape).join(','),
    );
    const csv = [header.join(','), ...body].join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
    const href = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = href;
    a.download = `payment-modes-${range.from}-to-${range.to}.csv`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(href);
  }

  const filtersNode = (
    <div className="flex flex-wrap items-center gap-3">
      <DateRangeFilter from={range.from} to={range.to} onChange={setRange} />
      <Button
        size="sm"
        variant="secondary"
        onClick={exportCsv}
        disabled={!data || data.byMode.length === 0}
      >
        Export CSV
      </Button>
    </div>
  );

  const chartData = (data?.byMode ?? []).map((r, i) => ({
    name: r.name,
    value: r.amount,
    fill: PIE_PALETTE[i % PIE_PALETTE.length],
  }));

  return (
    <ListPageLayout
      title="Payment Modes Report"
      subtitle="Revenue breakdown by payment method across the selected period."
      filters={filtersNode}
    >
      {error && (
        <div className="mb-4">
          <ErrorBanner message={error} />
        </div>
      )}

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-4">
        <StatCard
          label="Total collected"
          value={data ? formatCurrency(data.totalAmount) : '--'}
        />
        <StatCard
          label="Total transactions"
          value={data ? data.totalTransactions.toLocaleString() : '--'}
        />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <Card className="p-4">
          <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-200 mb-3">Distribution</h3>
          {loading ? (
            <div className="h-72 bg-gray-50 dark:bg-gray-900 rounded-lg animate-pulse" />
          ) : !data || data.byMode.length === 0 ? (
            <EmptyState
              title="No payments"
              description="No payments recorded in this date range."
            />
          ) : (
            <div style={{ width: '100%', height: 320 }}>
              <ResponsiveContainer>
                <PieChart>
                  <Pie
                    data={chartData}
                    dataKey="value"
                    nameKey="name"
                    outerRadius={110}
                    label={(entry) => entry.name}
                  >
                    {chartData.map((e, i) => (
                      <Cell key={i} fill={e.fill} />
                    ))}
                  </Pie>
                  <Tooltip formatter={(value: number) => formatCurrency(Number(value))} />
                  <Legend />
                </PieChart>
              </ResponsiveContainer>
            </div>
          )}
        </Card>

        <Card>
          <div className="overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead>
                <tr className="bg-gray-50 dark:bg-gray-900 border-b border-gray-100 dark:border-gray-800 text-left text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide">
                  <th className="px-4 py-3">Payment mode</th>
                  <th className="px-4 py-3 text-right">Amount</th>
                  <th className="px-4 py-3 text-right">Transactions</th>
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  <TableSkeleton rows={4} columns={3} />
                ) : !data || data.byMode.length === 0 ? (
                  <tr>
                    <td colSpan={3} className="p-0">
                      <EmptyState title="No data" />
                    </td>
                  </tr>
                ) : (
                  data.byMode.map((r, i) => (
                    <tr
                      key={r.paymentModeId ?? `unspecified-${i}`}
                      className="border-b border-gray-100 dark:border-gray-800"
                    >
                      <td className="px-4 py-3 font-medium text-gray-900 dark:text-gray-100">
                        <span className="inline-flex items-center gap-2">
                          <span
                            className="inline-block w-2.5 h-2.5 rounded-full"
                            style={{ backgroundColor: PIE_PALETTE[i % PIE_PALETTE.length] }}
                            aria-hidden="true"
                          />
                          {r.name}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-right tabular-nums font-semibold">
                        {formatCurrency(r.amount)}
                      </td>
                      <td className="px-4 py-3 text-right tabular-nums">{r.count}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </Card>
      </div>
    </ListPageLayout>
  );
}

function StatCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-white dark:bg-gray-900 rounded-xl border border-gray-100 dark:border-gray-800 shadow-sm p-5">
      <p className="text-xs font-semibold text-gray-400 dark:text-gray-500 uppercase tracking-wide mb-2">
        {label}
      </p>
      <p className="text-2xl font-bold text-gray-900 dark:text-gray-100">{value}</p>
    </div>
  );
}
