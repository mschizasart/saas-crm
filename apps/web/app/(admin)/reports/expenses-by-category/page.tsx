'use client';

import { useEffect, useMemo, useState } from 'react';
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

interface CurrencySlice {
  currencyId: string | null;
  currency: string;
  count: number;
  total: number;
}

interface CategoryRow {
  categoryId: string | null;
  categoryName: string;
  categoryColor: string;
  count: number;
  total: number;
  percentage: number;
  hasMixedCurrency: boolean;
  byCurrency: CurrencySlice[];
}

interface ExpensesByCategoryReport {
  grandTotal: number;
  uncategorizedTotal: number;
  uncategorizedCount: number;
  categoryCount: number;
  hasMixedCurrency: boolean;
  defaultCurrency: { code: string | null; symbol: string; name: string } | null;
  byCategory: CategoryRow[];
}

interface ClientLite {
  id: string;
  company?: string | null;
  firstName?: string | null;
  lastName?: string | null;
}

type SortKey = 'categoryName' | 'count' | 'total' | 'percentage';
type SortDir = 'asc' | 'desc';

export default function ExpensesByCategoryReportPage() {
  const [range, setRange] = useState(defaultDateRange());
  const [billableOnly, setBillableOnly] = useState(false);
  const [clientId, setClientId] = useState<string>('');
  const [clients, setClients] = useState<ClientLite[]>([]);

  const [data, setData] = useState<ExpensesByCategoryReport | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [sortKey, setSortKey] = useState<SortKey>('total');
  const [sortDir, setSortDir] = useState<SortDir>('desc');

  // Load clients once for the dropdown
  useEffect(() => {
    let alive = true;
    apiFetch('/api/v1/clients?limit=500')
      .then((r) => (r.ok ? r.json() : { data: [] }))
      .then((json: { data?: ClientLite[] }) => {
        if (alive) setClients(json.data ?? []);
      })
      .catch(() => {
        /* ignore — dropdown just stays empty */
      });
    return () => {
      alive = false;
    };
  }, []);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    setError(null);
    const params = new URLSearchParams({ from: range.from, to: range.to });
    if (billableOnly) params.set('billable', 'true');
    if (clientId) params.set('clientId', clientId);

    apiFetch(`/api/v1/reports/expenses-by-category?${params.toString()}`)
      .then(async (res) => {
        if (!res.ok) throw new Error('Failed to load expenses-by-category report');
        return res.json();
      })
      .then((json: ExpensesByCategoryReport) => {
        if (alive) setData(json);
      })
      .catch((e) => alive && setError(e.message))
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
  }, [range, billableOnly, clientId]);

  const currencyCode = data?.defaultCurrency?.code || 'USD';

  const sortedRows = useMemo(() => {
    if (!data) return [] as CategoryRow[];
    const copy = [...data.byCategory];
    copy.sort((a, b) => {
      const dir = sortDir === 'asc' ? 1 : -1;
      if (sortKey === 'categoryName') {
        return a.categoryName.localeCompare(b.categoryName) * dir;
      }
      const av = a[sortKey] as number;
      const bv = b[sortKey] as number;
      return (av - bv) * dir;
    });
    return copy;
  }, [data, sortKey, sortDir]);

  function toggleSort(key: SortKey) {
    if (key === sortKey) {
      setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortKey(key);
      setSortDir(key === 'categoryName' ? 'asc' : 'desc');
    }
  }

  function exportCsv() {
    if (!data) return;
    const header = ['Category', 'Count', 'Total', '% of total', 'Mixed currency', 'Currency breakdown'];
    const escape = (v: unknown) => {
      const s = v == null ? '' : String(v);
      if (s.includes(',') || s.includes('"') || s.includes('\n')) {
        return `"${s.replace(/"/g, '""')}"`;
      }
      return s;
    };
    const body = sortedRows.map((r) =>
      [
        r.categoryName,
        r.count,
        r.total.toFixed(2),
        r.percentage.toFixed(2) + '%',
        r.hasMixedCurrency ? 'yes' : 'no',
        r.byCurrency
          .map((s) => `${s.currency}:${s.total.toFixed(2)}(${s.count})`)
          .join(' | '),
      ]
        .map(escape)
        .join(','),
    );
    const csv = [header.join(','), ...body].join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
    const href = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = href;
    a.download = `expenses-by-category-${range.from}-to-${range.to}.csv`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(href);
  }

  const clientLabel = (c: ClientLite) =>
    c.company && c.company.trim().length > 0
      ? c.company
      : [c.firstName, c.lastName].filter(Boolean).join(' ').trim() || 'Unnamed';

  const filtersNode = (
    <div className="flex flex-wrap items-center gap-3">
      <DateRangeFilter from={range.from} to={range.to} onChange={setRange} />

      <label className="inline-flex items-center gap-1.5 text-xs text-gray-600 dark:text-gray-400 cursor-pointer select-none">
        <input
          type="checkbox"
          checked={billableOnly}
          onChange={(e) => setBillableOnly(e.target.checked)}
          className="rounded border-gray-300 dark:border-gray-700 text-primary focus:ring-primary"
        />
        Billable only
      </label>

      <select
        value={clientId}
        onChange={(e) => setClientId(e.target.value)}
        className="rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 px-3 py-1.5 text-sm focus:ring-2 focus:ring-primary focus:border-primary"
      >
        <option value="">All clients</option>
        {clients.map((c) => (
          <option key={c.id} value={c.id}>
            {clientLabel(c)}
          </option>
        ))}
      </select>

      <Button
        size="sm"
        variant="secondary"
        onClick={exportCsv}
        disabled={!data || data.byCategory.length === 0}
      >
        Export CSV
      </Button>
    </div>
  );

  const chartData = (data?.byCategory ?? []).map((r, i) => ({
    name: r.categoryName,
    value: r.total,
    fill: r.categoryColor || PIE_PALETTE[i % PIE_PALETTE.length],
  }));

  const uncatPct =
    data && data.grandTotal > 0
      ? (data.uncategorizedTotal / data.grandTotal) * 100
      : 0;

  return (
    <ListPageLayout
      title="Expenses by Category"
      subtitle="Spend grouped by expense category over the selected period — for monthly close, tax prep, and cost-center analysis."
      filters={filtersNode}
    >
      {error && (
        <div className="mb-4">
          <ErrorBanner message={error} />
        </div>
      )}

      {/* Summary strip */}
      <div className="mb-4 rounded-xl border border-gray-100 dark:border-gray-800 bg-white dark:bg-gray-900 shadow-sm px-5 py-4 flex flex-wrap items-center gap-x-6 gap-y-2 text-sm">
        <div>
          <span className="text-xs font-semibold text-gray-400 dark:text-gray-500 uppercase tracking-wide mr-2">
            Total
          </span>
          <span className="text-base font-bold text-gray-900 dark:text-gray-100 tabular-nums">
            {data ? formatCurrency(data.grandTotal, currencyCode) : '--'}
          </span>
        </div>
        <span className="text-gray-300 dark:text-gray-600">•</span>
        <div>
          <span className="text-xs font-semibold text-gray-400 dark:text-gray-500 uppercase tracking-wide mr-2">
            Categories
          </span>
          <span className="text-base font-bold text-gray-900 dark:text-gray-100 tabular-nums">
            {data ? data.categoryCount : '--'}
          </span>
        </div>
        <span className="text-gray-300 dark:text-gray-600">•</span>
        <div>
          <span className="text-xs font-semibold text-gray-400 dark:text-gray-500 uppercase tracking-wide mr-2">
            Uncategorized
          </span>
          <span className="text-base font-bold text-gray-900 dark:text-gray-100 tabular-nums">
            {data ? formatCurrency(data.uncategorizedTotal, currencyCode) : '--'}
          </span>
          {data && data.uncategorizedTotal > 0 && (
            <span className="ml-1 text-xs text-gray-500 dark:text-gray-400 tabular-nums">
              ({uncatPct.toFixed(1)}%, {data.uncategorizedCount} entries)
            </span>
          )}
        </div>
      </div>

      {/* Mixed-currency warning */}
      {data?.hasMixedCurrency && (
        <div className="mb-4 rounded-lg border border-amber-200 bg-amber-50 text-sm text-amber-800 px-4 py-3 flex items-start gap-2">
          <span aria-hidden="true">⚠</span>
          <span>
            Some expenses use a non-default currency and have been summed without
            conversion. Review the per-category currency breakdown below for accuracy.
          </span>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <Card className="p-4">
          <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-200 mb-3">
            Category share of total
          </h3>
          {loading ? (
            <div className="h-72 bg-gray-50 dark:bg-gray-900 rounded-lg animate-pulse" />
          ) : !data || data.byCategory.length === 0 ? (
            <EmptyState
              title="No expenses"
              description="No expenses recorded in this date range."
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
                  <Tooltip
                    formatter={(value: number) =>
                      formatCurrency(Number(value), currencyCode)
                    }
                  />
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
                  <Th label="Category" sortKey="categoryName" currentKey={sortKey} dir={sortDir} onSort={toggleSort} />
                  <Th label="Count" sortKey="count" currentKey={sortKey} dir={sortDir} onSort={toggleSort} align="right" />
                  <Th label="Total" sortKey="total" currentKey={sortKey} dir={sortDir} onSort={toggleSort} align="right" />
                  <Th label="% of total" sortKey="percentage" currentKey={sortKey} dir={sortDir} onSort={toggleSort} align="right" />
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  <TableSkeleton rows={5} columns={4} />
                ) : !data || sortedRows.length === 0 ? (
                  <tr>
                    <td colSpan={4} className="p-0">
                      <EmptyState
                        title="No data"
                        description="No expenses match the selected filters."
                      />
                    </td>
                  </tr>
                ) : (
                  sortedRows.map((r, i) => (
                    <tr
                      key={r.categoryId ?? `uncategorized-${i}`}
                      className="border-b border-gray-100 dark:border-gray-800 transition-colors hover:bg-gray-50 dark:hover:bg-gray-800/50"
                    >
                      <td className="px-4 py-3 font-medium text-gray-900 dark:text-gray-100">
                        <span className="inline-flex items-center gap-2">
                          <span
                            className="inline-block w-2.5 h-2.5 rounded-full"
                            style={{ backgroundColor: r.categoryColor }}
                            aria-hidden="true"
                          />
                          <span>{r.categoryName}</span>
                          {r.hasMixedCurrency && (
                            <span
                              title="Mixed currencies"
                              className="text-[10px] font-semibold text-amber-700 bg-amber-50 border border-amber-200 rounded px-1.5 py-0.5"
                            >
                              MIXED
                            </span>
                          )}
                        </span>
                        {r.hasMixedCurrency && r.byCurrency.length > 1 && (
                          <div className="mt-1 text-[11px] text-gray-500 dark:text-gray-400 tabular-nums">
                            {r.byCurrency
                              .map(
                                (s) =>
                                  `${s.currency}: ${s.total.toFixed(2)} (${s.count})`,
                              )
                              .join(' • ')}
                          </div>
                        )}
                      </td>
                      <td className="px-4 py-3 text-right tabular-nums">{r.count}</td>
                      <td className="px-4 py-3 text-right tabular-nums font-semibold">
                        {formatCurrency(r.total, currencyCode)}
                      </td>
                      <td className="px-4 py-3 text-right tabular-nums">
                        {r.percentage.toFixed(1)}%
                      </td>
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

function Th({
  label,
  sortKey,
  currentKey,
  dir,
  onSort,
  align = 'left',
}: {
  label: string;
  sortKey: SortKey;
  currentKey: SortKey;
  dir: SortDir;
  onSort: (k: SortKey) => void;
  align?: 'left' | 'right';
}) {
  const active = currentKey === sortKey;
  return (
    <th
      className={`px-4 py-3 cursor-pointer select-none ${
        align === 'right' ? 'text-right' : 'text-left'
      }`}
      onClick={() => onSort(sortKey)}
    >
      <span className="inline-flex items-center gap-1">
        {label}
        <span
          className={`text-[10px] ${active ? 'text-gray-700 dark:text-gray-200' : 'text-gray-300 dark:text-gray-600'}`}
          aria-hidden="true"
        >
          {active ? (dir === 'asc' ? '▲' : '▼') : '↕'}
        </span>
      </span>
    </th>
  );
}
