'use client';

import { useEffect, useState } from 'react';

// ─── Account hierarchy rollup tiles (Wave F1) ──────────────────
//
// Drop-in component for a client detail page. Fetches the rollup
// endpoint and renders four tiles:
//   * Invoice total   (combined: self + descendants)
//   * Open invoices   (count)
//   * Lead count      (combined)
//   * Open opp amount (combined)
//
// Self-only fallback when the client has no descendants — we still
// show the tiles but mark them "(this account)" to make it obvious
// there's no rollup happening. Designed to live in the page as a
// stand-alone card so it doesn't depend on the rest of the detail
// page's plumbing.

interface MetricsBlock {
  invoiceTotal: number;
  openInvoiceCount: number;
  leadCount: number;
  openOpportunityCount: number;
  openOpportunityAmount: number;
}

interface RollupResult {
  rootClientId: string;
  selfMetrics: MetricsBlock;
  descendantMetrics: MetricsBlock;
  combinedMetrics: MetricsBlock;
  descendantCount: number;
}

const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001';

function getToken(): string | null {
  if (typeof window === 'undefined') return null;
  return localStorage.getItem('access_token');
}

function formatMoney(n: number) {
  // Use the user's locale, no currency symbol — invoices can be in
  // mixed currencies across a subtree, so a raw number is the least
  // misleading thing we can show. The label clarifies it's a sum.
  return new Intl.NumberFormat(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(n);
}

export function AccountHierarchyTile({ clientId }: { clientId: string }) {
  const [data, setData] = useState<RollupResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);

    fetch(`${API_BASE}/api/v1/clients/${clientId}/rollup`, {
      headers: { Authorization: `Bearer ${getToken()}` },
    })
      .then(async (r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json();
      })
      .then((j) => {
        if (!cancelled) setData(j);
      })
      .catch((e) => {
        if (!cancelled) setError(e?.message ?? 'Failed to load rollup');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [clientId]);

  if (loading) {
    return (
      <div className="bg-white dark:bg-gray-900 rounded-xl border border-gray-100 dark:border-gray-800 shadow-sm p-6">
        <div className="h-4 w-1/3 bg-gray-100 dark:bg-gray-800 rounded animate-pulse mb-4" />
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
          {[0, 1, 2, 3].map((i) => (
            <div
              key={i}
              className="h-16 bg-gray-50 dark:bg-gray-800 rounded animate-pulse"
            />
          ))}
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="bg-red-50 border border-red-100 text-red-600 text-sm rounded-xl p-4">
        Unable to load account rollup: {error}
      </div>
    );
  }

  if (!data) return null;

  const { combinedMetrics, descendantCount } = data;
  const isRolled = descendantCount > 0;

  const tiles = [
    {
      label: 'Invoice Total',
      value: formatMoney(combinedMetrics.invoiceTotal),
    },
    {
      label: 'Open Invoices',
      value: String(combinedMetrics.openInvoiceCount),
    },
    {
      label: 'Leads',
      value: String(combinedMetrics.leadCount),
    },
    {
      label: 'Open Opp. Amount',
      value: formatMoney(combinedMetrics.openOpportunityAmount),
    },
  ];

  return (
    <div className="bg-white dark:bg-gray-900 rounded-xl border border-gray-100 dark:border-gray-800 shadow-sm p-6">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-300">
          Account Rollup
        </h3>
        <span className="text-xs text-gray-400 dark:text-gray-500">
          {isRolled
            ? `Includes ${descendantCount} descendant${descendantCount === 1 ? '' : 's'}`
            : 'This account only'}
        </span>
      </div>
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        {tiles.map((t) => (
          <div
            key={t.label}
            className="bg-gray-50 dark:bg-gray-800/50 rounded-lg px-3 py-3"
          >
            <p className="text-xs font-medium text-gray-400 dark:text-gray-500 uppercase tracking-wide mb-1">
              {t.label}
            </p>
            <p className="text-xl font-bold text-gray-900 dark:text-gray-100">
              {t.value}
            </p>
          </div>
        ))}
      </div>
    </div>
  );
}

export default AccountHierarchyTile;
