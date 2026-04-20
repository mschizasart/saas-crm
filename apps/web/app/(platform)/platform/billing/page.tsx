'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  CartesianGrid,
} from 'recharts';

const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001';

interface BillingStats {
  mrr: number;
  arr: number;
  trialOrgs: number;
  activeOrgs: number;
  canceledOrgs: number;
  pastDueOrgs: number;
  totalPayingOrgs: number;
  churnRate: number;
}

interface OrgByPlan {
  planId: string;
  planName: string;
  planSlug: string;
  count: number;
  monthlyPrice: number;
  mrr: number;
}

interface RevenuePoint {
  period: string;
  org_count: number | string;
}

function formatCurrency(n: number) {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 0,
  }).format(n);
}

export default function PlatformBillingPage() {
  const router = useRouter();
  const [stats, setStats] = useState<BillingStats | null>(null);
  const [byPlan, setByPlan] = useState<OrgByPlan[]>([]);
  const [revenue, setRevenue] = useState<RevenuePoint[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const token = () =>
    typeof window === 'undefined' ? null : localStorage.getItem('platform_token');

  useEffect(() => {
    const load = async () => {
      const t = token();
      if (!t) {
        router.replace('/platform/login');
        return;
      }
      setLoading(true);
      setError(null);
      try {
        const headers = { Authorization: `Bearer ${t}` };
        const [sRes, pRes, rRes] = await Promise.all([
          fetch(`${API_BASE}/api/v1/platform/billing/stats`, { headers }),
          fetch(`${API_BASE}/api/v1/platform/billing/orgs-by-plan`, { headers }),
          fetch(`${API_BASE}/api/v1/platform/billing/revenue-by-month?months=12`, { headers }),
        ]);
        if (sRes.status === 401) {
          router.replace('/platform/login');
          return;
        }
        if (!sRes.ok || !pRes.ok || !rRes.ok) {
          setError('Failed to load billing data');
          return;
        }
        setStats(await sRes.json());
        setByPlan(await pRes.json());
        setRevenue(await rRes.json());
      } catch {
        setError('Network error');
      } finally {
        setLoading(false);
      }
    };
    load();
  }, [router]);

  const chartData = [...revenue]
    .map((r) => ({
      period: r.period,
      orgs: Number(r.org_count),
    }))
    .reverse();

  const totalByPlanMrr = byPlan.reduce((sum, p) => sum + p.mrr, 0);

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">Platform Billing</h1>
        <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
          Revenue, subscriptions and churn across all organizations.
        </p>
      </div>

      {error && (
        <div className="mb-4 p-3 rounded-lg bg-red-50 border border-red-100 text-sm text-red-700">
          {error}
        </div>
      )}

      {/* Stat cards */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4 mb-6">
        <StatCard
          label="MRR"
          value={stats ? formatCurrency(stats.mrr) : '—'}
          accent="text-indigo-600"
          big
        />
        <StatCard
          label="ARR"
          value={stats ? formatCurrency(stats.arr) : '—'}
          accent="text-purple-600"
          big
        />
        <StatCard
          label="Active Subs"
          value={stats ? stats.activeOrgs : '—'}
          accent="text-green-600"
        />
        <StatCard
          label="Trialing"
          value={stats ? stats.trialOrgs : '—'}
          accent="text-blue-600"
        />
        <StatCard
          label="Past Due"
          value={stats ? stats.pastDueOrgs : '—'}
          accent="text-red-600"
        />
        <StatCard
          label="Churn Rate"
          value={stats ? `${stats.churnRate.toFixed(1)}%` : '—'}
          accent="text-orange-600"
        />
      </div>

      {/* Orgs by plan */}
      <div className="bg-white dark:bg-gray-900 rounded-xl border border-gray-100 dark:border-gray-800 shadow-sm overflow-hidden mb-6">
        <div className="px-5 py-4 border-b border-gray-100 dark:border-gray-800">
          <h2 className="font-semibold text-gray-900 dark:text-gray-100">Organizations by Plan</h2>
        </div>
        <div className="overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead>
              <tr className="bg-gray-50 dark:bg-gray-900 border-b border-gray-100 dark:border-gray-800 text-left text-xs font-semibold text-gray-400 dark:text-gray-500 uppercase tracking-wide">
                <th className="px-4 py-2.5">Plan</th>
                <th className="px-4 py-2.5">Slug</th>
                <th className="px-4 py-2.5">Active Orgs</th>
                <th className="px-4 py-2.5">Monthly Price</th>
                <th className="px-4 py-2.5">MRR Contribution</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan={5} className="px-4 py-8 text-center text-sm text-gray-400 dark:text-gray-500">
                    Loading…
                  </td>
                </tr>
              ) : byPlan.length === 0 ? (
                <tr>
                  <td colSpan={5} className="px-4 py-8 text-center text-sm text-gray-400 dark:text-gray-500">
                    No plans configured yet.
                  </td>
                </tr>
              ) : (
                <>
                  {byPlan.map((p) => (
                    <tr
                      key={p.planId}
                      className="border-b border-gray-100 dark:border-gray-800 last:border-0 hover:bg-gray-50/60"
                    >
                      <td className="px-4 py-3 font-medium text-gray-900 dark:text-gray-100">{p.planName}</td>
                      <td className="px-4 py-3 font-mono text-xs text-gray-500 dark:text-gray-400">{p.planSlug}</td>
                      <td className="px-4 py-3 text-gray-700 dark:text-gray-300">{p.count}</td>
                      <td className="px-4 py-3 text-gray-700 dark:text-gray-300">
                        {formatCurrency(p.monthlyPrice)}
                      </td>
                      <td className="px-4 py-3 font-semibold text-indigo-600">
                        {formatCurrency(p.mrr)}
                      </td>
                    </tr>
                  ))}
                  <tr className="bg-gray-50 dark:bg-gray-900 font-semibold">
                    <td className="px-4 py-3" colSpan={4}>
                      Total
                    </td>
                    <td className="px-4 py-3 text-indigo-700">
                      {formatCurrency(totalByPlanMrr)}
                    </td>
                  </tr>
                </>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Revenue chart */}
      <div className="bg-white dark:bg-gray-900 rounded-xl border border-gray-100 dark:border-gray-800 shadow-sm p-5">
        <h2 className="font-semibold text-gray-900 dark:text-gray-100 mb-4">Active Subscriptions by Month</h2>
        <div className="h-72">
          {loading ? (
            <div className="h-full flex items-center justify-center text-sm text-gray-400 dark:text-gray-500">
              Loading…
            </div>
          ) : chartData.length === 0 ? (
            <div className="h-full flex items-center justify-center text-sm text-gray-400 dark:text-gray-500">
              No revenue data yet.
            </div>
          ) : (
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={chartData}>
                <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                <XAxis dataKey="period" tick={{ fontSize: 12 }} />
                <YAxis tick={{ fontSize: 12 }} allowDecimals={false} />
                <Tooltip />
                <Bar dataKey="orgs" fill="#6366f1" radius={[6, 6, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          )}
        </div>
      </div>
    </div>
  );
}

function StatCard({
  label,
  value,
  accent,
  big,
}: {
  label: string;
  value: string | number;
  accent: string;
  big?: boolean;
}) {
  return (
    <div className="rounded-xl border border-gray-100 dark:border-gray-800 bg-white dark:bg-gray-900 shadow-sm p-5">
      <p className="text-xs font-semibold text-gray-400 dark:text-gray-500 uppercase tracking-wide mb-2">
        {label}
      </p>
      <p className={`font-bold ${accent} ${big ? 'text-2xl' : 'text-xl'}`}>{value}</p>
    </div>
  );
}
