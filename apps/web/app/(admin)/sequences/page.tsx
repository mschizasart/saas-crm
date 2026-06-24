'use client';

import { useEffect, useState, useCallback } from 'react';
import Link from 'next/link';
import { ListPageLayout } from '@/components/layouts/list-page-layout';
import { Card } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/empty-state';
import { Badge, type BadgeVariant } from '@/components/ui/badge';
import { apiFetch } from '@/lib/api';
import { toast } from 'sonner';

interface Sequence {
  id: string;
  name: string;
  description: string | null;
  status: string;
  enrolledCount: number;
  activeCount: number;
  createdAt: string;
}

const STATUS_VARIANT: Record<string, BadgeVariant> = {
  draft: 'muted',
  active: 'success',
  paused: 'warning',
  archived: 'muted',
};

export default function SequencesPage() {
  const [data, setData] = useState<Sequence[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await apiFetch('/api/v1/sequences');
      if (res.ok) setData(await res.json());
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function createSequence() {
    setCreating(true);
    try {
      const res = await apiFetch('/api/v1/sequences', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'Untitled sequence' }),
      });
      if (!res.ok) {
        toast.error('Could not create sequence');
        return;
      }
      const s = await res.json();
      window.location.href = `/sequences/${s.id}`;
    } finally {
      setCreating(false);
    }
  }

  return (
    <ListPageLayout
      title="Sequences"
      subtitle="Automated multi-step email & task cadences"
      primaryAction={{
        label: creating ? 'Creating…' : 'New sequence',
        onClick: createSequence,
        disabled: creating,
      }}
    >
      {loading ? (
        <p className="text-sm text-gray-500">Loading…</p>
      ) : data.length === 0 ? (
        <Card>
          <EmptyState
            title="No sequences yet"
            description="Create a sequence to automatically follow up with leads and clients over time."
            action={{ label: 'New sequence', onClick: createSequence }}
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
                  <th className="px-4 py-3 font-medium text-right">Enrolled</th>
                  <th className="px-4 py-3 font-medium text-right">Active</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
                {data.map((s) => (
                  <tr key={s.id} className="hover:bg-gray-50 dark:hover:bg-gray-800/50">
                    <td className="px-4 py-3">
                      <Link
                        href={`/sequences/${s.id}`}
                        className="font-medium text-primary hover:underline"
                      >
                        {s.name}
                      </Link>
                      <p className="text-xs text-gray-500 dark:text-gray-400 truncate max-w-xs">
                        {s.description || 'No description'}
                      </p>
                    </td>
                    <td className="px-4 py-3">
                      <Badge variant={STATUS_VARIANT[s.status] ?? 'default'}>
                        {s.status}
                      </Badge>
                    </td>
                    <td className="px-4 py-3 text-right tabular-nums">
                      {s.enrolledCount}
                    </td>
                    <td className="px-4 py-3 text-right tabular-nums">
                      {s.activeCount}
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
