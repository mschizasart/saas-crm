'use client';

/**
 * Dispatch board — Wave H1 (Field Service).
 *
 * Technicians as COLUMNS, WOs as cards bucketed by their `scheduledStart`
 * date. Simple HTML table (no fancy timeline lib) — readable, printable,
 * and easy for the dispatcher to scan a week at a glance.
 *
 * Default window: today → +7 days. Date pickers let the user widen or
 * shift the view.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { ListPageLayout } from '@/components/layouts/list-page-layout';
import { ErrorBanner } from '@/components/ui/error-banner';
import { apiFetch } from '@/lib/api';

interface TechnicianLite {
  id: string;
  firstName: string;
  lastName: string;
  email: string;
}

interface BoardWorkOrder {
  id: string;
  number: string;
  status: 'draft' | 'scheduled' | 'in_progress' | 'completed' | 'cancelled';
  priority: 'low' | 'normal' | 'high' | 'urgent';
  scheduledStart: string | null;
  scheduledEnd: string | null;
  technicianId: string | null;
  client?: { id: string; company: string } | null;
}

const STATUS_COLORS: Record<string, string> = {
  draft: 'bg-gray-100 text-gray-700 border-gray-300',
  scheduled: 'bg-blue-100 text-blue-700 border-blue-300',
  in_progress: 'bg-amber-100 text-amber-800 border-amber-300',
  completed: 'bg-green-100 text-green-700 border-green-300',
  cancelled: 'bg-red-100 text-red-700 border-red-300',
};

const PRIORITY_DOTS: Record<string, string> = {
  low: 'bg-gray-400',
  normal: 'bg-blue-500',
  high: 'bg-orange-500',
  urgent: 'bg-red-500',
};

function toDateKey(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function eachDay(from: Date, to: Date): string[] {
  const days: string[] = [];
  const cursor = new Date(from);
  cursor.setHours(0, 0, 0, 0);
  const end = new Date(to);
  end.setHours(0, 0, 0, 0);
  while (cursor <= end) {
    days.push(toDateKey(cursor));
    cursor.setDate(cursor.getDate() + 1);
  }
  return days;
}

export default function DispatchPage() {
  const today = useMemo(() => new Date(), []);
  const defaultTo = useMemo(
    () => new Date(today.getTime() + 7 * 86400_000),
    [today],
  );

  const [from, setFrom] = useState<string>(toDateKey(today));
  const [to, setTo] = useState<string>(toDateKey(defaultTo));
  const [technicians, setTechnicians] = useState<TechnicianLite[]>([]);
  const [workOrders, setWorkOrders] = useState<BoardWorkOrder[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const fromIso = new Date(`${from}T00:00:00`).toISOString();
      const toIso = new Date(`${to}T23:59:59`).toISOString();
      const res = await apiFetch(
        `/api/v1/dispatch/board?from=${encodeURIComponent(
          fromIso,
        )}&to=${encodeURIComponent(toIso)}`,
      );
      if (!res.ok) throw new Error('Failed to load dispatch board');
      const data = await res.json();
      setTechnicians(data.technicians ?? []);
      setWorkOrders(data.workOrders ?? []);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Unknown error');
    } finally {
      setLoading(false);
    }
  }, [from, to]);

  useEffect(() => {
    load();
  }, [load]);

  const days = useMemo(() => {
    return eachDay(new Date(`${from}T00:00:00`), new Date(`${to}T00:00:00`));
  }, [from, to]);

  // Bucket: (day, technicianId) → WOs.
  // Unassigned WOs land in a sentinel column so the dispatcher can drag them
  // onto a real tech.
  const buckets = useMemo(() => {
    const map = new Map<string, BoardWorkOrder[]>();
    for (const wo of workOrders) {
      if (!wo.scheduledStart) continue;
      const dayKey = toDateKey(new Date(wo.scheduledStart));
      const techKey = wo.technicianId ?? '__unassigned__';
      const k = `${dayKey}|${techKey}`;
      const arr = map.get(k) ?? [];
      arr.push(wo);
      map.set(k, arr);
    }
    return map;
  }, [workOrders]);

  // Columns = unassigned (only if there's any) + all techs.
  const hasUnassigned = useMemo(
    () => workOrders.some((wo) => !wo.technicianId),
    [workOrders],
  );

  return (
    <ListPageLayout
      title="Dispatch board"
      subtitle="Technician schedule grid — see who's booked when, drop work onto open slots"
      filters={
        <div className="flex items-center gap-2">
          <label className="text-xs text-gray-500">From:</label>
          <input
            type="date"
            value={from}
            onChange={(e) => setFrom(e.target.value)}
            className="rounded border px-2 py-1 text-xs bg-transparent"
          />
          <label className="text-xs text-gray-500 ml-2">To:</label>
          <input
            type="date"
            value={to}
            onChange={(e) => setTo(e.target.value)}
            className="rounded border px-2 py-1 text-xs bg-transparent"
          />
          <Link
            href="/work-orders/new"
            className="ml-3 text-xs text-primary hover:underline"
          >
            + New work order
          </Link>
        </div>
      }
    >
      {error && <ErrorBanner message={error} />}
      {loading ? (
        <p className="text-sm text-gray-500 p-4">Loading…</p>
      ) : technicians.length === 0 ? (
        <p className="text-sm text-gray-500 p-4">
          No technicians yet. Toggle <code>isTechnician</code> on a staff
          record (Admin → Staff) to make them assignable.
        </p>
      ) : (
        <div className="overflow-x-auto">
          <table className="min-w-full text-xs border-collapse">
            <thead className="border-b">
              <tr>
                <th className="py-2 px-2 text-left font-semibold w-24">
                  Date
                </th>
                {hasUnassigned && (
                  <th className="py-2 px-2 text-left font-semibold border-l text-gray-500">
                    Unassigned
                  </th>
                )}
                {technicians.map((t) => (
                  <th
                    key={t.id}
                    className="py-2 px-2 text-left font-semibold border-l"
                  >
                    {t.firstName} {t.lastName}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {days.map((day) => (
                <tr key={day} className="border-b align-top">
                  <td className="py-2 px-2 font-mono text-[11px] text-gray-500">
                    {new Date(`${day}T00:00:00`).toLocaleDateString(undefined, {
                      weekday: 'short',
                      month: 'short',
                      day: 'numeric',
                    })}
                  </td>
                  {hasUnassigned && (
                    <td className="py-2 px-2 border-l align-top">
                      <BoardCell wos={buckets.get(`${day}|__unassigned__`)} />
                    </td>
                  )}
                  {technicians.map((t) => (
                    <td
                      key={t.id}
                      className="py-2 px-2 border-l align-top min-w-[160px]"
                    >
                      <BoardCell wos={buckets.get(`${day}|${t.id}`)} />
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </ListPageLayout>
  );

  function BoardCell({ wos }: { wos?: BoardWorkOrder[] }) {
    if (!wos || wos.length === 0) {
      return <span className="text-[10px] text-gray-300">—</span>;
    }
    return (
      <div className="space-y-1">
        {wos.map((wo) => (
          <Link
            key={wo.id}
            href={`/work-orders/${wo.id}`}
            className={`block border rounded px-2 py-1 text-[11px] ${
              STATUS_COLORS[wo.status] ?? ''
            } hover:opacity-80`}
          >
            <div className="flex items-center gap-1.5">
              <span
                className={`inline-block w-1.5 h-1.5 rounded-full ${
                  PRIORITY_DOTS[wo.priority] ?? ''
                }`}
                title={wo.priority}
              />
              <span className="font-mono">{wo.number}</span>
            </div>
            <p className="truncate">{wo.client?.company ?? '—'}</p>
            {wo.scheduledStart && (
              <p className="text-[10px] opacity-70">
                {new Date(wo.scheduledStart).toLocaleTimeString([], {
                  hour: '2-digit',
                  minute: '2-digit',
                })}
                {wo.scheduledEnd
                  ? ` – ${new Date(wo.scheduledEnd).toLocaleTimeString([], {
                      hour: '2-digit',
                      minute: '2-digit',
                    })}`
                  : ''}
              </p>
            )}
          </Link>
        ))}
      </div>
    );
  }
}
