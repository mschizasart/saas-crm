'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { ListPageLayout } from '@/components/layouts/list-page-layout';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { ErrorBanner } from '@/components/ui/error-banner';
import { EmptyState } from '@/components/ui/empty-state';
import { TableSkeleton } from '@/components/ui/table-skeleton';
import { apiFetch } from '@/lib/api';
import {
  DateRangeFilter,
  defaultDateRange,
  formatCurrency,
} from '../_shared';

interface ItemRow {
  description: string;
  totalQty: number;
  totalRevenue: number;
  invoiceCount: number;
  productId: string | null;
  sku: string | null;
  stockQuantity: number | null;
  trackInventory: boolean;
}

const STATUSES = ['paid', 'partial', 'sent', 'overdue', 'draft', 'cancelled'] as const;
type Status = (typeof STATUSES)[number];

export default function ItemsReportPage() {
  const [range, setRange] = useState(defaultDateRange());
  const [selectedStatuses, setSelectedStatuses] = useState<Status[]>([
    'paid',
    'partial',
    'sent',
    'overdue',
  ]);
  const [rows, setRows] = useState<ItemRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    setError(null);
    const params = new URLSearchParams({
      from: range.from,
      to: range.to,
    });
    if (selectedStatuses.length > 0) {
      params.set('status', selectedStatuses.join(','));
    } else {
      params.set('status', 'all');
    }

    apiFetch(`/api/v1/reports/items?${params.toString()}`)
      .then(async (res) => {
        if (!res.ok) throw new Error('Failed to load items report');
        return res.json();
      })
      .then((data: ItemRow[]) => {
        if (alive) setRows(data);
      })
      .catch((e) => alive && setError(e.message))
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
  }, [range, selectedStatuses]);

  const totals = useMemo(() => {
    return rows.reduce(
      (acc, r) => {
        acc.qty += r.totalQty;
        acc.revenue += r.totalRevenue;
        acc.invoices += r.invoiceCount;
        return acc;
      },
      { qty: 0, revenue: 0, invoices: 0 },
    );
  }, [rows]);

  function toggleStatus(s: Status) {
    setSelectedStatuses((prev) =>
      prev.includes(s) ? prev.filter((x) => x !== s) : [...prev, s],
    );
  }

  function exportCsv() {
    const header = ['Description', 'SKU', 'Qty sold', 'Revenue', 'Invoice count', 'Current stock'];
    const escape = (v: unknown) => {
      const s = v == null ? '' : String(v);
      if (s.includes(',') || s.includes('"') || s.includes('\n')) {
        return `"${s.replace(/"/g, '""')}"`;
      }
      return s;
    };
    const body = rows.map((r) =>
      [
        r.description,
        r.sku ?? '',
        r.totalQty,
        r.totalRevenue.toFixed(2),
        r.invoiceCount,
        r.stockQuantity ?? '',
      ]
        .map(escape)
        .join(','),
    );
    const csv = [header.join(','), ...body].join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
    const href = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = href;
    a.download = `items-report-${range.from}-to-${range.to}.csv`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(href);
  }

  const filtersNode = (
    <div className="flex flex-wrap items-center gap-3">
      <DateRangeFilter from={range.from} to={range.to} onChange={setRange} />
      <div className="flex flex-wrap gap-1.5">
        {STATUSES.map((s) => {
          const active = selectedStatuses.includes(s);
          return (
            <button
              key={s}
              type="button"
              onClick={() => toggleStatus(s)}
              className={`px-2.5 py-1 rounded-full text-[11px] font-medium border transition-colors ${
                active
                  ? 'bg-primary text-white border-primary'
                  : 'bg-white dark:bg-gray-900 border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-gray-100'
              }`}
            >
              {s}
            </button>
          );
        })}
      </div>
      <Button size="sm" variant="secondary" onClick={exportCsv} disabled={rows.length === 0}>
        Export CSV
      </Button>
    </div>
  );

  return (
    <ListPageLayout
      title="Items Report"
      subtitle="Line items aggregated across invoices — what actually sold, how much revenue it drove, and how many of it you have left."
      filters={filtersNode}
    >
      {error && (
        <div className="mb-4">
          <ErrorBanner message={error} />
        </div>
      )}

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-4">
        <StatCard label="Total revenue" value={formatCurrency(totals.revenue)} />
        <StatCard label="Total qty sold" value={totals.qty.toLocaleString()} />
        <StatCard label="Invoices" value={totals.invoices.toLocaleString()} />
      </div>

      <Card>
        <div className="overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead>
              <tr className="bg-gray-50 dark:bg-gray-900 border-b border-gray-100 dark:border-gray-800 text-left text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide">
                <th className="px-4 py-3">Product / Description</th>
                <th className="px-4 py-3 hidden md:table-cell">SKU</th>
                <th className="px-4 py-3 text-right">Qty sold</th>
                <th className="px-4 py-3 text-right">Revenue</th>
                <th className="px-4 py-3 text-right hidden md:table-cell">Invoices</th>
                <th className="px-4 py-3 text-right">Current stock</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <TableSkeleton rows={6} columns={6} />
              ) : rows.length === 0 ? (
                <tr>
                  <td colSpan={6} className="p-0">
                    <EmptyState
                      title="No data"
                      description="No invoices match the selected date range and status filters."
                    />
                  </td>
                </tr>
              ) : (
                rows.map((r) => (
                  <tr key={r.description} className="border-b border-gray-100 dark:border-gray-800">
                    <td className="px-4 py-3 font-medium text-gray-900 dark:text-gray-100">
                      {r.productId ? (
                        <Link href={`/products/${r.productId}`} className="hover:text-primary hover:underline">
                          {r.description}
                        </Link>
                      ) : (
                        r.description
                      )}
                    </td>
                    <td className="px-4 py-3 text-gray-500 dark:text-gray-400 hidden md:table-cell">
                      {r.sku ?? <span className="text-gray-300 dark:text-gray-600">--</span>}
                    </td>
                    <td className="px-4 py-3 text-right tabular-nums">{r.totalQty}</td>
                    <td className="px-4 py-3 text-right tabular-nums font-semibold">
                      {formatCurrency(r.totalRevenue)}
                    </td>
                    <td className="px-4 py-3 text-right tabular-nums hidden md:table-cell">
                      {r.invoiceCount}
                    </td>
                    <td className="px-4 py-3 text-right">
                      {r.trackInventory && r.stockQuantity != null ? (
                        <span className="tabular-nums">
                          {r.stockQuantity}
                          {r.stockQuantity <= 5 && (
                            <Badge variant="error" className="ml-2 text-[10px]">LOW</Badge>
                          )}
                        </span>
                      ) : (
                        <span className="text-gray-300 dark:text-gray-600">--</span>
                      )}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </Card>
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
