'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';

interface DashboardStats {
  openInvoices?: number;
  openTickets?: number;
  activeProjects?: number;
  user?: { name?: string; company?: string };
}

const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001';

function getToken(): string | null {
  if (typeof window === 'undefined') return null;
  return localStorage.getItem('access_token');
}

export default function PortalDashboardPage() {
  const [stats, setStats] = useState<DashboardStats>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch(`${API_BASE}/api/v1/portal/dashboard`, { headers: { Authorization: `Bearer ${getToken()}` } });
        if (!res.ok) throw new Error(`Failed (${res.status})`);
        const json = await res.json();
        setStats(json.data ?? json);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed');
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  return (
    <div>
      <div className="bg-gradient-to-r from-primary to-primary/70 rounded-2xl p-8 text-white mb-8 shadow-lg">
        <h1 className="text-3xl font-bold mb-2">Welcome back{stats.user?.name ? `, ${stats.user.name}` : ''}</h1>
        <p className="text-white/90">Here's what's happening with your account.</p>
      </div>

      {error && <div className="mb-4 px-4 py-3 bg-red-50 border border-red-100 text-sm text-red-600 rounded-lg">{error}</div>}

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <StatCard loading={loading} label="Open Invoices" value={stats.openInvoices ?? 0} href="/invoices" />
        <StatCard loading={loading} label="Open Tickets" value={stats.openTickets ?? 0} href="/tickets" />
        <StatCard loading={loading} label="Active Projects" value={stats.activeProjects ?? 0} href="/projects" />
      </div>
    </div>
  );
}

function StatCard({ label, value, href, loading }: { label: string; value: number; href: string; loading: boolean }) {
  return (
    <Link href={href} className="bg-white rounded-xl border border-gray-100 shadow-sm p-6 hover:shadow-md transition-shadow block">
      <p className="text-xs text-gray-500 uppercase tracking-wide font-medium">{label}</p>
      {loading ? (
        <div className="h-8 w-16 bg-gray-100 rounded mt-2 animate-pulse" />
      ) : (
        <p className="text-3xl font-bold text-gray-900 mt-2 tabular-nums">{value}</p>
      )}
      <p className="text-xs text-primary mt-2">View all →</p>
    </Link>
  );
}
