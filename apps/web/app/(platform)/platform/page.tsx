'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';

const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001';

interface PlatformStats {
  totalOrgs: number;
  trialingOrgs: number;
  activeOrgs: number;
  suspendedOrgs: number;
  totalUsers: number;
  totalClients: number;
  totalInvoices: number;
  newOrgsThisMonth: number;
}

interface RecentOrg {
  id: string;
  name: string;
  slug: string;
  status: string;
  userCount: number;
  clientCount: number;
  createdAt: string;
}

const STATUS_BADGE: Record<string, string> = {
  trialing: 'bg-blue-100 text-blue-700',
  active: 'bg-green-100 text-green-700',
  suspended: 'bg-orange-100 text-orange-700',
  cancelled: 'bg-red-100 text-red-700',
  past_due: 'bg-red-100 text-red-700',
};

function StatusBadge({ status }: { status: string }) {
  return (
    <span
      className={`inline-flex px-2 py-1 rounded-full text-xs font-medium ${
        STATUS_BADGE[status] ?? 'bg-gray-100 text-gray-600'
      }`}
    >
      {status}
    </span>
  );
}

function StatCard({
  label,
  value,
  accent,
  loading,
}: {
  label: string;
  value: number | string;
  accent: string;
  loading: boolean;
}) {
  return (
    <div className="rounded-xl border border-gray-100 bg-white shadow-sm p-5">
      <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-2">{label}</p>
      {loading ? (
        <div className="h-7 w-16 bg-gray-100 animate-pulse rounded" />
      ) : (
        <p className={`text-2xl font-bold ${accent}`}>{value}</p>
      )}
    </div>
  );
}

export default function PlatformDashboardPage() {
  const router = useRouter();
  const [stats, setStats] = useState<PlatformStats | null>(null);
  const [recent, setRecent] = useState<RecentOrg[]>([]);
  const [loadingStats, setLoadingStats] = useState(true);
  const [loadingRecent, setLoadingRecent] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const token = typeof window !== 'undefined' ? localStorage.getItem('platform_token') : null;
    if (!token) {
      router.replace('/platform/login');
      return;
    }
    const headers = { Authorization: `Bearer ${token}` };

    fetch(`${API_BASE}/api/v1/platform/stats`, { headers })
      .then(async (res) => {
        if (res.status === 401) {
          router.replace('/platform/login');
          return;
        }
        if (!res.ok) {
          setError('Failed to load stats');
          return;
        }
        setStats(await res.json());
      })
      .catch(() => setError('Network error'))
      .finally(() => setLoadingStats(false));

    fetch(`${API_BASE}/api/v1/platform/recent-organizations?limit=10`, { headers })
      .then(async (res) => {
        if (!res.ok) return;
        const data = await res.json();
        setRecent(data.data ?? data ?? []);
      })
      .catch(() => {})
      .finally(() => setLoadingRecent(false));
  }, [router]);

  const cards = [
    { label: 'Total Orgs', value: stats?.totalOrgs ?? 0, accent: 'text-gray-900' },
    { label: 'Trialing', value: stats?.trialingOrgs ?? 0, accent: 'text-blue-600' },
    { label: 'Active', value: stats?.activeOrgs ?? 0, accent: 'text-green-600' },
    { label: 'Suspended', value: stats?.suspendedOrgs ?? 0, accent: 'text-orange-600' },
    { label: 'Total Users', value: stats?.totalUsers ?? 0, accent: 'text-indigo-600' },
    { label: 'Total Clients', value: stats?.totalClients ?? 0, accent: 'text-purple-600' },
    { label: 'Total Invoices', value: stats?.totalInvoices ?? 0, accent: 'text-amber-600' },
    { label: 'New This Month', value: stats?.newOrgsThisMonth ?? 0, accent: 'text-emerald-600' },
  ];

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900">Platform Dashboard</h1>
        <p className="text-sm text-gray-500 mt-1">Overview of all organizations on the platform.</p>
      </div>

      {error && (
        <div className="mb-4 p-3 rounded-lg bg-red-50 border border-red-100 text-sm text-red-700">
          {error}
        </div>
      )}

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8">
        {cards.map((c) => (
          <StatCard key={c.label} label={c.label} value={c.value} accent={c.accent} loading={loadingStats} />
        ))}
      </div>

      <div className="bg-white rounded-xl border border-gray-100 shadow-sm overflow-hidden">
        <div className="px-5 py-4 border-b border-gray-100 flex items-center justify-between">
          <h2 className="font-semibold text-gray-900">Recent Organizations</h2>
          <Link href="/platform/organizations" className="text-xs font-medium text-indigo-600 hover:underline">
            View all →
          </Link>
        </div>
        <div className="overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead>
              <tr className="bg-gray-50 border-b border-gray-100 text-left text-xs font-semibold text-gray-400 uppercase tracking-wide">
                <th className="px-4 py-2.5">Name</th>
                <th className="px-4 py-2.5">Slug</th>
                <th className="px-4 py-2.5">Status</th>
                <th className="px-4 py-2.5 text-right">Users</th>
                <th className="px-4 py-2.5 text-right">Clients</th>
                <th className="px-4 py-2.5">Created</th>
              </tr>
            </thead>
            <tbody>
              {loadingRecent ? (
                Array.from({ length: 5 }).map((_, i) => (
                  <tr key={i} className="border-b border-gray-100 last:border-0">
                    {Array.from({ length: 6 }).map((__, j) => (
                      <td key={j} className="px-4 py-3">
                        <div className="h-4 bg-gray-100 rounded animate-pulse" />
                      </td>
                    ))}
                  </tr>
                ))
              ) : recent.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-4 py-8 text-center text-sm text-gray-400">
                    No organizations yet.
                  </td>
                </tr>
              ) : (
                recent.map((org) => (
                  <tr
                    key={org.id}
                    onClick={() => router.push(`/platform/organizations/${org.id}`)}
                    className="border-b border-gray-100 last:border-0 hover:bg-gray-50/60 transition-colors cursor-pointer"
                  >
                    <td className="px-4 py-3 font-medium text-gray-900">{org.name}</td>
                    <td className="px-4 py-3 text-gray-500">{org.slug}</td>
                    <td className="px-4 py-3">
                      <StatusBadge status={org.status} />
                    </td>
                    <td className="px-4 py-3 text-right text-gray-700">{org.userCount}</td>
                    <td className="px-4 py-3 text-right text-gray-700">{org.clientCount}</td>
                    <td className="px-4 py-3 text-gray-500">
                      {new Date(org.createdAt).toLocaleDateString()}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
