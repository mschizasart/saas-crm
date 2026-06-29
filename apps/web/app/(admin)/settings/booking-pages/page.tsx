'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { ListPageLayout } from '@/components/layouts/list-page-layout';
import { Card } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/empty-state';
import { Badge } from '@/components/ui/badge';
import { apiFetch } from '@/lib/api';
import { toast } from 'sonner';

interface BookingPage {
  id: string;
  slug: string;
  title: string;
  staffId: string;
  durationMinutes: number;
  active: boolean;
  publicUrl: string;
  staff?: { firstName?: string; lastName?: string } | null;
}

export default function BookingPagesPage() {
  const router = useRouter();
  const [data, setData] = useState<BookingPage[]>([]);
  const [staffNames, setStaffNames] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await apiFetch('/api/v1/booking-pages');
      if (res.ok) setData(await res.json());
      // Resolve staff names for the table (the list payload may not embed them).
      const staffRes = await apiFetch('/api/v1/users?limit=200');
      if (staffRes.ok) {
        const json = await staffRes.json();
        const list = Array.isArray(json) ? json : (json.data ?? []);
        const map: Record<string, string> = {};
        for (const u of list) {
          map[u.id] = [u.firstName, u.lastName].filter(Boolean).join(' ') || u.email;
        }
        setStaffNames(map);
      }
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  function staffName(p: BookingPage): string {
    if (p.staff) {
      return [p.staff.firstName, p.staff.lastName].filter(Boolean).join(' ') || '—';
    }
    return staffNames[p.staffId] ?? '—';
  }

  async function copyLink(url: string) {
    try {
      await navigator.clipboard.writeText(url);
      toast.success('Public link copied');
    } catch {
      toast.error('Could not copy link');
    }
  }

  return (
    <ListPageLayout
      title="Booking Pages"
      subtitle="Public self-service scheduling pages visitors use to book time with your team"
      primaryAction={{
        label: 'New booking page',
        onClick: () => router.push('/settings/booking-pages/new'),
      }}
    >
      {loading ? (
        <p className="text-sm text-gray-500">Loading…</p>
      ) : data.length === 0 ? (
        <Card>
          <EmptyState
            title="No booking pages yet"
            description="Create a booking page so prospects and clients can self-schedule meetings with your team."
            action={{
              label: 'New booking page',
              onClick: () => router.push('/settings/booking-pages/new'),
            }}
          />
        </Card>
      ) : (
        <Card>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs uppercase text-gray-500 dark:text-gray-400 border-b border-gray-100 dark:border-gray-800">
                  <th className="px-4 py-3 font-medium">Title</th>
                  <th className="px-4 py-3 font-medium">Staff</th>
                  <th className="px-4 py-3 font-medium text-right">Duration</th>
                  <th className="px-4 py-3 font-medium">Status</th>
                  <th className="px-4 py-3 font-medium">Public link</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
                {data.map((p) => (
                  <tr key={p.id} className="hover:bg-gray-50 dark:hover:bg-gray-800/50">
                    <td className="px-4 py-3">
                      <Link
                        href={`/settings/booking-pages/${p.id}`}
                        className="font-medium text-primary hover:underline"
                      >
                        {p.title}
                      </Link>
                      <p className="text-xs text-gray-500 dark:text-gray-400">/{p.slug}</p>
                    </td>
                    <td className="px-4 py-3 text-gray-700 dark:text-gray-300">{staffName(p)}</td>
                    <td className="px-4 py-3 text-right tabular-nums">{p.durationMinutes} min</td>
                    <td className="px-4 py-3">
                      <Badge variant={p.active ? 'success' : 'muted'}>
                        {p.active ? 'Active' : 'Inactive'}
                      </Badge>
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2">
                        <a
                          href={p.publicUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-xs text-gray-500 dark:text-gray-400 hover:text-primary truncate max-w-[220px]"
                        >
                          {p.publicUrl}
                        </a>
                        <button
                          type="button"
                          onClick={() => copyLink(p.publicUrl)}
                          className="text-xs text-primary hover:underline flex-shrink-0"
                        >
                          Copy
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}
    </ListPageLayout>
  );
}
