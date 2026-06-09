'use client';

/**
 * Approvals (Wave E1).
 *
 * Two-tab view:
 *   - "My Pending" — requests where the current step is awaiting THIS
 *     user (matched server-side against user + role assignments).
 *   - "All Requests" — every request in the org, filterable by status.
 *
 * Click-through lands on /approvals/[id] for the detail/decision view.
 */

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { ShieldCheck } from 'lucide-react';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { ErrorBanner } from '@/components/ui/error-banner';
import { apiFetch } from '@/lib/api';

type Status = 'pending' | 'approved' | 'rejected' | 'cancelled';

interface Request {
  id: string;
  processId: string;
  targetType: string;
  targetId: string;
  status: Status;
  currentStepOrder: number;
  requestedById: string;
  startedAt: string;
  completedAt: string | null;
  process?: { id: string; name: string; entityType: string };
}

interface MyPendingResponse {
  data: Request[];
  total: number;
}

interface ListResponse {
  data: Request[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

const STATUS_FILTERS: ('all' | Status)[] = [
  'all',
  'pending',
  'approved',
  'rejected',
  'cancelled',
];

const STATUS_BADGE: Record<Status, string> = {
  pending: 'bg-amber-50 text-amber-700 border-amber-200',
  approved: 'bg-green-50 text-green-700 border-green-200',
  rejected: 'bg-red-50 text-red-700 border-red-200',
  cancelled: 'bg-gray-100 text-gray-600 border-gray-200',
};

function StatusBadge({ status }: { status: Status }) {
  return (
    <span
      className={`inline-flex px-2 py-0.5 rounded text-xs border ${STATUS_BADGE[status]}`}
    >
      {status}
    </span>
  );
}

function RequestRow({ req }: { req: Request }) {
  return (
    <tr className="border-t border-gray-100 dark:border-gray-800">
      <td className="px-4 py-2">
        <Link
          href={`/approvals/${req.id}`}
          className="font-medium text-primary hover:underline"
        >
          {req.process?.name ?? req.processId}
        </Link>
      </td>
      <td className="px-4 py-2 capitalize">
        {req.process?.entityType ?? req.targetType}
      </td>
      <td className="px-4 py-2 font-mono text-xs">{req.targetId.slice(0, 8)}…</td>
      <td className="px-4 py-2">Step {req.currentStepOrder}</td>
      <td className="px-4 py-2">
        <StatusBadge status={req.status} />
      </td>
      <td className="px-4 py-2 text-xs text-gray-500">
        {new Date(req.startedAt).toLocaleDateString()}
      </td>
      <td className="px-4 py-2 text-right">
        <Link
          href={`/approvals/${req.id}`}
          className="text-xs text-gray-500 hover:text-gray-900"
        >
          View →
        </Link>
      </td>
    </tr>
  );
}

export default function ApprovalsPage() {
  const [tab, setTab] = useState<'mine' | 'all'>('mine');
  const [mine, setMine] = useState<Request[]>([]);
  const [all, setAll] = useState<Request[]>([]);
  const [statusFilter, setStatusFilter] = useState<'all' | Status>('all');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  async function loadMine() {
    const res = await apiFetch('/api/v1/approval-requests/my-pending');
    if (!res.ok) throw new Error(`Load failed: ${res.status}`);
    const data = (await res.json()) as MyPendingResponse;
    setMine(data.data ?? []);
  }

  async function loadAll() {
    const qs = new URLSearchParams({ limit: '50' });
    if (statusFilter !== 'all') qs.set('status', statusFilter);
    const res = await apiFetch(`/api/v1/approval-requests?${qs.toString()}`);
    if (!res.ok) throw new Error(`Load failed: ${res.status}`);
    const data = (await res.json()) as ListResponse;
    setAll(data.data ?? []);
  }

  async function load() {
    setLoading(true);
    setError(null);
    try {
      await Promise.all([loadMine(), loadAll()]);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    // Reload "all" when the status filter changes; "mine" is unaffected.
    if (tab === 'all') {
      loadAll().catch((err) =>
        setError(err instanceof Error ? err.message : 'Failed to load'),
      );
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [statusFilter]);

  const rows = tab === 'mine' ? mine : all;

  return (
    <div className="p-6 max-w-6xl mx-auto">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-3">
          <ShieldCheck className="w-6 h-6 text-primary" />
          <h1 className="text-2xl font-bold">Approvals</h1>
        </div>
        <Link href="/settings/approval-processes">
          <Button variant="outline">Configure processes</Button>
        </Link>
      </div>

      <div className="border-b border-gray-200 dark:border-gray-800 mb-4">
        <nav className="flex gap-4">
          <button
            onClick={() => setTab('mine')}
            className={`px-3 py-2 text-sm font-medium border-b-2 ${
              tab === 'mine'
                ? 'border-primary text-primary'
                : 'border-transparent text-gray-500 hover:text-gray-900'
            }`}
          >
            My Pending {mine.length > 0 && <span className="ml-1">({mine.length})</span>}
          </button>
          <button
            onClick={() => setTab('all')}
            className={`px-3 py-2 text-sm font-medium border-b-2 ${
              tab === 'all'
                ? 'border-primary text-primary'
                : 'border-transparent text-gray-500 hover:text-gray-900'
            }`}
          >
            All Requests
          </button>
        </nav>
      </div>

      {tab === 'all' && (
        <div className="flex gap-2 mb-3">
          {STATUS_FILTERS.map((s) => (
            <button
              key={s}
              onClick={() => setStatusFilter(s)}
              className={`px-3 py-1 text-xs rounded-full border ${
                statusFilter === s
                  ? 'bg-primary text-white border-primary'
                  : 'border-gray-200 text-gray-600 hover:bg-gray-50'
              }`}
            >
              {s}
            </button>
          ))}
        </div>
      )}

      {error && <ErrorBanner message={error} />}

      {loading ? (
        <p className="text-sm text-gray-500">Loading…</p>
      ) : rows.length === 0 ? (
        <Card className="p-8 text-center">
          <p className="text-sm text-gray-500">
            {tab === 'mine'
              ? 'No requests awaiting your decision.'
              : 'No approval requests yet.'}
          </p>
        </Card>
      ) : (
        <Card>
          <table className="w-full text-sm">
            <thead className="bg-gray-50 dark:bg-gray-800/50 text-left">
              <tr>
                <th className="px-4 py-2 font-medium">Process</th>
                <th className="px-4 py-2 font-medium">Entity</th>
                <th className="px-4 py-2 font-medium">Target</th>
                <th className="px-4 py-2 font-medium">Step</th>
                <th className="px-4 py-2 font-medium">Status</th>
                <th className="px-4 py-2 font-medium">Started</th>
                <th className="px-4 py-2"></th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <RequestRow key={r.id} req={r} />
              ))}
            </tbody>
          </table>
        </Card>
      )}
    </div>
  );
}
