'use client';

import { useEffect, useMemo, useState } from 'react';
import { ListPageLayout } from '@/components/layouts/list-page-layout';
import { Card } from '@/components/ui/card';
import { ErrorBanner } from '@/components/ui/error-banner';
import { apiFetch } from '@/lib/api';

type Period = 'month' | 'quarter';

interface ForecastBucket {
  period: string;
  count: number;
  totalAmount: number;
  weightedAmount: number;
  wonAmount: number;
  openAmount: number;
}

interface OwnerForecast {
  ownerId: string;
  ownerName: string;
  count: number;
  totalAmount: number;
  weightedAmount: number;
  wonAmount: number;
  openAmount: number;
}

function formatMoney(n: number): string {
  try {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
      maximumFractionDigits: 0,
    }).format(n);
  } catch {
    return `$${n.toLocaleString()}`;
  }
}

export default function ForecastsPage() {
  const [period, setPeriod] = useState<Period>('month');
  const months = 6;
  const [buckets, setBuckets] = useState<ForecastBucket[]>([]);
  const [byOwner, setByOwner] = useState<OwnerForecast[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const [wRes, oRes] = await Promise.all([
        apiFetch(`/api/v1/forecasts/weighted?period=${period}&months=${months}`),
        apiFetch(`/api/v1/forecasts/by-owner?months=${months}`),
      ]);
      if (!wRes.ok) throw new Error(`Weighted forecast failed: ${wRes.status}`);
      if (!oRes.ok) throw new Error(`Owner forecast failed: ${oRes.status}`);
      setBuckets(await wRes.json());
      setByOwner(await oRes.json());
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [period]);

  // Bar chart scale — pick the largest bar (across totalAmount and
  // weighted, so weighted bars never overflow).
  const maxBar = useMemo(() => {
    let m = 0;
    for (const b of buckets) {
      if (b.totalAmount > m) m = b.totalAmount;
    }
    return m || 1;
  }, [buckets]);

  const totals = useMemo(() => {
    return buckets.reduce(
      (acc, b) => ({
        count: acc.count + b.count,
        totalAmount: acc.totalAmount + b.totalAmount,
        weightedAmount: acc.weightedAmount + b.weightedAmount,
        wonAmount: acc.wonAmount + b.wonAmount,
        openAmount: acc.openAmount + b.openAmount,
      }),
      { count: 0, totalAmount: 0, weightedAmount: 0, wonAmount: 0, openAmount: 0 },
    );
  }, [buckets]);

  const filtersNode = (
    <div className="inline-flex rounded-lg border border-gray-200 dark:border-gray-700 overflow-hidden">
      <button
        onClick={() => setPeriod('month')}
        className={`px-3 py-2 text-xs font-medium ${
          period === 'month' ? 'bg-primary text-white' : 'bg-white text-gray-600 hover:bg-gray-50'
        }`}
      >
        Monthly
      </button>
      <button
        onClick={() => setPeriod('quarter')}
        className={`px-3 py-2 text-xs font-medium ${
          period === 'quarter' ? 'bg-primary text-white' : 'bg-white text-gray-600 hover:bg-gray-50'
        }`}
      >
        Quarterly
      </button>
    </div>
  );

  return (
    <ListPageLayout
      title="Forecasts"
      subtitle="Weighted pipeline forecast for the next 6 months"
      filters={filtersNode}
    >
      {error && <div className="mb-4"><ErrorBanner message={error} /></div>}

      {/* Summary tiles */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
        <Card className="p-4">
          <p className="text-xs text-gray-500">Open Pipeline</p>
          <p className="text-lg font-semibold mt-1">{formatMoney(totals.openAmount)}</p>
        </Card>
        <Card className="p-4">
          <p className="text-xs text-gray-500">Weighted Forecast</p>
          <p className="text-lg font-semibold mt-1 text-primary">{formatMoney(totals.weightedAmount)}</p>
        </Card>
        <Card className="p-4">
          <p className="text-xs text-gray-500">Closed Won</p>
          <p className="text-lg font-semibold mt-1 text-green-600">{formatMoney(totals.wonAmount)}</p>
        </Card>
        <Card className="p-4">
          <p className="text-xs text-gray-500">Total Deals</p>
          <p className="text-lg font-semibold mt-1">{totals.count}</p>
        </Card>
      </div>

      {/* Bar chart */}
      <Card className="p-5 mb-6">
        <h2 className="text-sm font-semibold mb-4">
          {period === 'month' ? 'Monthly' : 'Quarterly'} forecast
        </h2>
        {loading ? (
          <p className="text-sm text-gray-400">Loading…</p>
        ) : buckets.length === 0 ? (
          <p className="text-sm text-gray-400">No deals closing in the next {months} months.</p>
        ) : (
          <div className="space-y-3">
            {buckets.map((b) => {
              const totalPct = (b.totalAmount / maxBar) * 100;
              const weightedPct = (b.weightedAmount / maxBar) * 100;
              return (
                <div key={b.period}>
                  <div className="flex items-center justify-between text-xs font-medium mb-1">
                    <span className="text-gray-700 dark:text-gray-300">{b.period}</span>
                    <span className="text-gray-500 dark:text-gray-400">
                      {b.count} deals · {formatMoney(b.totalAmount)} total · {formatMoney(b.weightedAmount)} weighted
                    </span>
                  </div>
                  {/* Stacked bars: total (light) behind weighted (primary). */}
                  <div className="relative h-5 bg-gray-100 dark:bg-gray-800 rounded overflow-hidden">
                    <div
                      className="absolute inset-y-0 left-0 bg-blue-100 dark:bg-blue-900/40"
                      style={{ width: `${totalPct}%` }}
                    />
                    <div
                      className="absolute inset-y-0 left-0 bg-primary"
                      style={{ width: `${weightedPct}%` }}
                    />
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </Card>

      {/* By-owner table */}
      <Card className="p-5">
        <h2 className="text-sm font-semibold mb-4">By owner</h2>
        {loading ? (
          <p className="text-sm text-gray-400">Loading…</p>
        ) : byOwner.length === 0 ? (
          <p className="text-sm text-gray-400">No deals to forecast.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead>
                <tr className="text-left text-xs font-semibold text-gray-500 uppercase tracking-wide border-b border-gray-100 dark:border-gray-800">
                  <th className="px-3 py-2">Owner</th>
                  <th className="px-3 py-2 text-right">Deals</th>
                  <th className="px-3 py-2 text-right">Total</th>
                  <th className="px-3 py-2 text-right">Weighted</th>
                  <th className="px-3 py-2 text-right">Open</th>
                  <th className="px-3 py-2 text-right">Won</th>
                </tr>
              </thead>
              <tbody>
                {byOwner.map((row) => (
                  <tr key={row.ownerId} className="border-b border-gray-50 dark:border-gray-800 last:border-0">
                    <td className="px-3 py-2 font-medium text-gray-900 dark:text-gray-100">{row.ownerName}</td>
                    <td className="px-3 py-2 text-right text-gray-600 dark:text-gray-400">{row.count}</td>
                    <td className="px-3 py-2 text-right text-gray-600 dark:text-gray-400">{formatMoney(row.totalAmount)}</td>
                    <td className="px-3 py-2 text-right font-semibold text-primary">{formatMoney(row.weightedAmount)}</td>
                    <td className="px-3 py-2 text-right text-gray-600 dark:text-gray-400">{formatMoney(row.openAmount)}</td>
                    <td className="px-3 py-2 text-right text-green-600">{formatMoney(row.wonAmount)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </ListPageLayout>
  );
}
