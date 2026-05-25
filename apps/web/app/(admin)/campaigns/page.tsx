'use client';

import { useEffect, useState, useCallback } from 'react';
import Link from 'next/link';
import { ListPageLayout } from '@/components/layouts/list-page-layout';
import { Card } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/empty-state';
import { Badge, type BadgeVariant } from '@/components/ui/badge';
import { apiFetch } from '@/lib/api';
import { toast } from 'sonner';

interface Campaign {
  id: string;
  name: string;
  subject: string;
  status: string;
  segmentType: string;
  totalRecipients: number;
  sentCount: number;
  failedCount: number;
  openedCount?: number;
  scheduledAt: string | null;
  sentAt: string | null;
  createdAt: string;
}

const STATUS_VARIANT: Record<string, BadgeVariant> = {
  draft: 'muted',
  scheduled: 'info',
  sending: 'warning',
  sent: 'success',
  failed: 'error',
};

export default function CampaignsPage() {
  const [data, setData] = useState<Campaign[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await apiFetch('/api/v1/campaigns');
      if (res.ok) setData(await res.json());
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function createCampaign() {
    setCreating(true);
    try {
      const res = await apiFetch('/api/v1/campaigns', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'Untitled campaign' }),
      });
      if (!res.ok) {
        toast.error('Could not create campaign');
        return;
      }
      const c = await res.json();
      window.location.href = `/campaigns/${c.id}`;
    } finally {
      setCreating(false);
    }
  }

  function openRate(c: Campaign) {
    if (!c.sentCount) return '—';
    return `${Math.round(((c.openedCount ?? 0) / c.sentCount) * 100)}%`;
  }

  return (
    <ListPageLayout
      title="Campaigns"
      subtitle="Bulk email campaigns and newsletters"
      primaryAction={{
        label: creating ? 'Creating…' : 'New campaign',
        onClick: createCampaign,
        disabled: creating,
      }}
    >
      {loading ? (
        <p className="text-sm text-gray-500">Loading…</p>
      ) : data.length === 0 ? (
        <Card>
          <EmptyState
            title="No campaigns yet"
            description="Create a campaign to email a segment of your clients or leads."
            action={{ label: 'New campaign', onClick: createCampaign }}
          />
        </Card>
      ) : (
        <Card>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs uppercase text-gray-500 dark:text-gray-400 border-b border-gray-100 dark:border-gray-800">
                  <th className="px-4 py-3 font-medium">Name</th>
                  <th className="px-4 py-3 font-medium">Status</th>
                  <th className="px-4 py-3 font-medium text-right">Recipients</th>
                  <th className="px-4 py-3 font-medium text-right">Sent</th>
                  <th className="px-4 py-3 font-medium text-right">Open rate</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
                {data.map((c) => (
                  <tr key={c.id} className="hover:bg-gray-50 dark:hover:bg-gray-800/50">
                    <td className="px-4 py-3">
                      <Link
                        href={`/campaigns/${c.id}`}
                        className="font-medium text-primary hover:underline"
                      >
                        {c.name}
                      </Link>
                      <p className="text-xs text-gray-500 dark:text-gray-400 truncate max-w-xs">
                        {c.subject || 'No subject'}
                      </p>
                    </td>
                    <td className="px-4 py-3">
                      <Badge variant={STATUS_VARIANT[c.status] ?? 'neutral'}>
                        {c.status}
                      </Badge>
                    </td>
                    <td className="px-4 py-3 text-right tabular-nums">
                      {c.totalRecipients}
                    </td>
                    <td className="px-4 py-3 text-right tabular-nums">
                      {c.sentCount}
                      {c.failedCount > 0 && (
                        <span className="text-red-500"> · {c.failedCount} failed</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-right tabular-nums">{openRate(c)}</td>
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
