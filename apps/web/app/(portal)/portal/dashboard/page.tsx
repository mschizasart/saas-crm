'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';

interface DashboardStats {
  openInvoices?: number;
  openTickets?: number;
  activeProjects?: number;
  user?: { name?: string; company?: string };
}

interface Announcement {
  id: string;
  title: string;
  body?: string;
  content?: string;
  message?: string;
  createdAt?: string;
  startsAt?: string;
  publishedAt?: string;
}

const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001';

function getToken(): string | null {
  if (typeof window === 'undefined') return null;
  return localStorage.getItem('access_token');
}

function formatDate(iso?: string): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleDateString();
}

export default function PortalDashboardPage() {
  const [stats, setStats] = useState<DashboardStats>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [announcements, setAnnouncements] = useState<Announcement[]>([]);

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

    // Announcements widget. The backend controller accepts audience 'staff' | 'clients';
    // the spec asked for ?audience=portal but the API has no 'portal' audience, so we
    // pass 'clients' (the portal-facing audience). Silent if endpoint isn't available.
    (async () => {
      try {
        const res = await fetch(`${API_BASE}/api/v1/announcements/active?audience=clients`, {
          headers: { Authorization: `Bearer ${getToken()}` },
        });
        if (!res.ok) return;
        const json = await res.json();
        const list: Announcement[] = json.data ?? json ?? [];
        if (Array.isArray(list)) setAnnouncements(list);
      } catch {
        // Widget is optional — swallow errors.
      }
    })();
  }, []);

  return (
    <div>
      <div className="bg-gradient-to-r from-primary to-primary/70 rounded-2xl p-8 text-white mb-8 shadow-lg">
        <h1 className="text-3xl font-bold mb-2">Welcome back{stats.user?.name ? `, ${stats.user.name}` : ''}</h1>
        <p className="text-white/90">Here's what's happening with your account.</p>
      </div>

      {announcements.length > 0 && (
        <div className="mb-6 bg-white dark:bg-gray-900 rounded-xl border border-gray-100 dark:border-gray-800 shadow-sm p-5">
          <h2 className="text-sm font-semibold text-gray-900 dark:text-gray-100 uppercase tracking-wide mb-3">Announcements</h2>
          <ul className="space-y-3">
            {announcements.map((a) => (
              <li key={a.id} className="border-l-2 border-primary pl-3">
                <div className="flex items-baseline justify-between gap-3">
                  <p className="font-medium text-gray-900 dark:text-gray-100">{a.title}</p>
                  {formatDate(a.publishedAt ?? a.startsAt ?? a.createdAt) && (
                    <span className="text-xs text-gray-400 dark:text-gray-500 whitespace-nowrap">
                      {formatDate(a.publishedAt ?? a.startsAt ?? a.createdAt)}
                    </span>
                  )}
                </div>
                {(a.body ?? a.content ?? a.message) && (
                  <p className="text-sm text-gray-600 dark:text-gray-400 mt-1">{a.body ?? a.content ?? a.message}</p>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}

      {error && <div className="mb-4 px-4 py-3 bg-red-50 border border-red-100 text-sm text-red-600 rounded-lg">{error}</div>}

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <StatCard loading={loading} label="Open Invoices" value={stats.openInvoices ?? 0} href="/portal/invoices" />
        <StatCard loading={loading} label="Open Tickets" value={stats.openTickets ?? 0} href="/portal/tickets" />
        <StatCard loading={loading} label="Active Projects" value={stats.activeProjects ?? 0} href="/portal/projects" />
      </div>
    </div>
  );
}

function StatCard({ label, value, href, loading }: { label: string; value: number; href: string; loading: boolean }) {
  return (
    <Link href={href} className="bg-white dark:bg-gray-900 rounded-xl border border-gray-100 dark:border-gray-800 shadow-sm p-6 hover:shadow-md transition-shadow block">
      <p className="text-xs text-gray-500 dark:text-gray-400 uppercase tracking-wide font-medium">{label}</p>
      {loading ? (
        <div className="h-8 w-16 bg-gray-100 dark:bg-gray-800 rounded mt-2 animate-pulse" />
      ) : (
        <p className="text-3xl font-bold text-gray-900 dark:text-gray-100 mt-2 tabular-nums">{value}</p>
      )}
      <p className="text-xs text-primary mt-2">View all →</p>
    </Link>
  );
}
