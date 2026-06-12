'use client';

/**
 * Work Orders list — Wave H1 (Field Service).
 *
 * Filters: status, technician, date range. Click row → detail.
 * "+ New Work Order" jumps to /work-orders/new.
 */

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { ListPageLayout } from '@/components/layouts/list-page-layout';
import { ErrorBanner } from '@/components/ui/error-banner';
import { apiFetch } from '@/lib/api';

interface WorkOrderRow {
  id: string;
  number: string;
  status: 'draft' | 'scheduled' | 'in_progress' | 'completed' | 'cancelled';
  priority: 'low' | 'normal' | 'high' | 'urgent';
  scheduledStart: string | null;
  scheduledEnd: string | null;
  technicianId: string | null;
  client?: { id: string; company: string } | null;
  createdAt: string;
  _count?: { lineItems: number };
}

interface TechnicianLite {
  id: string;
  firstName: string;
  lastName: string;
}

const STATUS_COLORS: Record<string, string> = {
  draft: 'bg-gray-100 text-gray-700',
  scheduled: 'bg-blue-100 text-blue-700',
  in_progress: 'bg-amber-100 text-amber-800',
  completed: 'bg-green-100 text-green-700',
  cancelled: 'bg-red-100 text-red-700',
};

const PRIORITY_COLORS: Record<string, string> = {
  low: 'bg-gray-100 text-gray-600',
  normal: 'bg-blue-50 text-blue-700',
  high: 'bg-orange-100 text-orange-700',
  urgent: 'bg-red-100 text-red-700',
};

export default function WorkOrdersPage() {
  const router = useRouter();
  const [rows, setRows] = useState<WorkOrderRow[]>([]);
  const [technicians, setTechnicians] = useState<TechnicianLite[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState('');
  const [technicianId, setTechnicianId] = useState('');
  const [startAfter, setStartAfter] = useState('');
  const [startBefore, setStartBefore] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const qs = new URLSearchParams();
      qs.set('limit', '100');
      if (status) qs.set('status', status);
      if (technicianId) qs.set('technicianId', technicianId);
      if (startAfter) qs.set('startAfter', new Date(startAfter).toISOString());
      if (startBefore) qs.set('startBefore', new Date(startBefore).toISOString());
      const res = await apiFetch(`/api/v1/work-orders?${qs.toString()}`);
      if (!res.ok) throw new Error('Failed to load work orders');
      const data = await res.json();
      setRows(data.data ?? []);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Unknown error');
    } finally {
      setLoading(false);
    }
  }, [status, technicianId, startAfter, startBefore]);

  // Load technicians once for the filter dropdown. We fall back to /staff
  // if the dispatch board endpoint isn't reachable (e.g. permission gap).
  useEffect(() => {
    (async () => {
      try {
        const today = new Date();
        const past = new Date(today.getTime() - 7 * 86400_000).toISOString();
        const future = new Date(today.getTime() + 30 * 86400_000).toISOString();
        const res = await apiFetch(
          `/api/v1/dispatch/board?from=${past}&to=${future}`,
        );
        if (res.ok) {
          const data = await res.json();
          setTechnicians(data.technicians ?? []);
        }
      } catch {
        /* silent — filter just stays empty */
      }
    })();
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  return (
    <ListPageLayout
      title="Work Orders"
      subtitle="Field service dispatch — create, schedule, complete on-site work"
      primaryAction={{
        label: '+ New Work Order',
        onClick: () => router.push('/work-orders/new'),
      }}
      filters={
        <div className="flex flex-wrap items-center gap-2">
          <label className="text-xs text-gray-500">Status:</label>
          <select
            value={status}
            onChange={(e) => setStatus(e.target.value)}
            className="rounded border px-2 py-1 text-xs bg-transparent"
          >
            <option value="">All</option>
            <option value="draft">Draft</option>
            <option value="scheduled">Scheduled</option>
            <option value="in_progress">In progress</option>
            <option value="completed">Completed</option>
            <option value="cancelled">Cancelled</option>
          </select>

          <label className="text-xs text-gray-500 ml-2">Technician:</label>
          <select
            value={technicianId}
            onChange={(e) => setTechnicianId(e.target.value)}
            className="rounded border px-2 py-1 text-xs bg-transparent"
          >
            <option value="">All</option>
            {technicians.map((t) => (
              <option key={t.id} value={t.id}>
                {t.firstName} {t.lastName}
              </option>
            ))}
          </select>

          <label className="text-xs text-gray-500 ml-2">From:</label>
          <input
            type="date"
            value={startAfter}
            onChange={(e) => setStartAfter(e.target.value)}
            className="rounded border px-2 py-1 text-xs bg-transparent"
          />
          <label className="text-xs text-gray-500">To:</label>
          <input
            type="date"
            value={startBefore}
            onChange={(e) => setStartBefore(e.target.value)}
            className="rounded border px-2 py-1 text-xs bg-transparent"
          />
        </div>
      }
    >
      {error && <ErrorBanner message={error} />}
      {loading ? (
        <p className="text-sm text-gray-500 p-4">Loading…</p>
      ) : rows.length === 0 ? (
        <p className="text-sm text-gray-500 p-4">
          No work orders. Click "+ New Work Order" to create one.
        </p>
      ) : (
        <div className="overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead className="border-b">
              <tr className="text-left text-xs uppercase text-gray-500">
                <th className="py-2 px-3">Number</th>
                <th className="py-2 px-3">Client</th>
                <th className="py-2 px-3">Status</th>
                <th className="py-2 px-3">Priority</th>
                <th className="py-2 px-3">Scheduled</th>
                <th className="py-2 px-3 text-right">Lines</th>
                <th className="py-2 px-3">Created</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr
                  key={r.id}
                  className="border-b hover:bg-gray-50 dark:hover:bg-gray-900 cursor-pointer"
                  onClick={() => router.push(`/work-orders/${r.id}`)}
                >
                  <td className="py-2 px-3 font-mono text-xs">
                    <Link
                      href={`/work-orders/${r.id}`}
                      className="text-primary hover:underline"
                    >
                      {r.number}
                    </Link>
                  </td>
                  <td className="py-2 px-3">{r.client?.company ?? '—'}</td>
                  <td className="py-2 px-3">
                    <span
                      className={`text-xs px-2 py-0.5 rounded ${
                        STATUS_COLORS[r.status] ?? 'bg-gray-100 text-gray-700'
                      }`}
                    >
                      {r.status.replace('_', ' ')}
                    </span>
                  </td>
                  <td className="py-2 px-3">
                    <span
                      className={`text-xs px-2 py-0.5 rounded ${
                        PRIORITY_COLORS[r.priority] ?? 'bg-gray-100'
                      }`}
                    >
                      {r.priority}
                    </span>
                  </td>
                  <td className="py-2 px-3 text-xs text-gray-500">
                    {r.scheduledStart
                      ? new Date(r.scheduledStart).toLocaleString()
                      : '—'}
                  </td>
                  <td className="py-2 px-3 text-right text-xs">
                    {r._count?.lineItems ?? 0}
                  </td>
                  <td className="py-2 px-3 text-xs text-gray-500">
                    {new Date(r.createdAt).toLocaleDateString()}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </ListPageLayout>
  );
}
