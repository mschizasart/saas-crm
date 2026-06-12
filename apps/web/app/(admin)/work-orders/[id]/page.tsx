'use client';

/**
 * Work Order detail — Wave H1 (Field Service).
 *
 * Read-only view of the WO header + lines + status timeline, with
 * status-aware action buttons:
 *
 *   draft       → Schedule, Cancel, Delete
 *   scheduled   → Start, Reschedule, Cancel
 *   in_progress → Complete (with optional materials replacement), Cancel
 *   completed   → (no actions)
 *   cancelled   → (no actions)
 */

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { ErrorBanner } from '@/components/ui/error-banner';
import { apiFetch } from '@/lib/api';

interface LineItem {
  id: string;
  type: 'service' | 'part';
  productId: string | null;
  description: string;
  quantity: number | string;
  unitPrice: number | string;
  lineTotal: number | string;
  order: number;
}

interface HistoryRow {
  id: string;
  fromStatus: string | null;
  toStatus: string;
  notes: string | null;
  changedAt: string;
  changedBy?: {
    id: string;
    firstName: string;
    lastName: string;
  } | null;
}

interface WorkOrder {
  id: string;
  number: string;
  status: 'draft' | 'scheduled' | 'in_progress' | 'completed' | 'cancelled';
  priority: 'low' | 'normal' | 'high' | 'urgent';
  scheduledStart: string | null;
  scheduledEnd: string | null;
  startedAt: string | null;
  completedAt: string | null;
  cancelledAt: string | null;
  locationAddress: string | null;
  description: string | null;
  completionNotes: string | null;
  technicianId: string | null;
  client: { id: string; company: string };
  opportunity: { id: string; name: string } | null;
  technician: {
    id: string;
    firstName: string;
    lastName: string;
    email: string;
  } | null;
  lineItems: LineItem[];
  statusHistory: HistoryRow[];
}

interface TechnicianLite {
  id: string;
  firstName: string;
  lastName: string;
}

function toNum(v: number | string): number {
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) ? n : 0;
}

const STATUS_COLORS: Record<string, string> = {
  draft: 'bg-gray-100 text-gray-700',
  scheduled: 'bg-blue-100 text-blue-700',
  in_progress: 'bg-amber-100 text-amber-800',
  completed: 'bg-green-100 text-green-700',
  cancelled: 'bg-red-100 text-red-700',
};

export default function WorkOrderDetailPage() {
  const router = useRouter();
  const params = useParams<{ id: string }>();
  const id = params.id;

  const [wo, setWo] = useState<WorkOrder | null>(null);
  const [technicians, setTechnicians] = useState<TechnicianLite[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // Schedule form state.
  const [showSchedule, setShowSchedule] = useState(false);
  const [schedTech, setSchedTech] = useState('');
  const [schedStart, setSchedStart] = useState('');
  const [schedEnd, setSchedEnd] = useState('');

  // Action notes (used by start / complete / cancel).
  const [actionNotes, setActionNotes] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await apiFetch(`/api/v1/work-orders/${id}`);
      if (!res.ok) throw new Error('Failed to load work order');
      const data = await res.json();
      setWo(data);
      if (data.technicianId) setSchedTech(data.technicianId);
      if (data.scheduledStart) {
        setSchedStart(
          new Date(data.scheduledStart).toISOString().slice(0, 16),
        );
      }
      if (data.scheduledEnd) {
        setSchedEnd(new Date(data.scheduledEnd).toISOString().slice(0, 16));
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Unknown error');
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    (async () => {
      try {
        const today = new Date();
        const past = new Date(today.getTime() - 30 * 86400_000).toISOString();
        const future = new Date(today.getTime() + 90 * 86400_000).toISOString();
        const res = await apiFetch(
          `/api/v1/dispatch/board?from=${past}&to=${future}`,
        );
        if (res.ok) {
          const data = await res.json();
          setTechnicians(data.technicians ?? []);
        }
      } catch {
        /* silent */
      }
    })();
  }, []);

  const doAction = async (
    path: string,
    method: 'POST' | 'DELETE' = 'POST',
    body?: Record<string, unknown>,
  ) => {
    setBusy(true);
    setError(null);
    try {
      const res = await apiFetch(`/api/v1/work-orders/${id}${path}`, {
        method,
        headers: body
          ? { 'Content-Type': 'application/json' }
          : undefined,
        body: body ? JSON.stringify(body) : undefined,
      });
      if (!res.ok && res.status !== 204) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.message || 'Action failed');
      }
      if (path === '' && method === 'DELETE') {
        router.push('/work-orders');
        return;
      }
      await load();
      setActionNotes('');
      setShowSchedule(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Unknown error');
    } finally {
      setBusy(false);
    }
  };

  const submitSchedule = async () => {
    if (!schedTech || !schedStart || !schedEnd) {
      setError('Pick a technician + start + end');
      return;
    }
    await doAction('/schedule', 'POST', {
      technicianId: schedTech,
      scheduledStart: new Date(schedStart).toISOString(),
      scheduledEnd: new Date(schedEnd).toISOString(),
    });
  };

  if (loading) {
    return <p className="p-6 text-sm text-gray-500">Loading…</p>;
  }
  if (error && !wo) {
    return (
      <div className="p-6 space-y-4">
        <ErrorBanner message={error} />
        <Link href="/work-orders" className="text-sm text-primary">
          ← Back to work orders
        </Link>
      </div>
    );
  }
  if (!wo) return null;

  const subtotal = wo.lineItems.reduce(
    (acc, li) => acc + toNum(li.lineTotal),
    0,
  );

  return (
    <div className="max-w-6xl mx-auto p-6 space-y-6">
      <div className="flex items-start justify-between">
        <div>
          <p className="text-xs text-gray-500 font-mono">{wo.number}</p>
          <h1 className="text-xl font-semibold mt-1">
            {wo.client?.company ?? 'Work order'}
          </h1>
          <div className="mt-2 flex items-center gap-2">
            <span
              className={`text-xs px-2 py-0.5 rounded ${
                STATUS_COLORS[wo.status] ?? ''
              }`}
            >
              {wo.status.replace('_', ' ')}
            </span>
            <span className="text-xs text-gray-500">priority: {wo.priority}</span>
          </div>
        </div>
        <Link href="/work-orders" className="text-sm text-primary">
          ← Back
        </Link>
      </div>

      {error && <ErrorBanner message={error} />}

      {/* Header details + action panel */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="md:col-span-2 border rounded p-4 space-y-3">
          <div className="grid grid-cols-2 gap-3 text-sm">
            <div>
              <p className="text-[10px] uppercase text-gray-500">Client</p>
              <p>{wo.client?.company ?? '—'}</p>
            </div>
            <div>
              <p className="text-[10px] uppercase text-gray-500">Opportunity</p>
              <p>{wo.opportunity?.name ?? '—'}</p>
            </div>
            <div>
              <p className="text-[10px] uppercase text-gray-500">Technician</p>
              <p>
                {wo.technician
                  ? `${wo.technician.firstName} ${wo.technician.lastName}`
                  : 'Unassigned'}
              </p>
            </div>
            <div>
              <p className="text-[10px] uppercase text-gray-500">Site</p>
              <p>{wo.locationAddress ?? '—'}</p>
            </div>
            <div>
              <p className="text-[10px] uppercase text-gray-500">
                Scheduled start
              </p>
              <p>
                {wo.scheduledStart
                  ? new Date(wo.scheduledStart).toLocaleString()
                  : '—'}
              </p>
            </div>
            <div>
              <p className="text-[10px] uppercase text-gray-500">
                Scheduled end
              </p>
              <p>
                {wo.scheduledEnd
                  ? new Date(wo.scheduledEnd).toLocaleString()
                  : '—'}
              </p>
            </div>
          </div>
          {wo.description && (
            <div>
              <p className="text-[10px] uppercase text-gray-500">Scope</p>
              <p className="text-sm whitespace-pre-wrap">{wo.description}</p>
            </div>
          )}
          {wo.completionNotes && (
            <div>
              <p className="text-[10px] uppercase text-gray-500">
                Completion notes
              </p>
              <p className="text-sm whitespace-pre-wrap">
                {wo.completionNotes}
              </p>
            </div>
          )}
        </div>

        {/* Action panel */}
        <div className="border rounded p-4 space-y-3 bg-gray-50 dark:bg-gray-900">
          <h3 className="text-sm font-semibold">Actions</h3>

          {(wo.status === 'draft' || wo.status === 'scheduled') && (
            <Button
              onClick={() => setShowSchedule((v) => !v)}
              disabled={busy}
              className="w-full"
            >
              {wo.status === 'scheduled' ? 'Reschedule' : 'Schedule'}
            </Button>
          )}
          {wo.status === 'scheduled' && (
            <Button
              onClick={() =>
                doAction('/start', 'POST', {
                  notes: actionNotes || undefined,
                })
              }
              disabled={busy}
              className="w-full"
            >
              Start (technician on site)
            </Button>
          )}
          {wo.status === 'in_progress' && (
            <Button
              onClick={() =>
                doAction('/complete', 'POST', {
                  notes: actionNotes || undefined,
                })
              }
              disabled={busy}
              className="w-full"
            >
              Complete
            </Button>
          )}
          {wo.status !== 'completed' && wo.status !== 'cancelled' && (
            <Button
              variant="secondary"
              onClick={() =>
                doAction('/cancel', 'POST', {
                  notes: actionNotes || undefined,
                })
              }
              disabled={busy}
              className="w-full"
            >
              Cancel
            </Button>
          )}
          {wo.status === 'draft' && (
            <Button
              variant="secondary"
              onClick={() => {
                if (
                  confirm(
                    'Delete this DRAFT work order? Anything else: cancel instead.',
                  )
                ) {
                  doAction('', 'DELETE');
                }
              }}
              disabled={busy}
              className="w-full text-red-600"
            >
              Delete
            </Button>
          )}

          {(wo.status === 'scheduled' || wo.status === 'in_progress') && (
            <div>
              <label className="block text-xs font-medium mb-1">
                Action notes (optional)
              </label>
              <textarea
                value={actionNotes}
                onChange={(e) => setActionNotes(e.target.value)}
                rows={2}
                placeholder="e.g. arrived 15 min early; replaced filter, recharged refrigerant"
                className="w-full rounded border px-2 py-1.5 text-xs bg-transparent"
              />
            </div>
          )}
        </div>
      </div>

      {/* Schedule form */}
      {showSchedule && (
        <div className="border rounded p-4 space-y-3 bg-blue-50 dark:bg-blue-950">
          <h3 className="text-sm font-semibold">Schedule</h3>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <div>
              <label className="block text-xs font-medium mb-1">
                Technician
              </label>
              <select
                value={schedTech}
                onChange={(e) => setSchedTech(e.target.value)}
                className="w-full rounded border px-2 py-1.5 text-sm bg-transparent"
              >
                <option value="">Select…</option>
                {technicians.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.firstName} {t.lastName}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium mb-1">Start</label>
              <input
                type="datetime-local"
                value={schedStart}
                onChange={(e) => setSchedStart(e.target.value)}
                className="w-full rounded border px-2 py-1.5 text-sm bg-transparent"
              />
            </div>
            <div>
              <label className="block text-xs font-medium mb-1">End</label>
              <input
                type="datetime-local"
                value={schedEnd}
                onChange={(e) => setSchedEnd(e.target.value)}
                className="w-full rounded border px-2 py-1.5 text-sm bg-transparent"
              />
            </div>
          </div>
          <div className="flex gap-2">
            <Button onClick={submitSchedule} disabled={busy}>
              {busy ? 'Saving…' : 'Save schedule'}
            </Button>
            <Button
              variant="secondary"
              onClick={() => setShowSchedule(false)}
              disabled={busy}
            >
              Cancel
            </Button>
          </div>
        </div>
      )}

      {/* Line items */}
      <div className="border rounded p-4">
        <h3 className="text-sm font-semibold mb-2">Line items</h3>
        {wo.lineItems.length === 0 ? (
          <p className="text-xs text-gray-500">No lines yet.</p>
        ) : (
          <table className="min-w-full text-sm">
            <thead className="border-b">
              <tr className="text-left text-xs uppercase text-gray-500">
                <th className="py-1 px-2">Type</th>
                <th className="py-1 px-2">Description</th>
                <th className="py-1 px-2 text-right">Qty</th>
                <th className="py-1 px-2 text-right">Price</th>
                <th className="py-1 px-2 text-right">Line total</th>
              </tr>
            </thead>
            <tbody>
              {wo.lineItems.map((li) => (
                <tr key={li.id} className="border-b">
                  <td className="py-1 px-2 text-xs">{li.type}</td>
                  <td className="py-1 px-2">{li.description}</td>
                  <td className="py-1 px-2 text-right font-mono">
                    {toNum(li.quantity).toFixed(2)}
                  </td>
                  <td className="py-1 px-2 text-right font-mono">
                    {toNum(li.unitPrice).toFixed(2)}
                  </td>
                  <td className="py-1 px-2 text-right font-mono">
                    {toNum(li.lineTotal).toFixed(2)}
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr>
                <td colSpan={4} className="py-2 px-2 text-right text-sm">
                  Subtotal
                </td>
                <td className="py-2 px-2 text-right font-mono font-semibold">
                  {subtotal.toFixed(2)}
                </td>
              </tr>
            </tfoot>
          </table>
        )}
      </div>

      {/* Status timeline */}
      <div className="border rounded p-4">
        <h3 className="text-sm font-semibold mb-3">Status timeline</h3>
        <ul className="space-y-2">
          {wo.statusHistory.map((h) => (
            <li
              key={h.id}
              className="flex items-start gap-3 text-sm border-l-2 border-gray-200 pl-3 py-1"
            >
              <div className="flex-1">
                <p>
                  <span className="text-xs text-gray-500">
                    {h.fromStatus ? `${h.fromStatus} → ` : ''}
                  </span>
                  <span
                    className={`text-xs px-2 py-0.5 rounded ${
                      STATUS_COLORS[h.toStatus] ?? ''
                    }`}
                  >
                    {h.toStatus.replace('_', ' ')}
                  </span>
                </p>
                {h.notes && (
                  <p className="text-xs text-gray-600 mt-1">{h.notes}</p>
                )}
                <p className="text-[10px] text-gray-400 mt-1">
                  {h.changedBy
                    ? `${h.changedBy.firstName} ${h.changedBy.lastName}`
                    : '—'}{' '}
                  · {new Date(h.changedAt).toLocaleString()}
                </p>
              </div>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
