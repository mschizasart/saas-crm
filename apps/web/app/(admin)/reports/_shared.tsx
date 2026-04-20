'use client';

import { ReactNode } from 'react';

export const API_BASE =
  process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001';

export function getToken(): string | null {
  if (typeof window === 'undefined') return null;
  return localStorage.getItem('access_token');
}

export function authHeaders(): HeadersInit {
  const t = getToken();
  return t ? { Authorization: `Bearer ${t}` } : {};
}

export function formatCurrency(n: number, currency = 'USD'): string {
  try {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency,
      maximumFractionDigits: 0,
    }).format(n);
  } catch {
    return `${currency} ${n.toFixed(0)}`;
  }
}

export function formatHours(n: number): string {
  return `${n.toFixed(1)} h`;
}

export function defaultDateRange() {
  const to = new Date();
  const from = new Date();
  from.setDate(from.getDate() - 30);
  return {
    from: from.toISOString().slice(0, 10),
    to: to.toISOString().slice(0, 10),
  };
}

export function StatCard({
  label,
  value,
  sub,
  accent = 'text-gray-900',
}: {
  label: string;
  value: string;
  sub?: string;
  accent?: string;
}) {
  return (
    <div className="bg-white dark:bg-gray-900 rounded-xl border border-gray-100 dark:border-gray-800 shadow-sm p-5">
      <p className="text-xs font-semibold text-gray-400 dark:text-gray-500 uppercase tracking-wide mb-2">
        {label}
      </p>
      <p className={`text-2xl font-bold ${accent}`}>{value}</p>
      {sub && <p className="text-xs text-gray-400 dark:text-gray-500 mt-1">{sub}</p>}
    </div>
  );
}

export function SkeletonCard() {
  return (
    <div className="bg-white dark:bg-gray-900 rounded-xl border border-gray-100 dark:border-gray-800 shadow-sm p-5 animate-pulse">
      <div className="h-3 w-1/2 bg-gray-100 dark:bg-gray-800 rounded mb-3" />
      <div className="h-7 w-2/3 bg-gray-100 dark:bg-gray-800 rounded" />
    </div>
  );
}

export function ErrorBanner({ message }: { message: string }) {
  return (
    <div className="mb-4 rounded-lg border border-red-200 bg-red-50 text-sm text-red-700 px-4 py-3">
      {message}
    </div>
  );
}

export function PageHeader({
  title,
  description,
  right,
}: {
  title: string;
  description?: string;
  right?: ReactNode;
}) {
  return (
    <div className="mb-6 flex items-start justify-between gap-4 flex-wrap">
      <div>
        <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">{title}</h1>
        {description && (
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">{description}</p>
        )}
      </div>
      {right}
    </div>
  );
}

export function DateRangeFilter({
  from,
  to,
  onChange,
}: {
  from: string;
  to: string;
  onChange: (next: { from: string; to: string }) => void;
}) {
  return (
    <div className="flex items-center gap-2">
      <input
        type="date"
        value={from}
        onChange={(e) => onChange({ from: e.target.value, to })}
        className="rounded-lg border border-gray-200 dark:border-gray-700 px-3 py-1.5 text-sm focus:ring-2 focus:ring-primary focus:border-primary"
      />
      <span className="text-xs text-gray-400 dark:text-gray-500">to</span>
      <input
        type="date"
        value={to}
        onChange={(e) => onChange({ from, to: e.target.value })}
        className="rounded-lg border border-gray-200 dark:border-gray-700 px-3 py-1.5 text-sm focus:ring-2 focus:ring-primary focus:border-primary"
      />
    </div>
  );
}

export const CHART_COLORS = {
  blue: '#3B82F6',
  green: '#22C55E',
  red: '#EF4444',
  amber: '#F59E0B',
  violet: '#8B5CF6',
  cyan: '#06B6D4',
  rose: '#F43F5E',
  emerald: '#10B981',
  indigo: '#6366F1',
  teal: '#14B8A6',
  pink: '#EC4899',
  orange: '#F97316',
  slate: '#64748B',
};

export const PIE_PALETTE = [
  CHART_COLORS.blue,
  CHART_COLORS.violet,
  CHART_COLORS.emerald,
  CHART_COLORS.amber,
  CHART_COLORS.rose,
  CHART_COLORS.cyan,
  CHART_COLORS.indigo,
  CHART_COLORS.teal,
  CHART_COLORS.pink,
  CHART_COLORS.orange,
];

export async function downloadExport(
  resource: string,
  format: 'csv' | 'xlsx',
  extra: Record<string, string | undefined> = {},
) {
  const params = new URLSearchParams();
  params.set('format', format);
  for (const [k, v] of Object.entries(extra)) {
    if (v) params.set(k, v);
  }
  const url = `${API_BASE}/api/v1/exports/${resource}?${params.toString()}`;
  const res = await fetch(url, { headers: authHeaders() });
  if (!res.ok) {
    alert('Export failed');
    return;
  }
  const blob = await res.blob();
  const href = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = href;
  a.download = `${resource}.${format}`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(href);
}

export function ExportMenu({
  resource,
  filter,
}: {
  resource: string;
  filter?: Record<string, string | undefined>;
}) {
  return (
    <div className="flex items-center gap-2">
      <button
        type="button"
        onClick={() => downloadExport(resource, 'xlsx', filter)}
        className="inline-flex items-center px-3 py-1.5 rounded-lg bg-primary text-white text-xs font-medium hover:opacity-90"
      >
        Export Excel
      </button>
      <button
        type="button"
        onClick={() => downloadExport(resource, 'csv', filter)}
        className="inline-flex items-center px-3 py-1.5 rounded-lg border border-gray-200 dark:border-gray-700 text-gray-700 dark:text-gray-300 text-xs font-medium hover:bg-gray-50 dark:hover:bg-gray-800"
      >
        Export CSV
      </button>
    </div>
  );
}
