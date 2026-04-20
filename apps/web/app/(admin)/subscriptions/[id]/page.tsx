'use client';

import { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { DetailPageLayout } from '@/components/layouts/detail-page-layout';

interface Subscription {
  id: string;
  name: string;
  unitPrice: number;
  currency: string;
  status: string;
  createdAt: string;
  cancelledAt: string | null;
  nextDueDate: string | null;
  nextInvoiceAt?: string | null;
  interval?: string | null;
  intervalCount?: number | null;
  description: string | null;
  client?: { id: string; company: string } | null;
}

const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001';

function authHeaders(): HeadersInit {
  const token =
    typeof window === 'undefined' ? null : localStorage.getItem('access_token');
  return { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
}

const INTERVAL_OPTIONS: {
  value: string;
  label: string;
  interval: 'day' | 'week' | 'month' | 'year';
  intervalCount: number;
}[] = [
  { value: 'daily', label: 'Daily', interval: 'day', intervalCount: 1 },
  { value: 'weekly', label: 'Weekly', interval: 'week', intervalCount: 1 },
  { value: 'monthly', label: 'Monthly', interval: 'month', intervalCount: 1 },
  { value: 'quarterly', label: 'Quarterly', interval: 'month', intervalCount: 3 },
  { value: 'yearly', label: 'Yearly', interval: 'year', intervalCount: 1 },
];

function presetFrom(interval?: string | null, intervalCount?: number | null) {
  if (!interval) return 'monthly';
  const match = INTERVAL_OPTIONS.find(
    (o) => o.interval === interval && o.intervalCount === (intervalCount ?? 1),
  );
  return match?.value ?? 'monthly';
}

function StatusBadge({ status }: { status: string }) {
  const map: Record<string, string> = {
    active: 'bg-green-100 text-green-700',
    paused: 'bg-yellow-100 text-yellow-700',
    cancelled: 'bg-red-100 text-red-700',
  };
  return (
    <span
      className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium capitalize ${
        map[status] ?? 'bg-gray-100 text-gray-500'
      }`}
    >
      {status}
    </span>
  );
}

export default function SubscriptionDetailPage() {
  const params = useParams();
  const router = useRouter();
  const id = params.id as string;

  const [sub, setSub] = useState<Subscription | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [acting, setActing] = useState(false);

  const [editing, setEditing] = useState(false);
  const [editFreq, setEditFreq] = useState('monthly');
  const [editNext, setEditNext] = useState('');

  const fetchSub = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`${API_BASE}/api/v1/subscriptions/${id}`, {
        headers: authHeaders(),
      });
      if (!res.ok) throw new Error(`Server responded with ${res.status}`);
      const data: Subscription = await res.json();
      setSub(data);
      setEditFreq(presetFrom(data.interval, data.intervalCount));
      setEditNext(
        data.nextInvoiceAt
          ? new Date(data.nextInvoiceAt).toISOString().slice(0, 10)
          : data.nextDueDate
            ? new Date(data.nextDueDate).toISOString().slice(0, 10)
            : '',
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed');
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    fetchSub();
  }, [fetchSub]);

  async function action(path: string, method: string = 'POST') {
    setActing(true);
    try {
      const res = await fetch(`${API_BASE}/api/v1/subscriptions/${id}${path}`, {
        method,
        headers: authHeaders(),
      });
      if (!res.ok) throw new Error(`Failed with status ${res.status}`);
      if (method === 'DELETE') {
        router.push('/subscriptions');
        return;
      }
      fetchSub();
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Failed');
    } finally {
      setActing(false);
    }
  }

  async function saveEdit() {
    const preset = INTERVAL_OPTIONS.find((p) => p.value === editFreq);
    if (!preset) return;
    setActing(true);
    try {
      const res = await fetch(`${API_BASE}/api/v1/subscriptions/${id}`, {
        method: 'PATCH',
        headers: authHeaders(),
        body: JSON.stringify({
          interval: preset.interval,
          intervalCount: preset.intervalCount,
          nextInvoiceAt: editNext || null,
        }),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        throw new Error(j.message || `Failed ${res.status}`);
      }
      setEditing(false);
      fetchSub();
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Failed');
    } finally {
      setActing(false);
    }
  }

  if (loading)
    return (
      <div className="flex justify-center py-24 text-sm text-gray-400 dark:text-gray-500">
        Loading…
      </div>
    );

  if (error || !sub) {
    return (
      <div className="px-4 py-8 text-center">
        <p className="text-red-600 text-sm mb-3">{error ?? 'Not found'}</p>
        <button onClick={fetchSub} className="text-sm text-primary underline">
          Retry
        </button>
      </div>
    );
  }

  const currentPreset =
    INTERVAL_OPTIONS.find((p) => p.value === presetFrom(sub.interval, sub.intervalCount))
      ?.label ?? '—';

  const actions: { label: string; onClick: () => void; disabled?: boolean; variant?: 'primary' | 'secondary' }[] = [];
  if (sub.status === 'active') {
    actions.push({ label: 'Pause', onClick: () => action('/pause'), disabled: acting, variant: 'secondary' });
  }
  if (sub.status === 'paused') {
    actions.push({ label: 'Resume', onClick: () => action('/resume'), disabled: acting, variant: 'primary' });
  }
  if (sub.status !== 'cancelled') {
    actions.push({
      label: 'Cancel',
      onClick: () => { if (confirm('Cancel this subscription?')) action('/cancel'); },
      disabled: acting,
      variant: 'secondary',
    });
  }

  return (
    <DetailPageLayout
      title={sub.name}
      breadcrumbs={[
        { label: 'Subscriptions', href: '/subscriptions' },
        { label: sub.name },
      ]}
      badge={<StatusBadge status={sub.status} />}
      actions={actions}
    >
      <div className="bg-white dark:bg-gray-900 rounded-xl border border-gray-100 dark:border-gray-800 shadow-sm p-6">
        <dl className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-sm">
          <div>
            <dt className="text-xs font-semibold text-gray-400 dark:text-gray-500 uppercase">
              Client
            </dt>
            <dd className="text-gray-900 dark:text-gray-100 mt-1">
              {sub.client ? (
                <Link
                  href={`/clients/${sub.client.id}`}
                  className="text-primary hover:underline"
                >
                  {sub.client.company}
                </Link>
              ) : (
                '—'
              )}
            </dd>
          </div>
          <div>
            <dt className="text-xs font-semibold text-gray-400 dark:text-gray-500 uppercase">
              Unit Price
            </dt>
            <dd className="text-gray-900 dark:text-gray-100 mt-1">
              {Number(sub.unitPrice).toFixed(2)} {sub.currency}
            </dd>
          </div>
          <div>
            <dt className="text-xs font-semibold text-gray-400 dark:text-gray-500 uppercase">
              Frequency
            </dt>
            <dd className="text-gray-900 dark:text-gray-100 mt-1">
              {sub.interval
                ? `Every ${sub.intervalCount ?? 1} ${sub.interval}${(sub.intervalCount ?? 1) > 1 ? 's' : ''}`
                : currentPreset}
            </dd>
          </div>
          <div>
            <dt className="text-xs font-semibold text-gray-400 dark:text-gray-500 uppercase">
              Next invoice
            </dt>
            <dd className="text-gray-900 dark:text-gray-100 mt-1">
              {sub.nextInvoiceAt
                ? new Date(sub.nextInvoiceAt).toLocaleDateString()
                : sub.nextDueDate
                  ? new Date(sub.nextDueDate).toLocaleDateString()
                  : '—'}
            </dd>
          </div>
          <div>
            <dt className="text-xs font-semibold text-gray-400 dark:text-gray-500 uppercase">
              Created At
            </dt>
            <dd className="text-gray-900 dark:text-gray-100 mt-1">
              {new Date(sub.createdAt).toLocaleDateString()}
            </dd>
          </div>
          <div>
            <dt className="text-xs font-semibold text-gray-400 dark:text-gray-500 uppercase">
              Cancelled At
            </dt>
            <dd className="text-gray-900 dark:text-gray-100 mt-1">
              {sub.cancelledAt
                ? new Date(sub.cancelledAt).toLocaleDateString()
                : '—'}
            </dd>
          </div>
          {sub.description && (
            <div className="sm:col-span-2">
              <dt className="text-xs font-semibold text-gray-400 dark:text-gray-500 uppercase">
                Description
              </dt>
              <dd className="text-gray-700 dark:text-gray-300 mt-1 whitespace-pre-wrap">
                {sub.description}
              </dd>
            </div>
          )}
        </dl>

        <div className="mt-6 pt-4 border-t border-gray-100 dark:border-gray-800">
          {!editing ? (
            <button
              onClick={() => setEditing(true)}
              className="text-sm text-primary hover:underline"
            >
              Edit schedule
            </button>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">
                  Billing frequency
                </label>
                <select
                  value={editFreq}
                  onChange={(e) => setEditFreq(e.target.value)}
                  className="w-full px-3 py-2 text-sm border border-gray-200 dark:border-gray-700 rounded-lg bg-white dark:bg-gray-900"
                >
                  {INTERVAL_OPTIONS.map((o) => (
                    <option key={o.value} value={o.value}>
                      {o.label}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">
                  Next invoice at
                </label>
                <input
                  type="date"
                  value={editNext}
                  onChange={(e) => setEditNext(e.target.value)}
                  className="w-full px-3 py-2 text-sm border border-gray-200 dark:border-gray-700 rounded-lg"
                />
              </div>
              <div className="sm:col-span-2 flex gap-2">
                <button
                  onClick={saveEdit}
                  disabled={acting}
                  className="px-4 py-2 text-sm bg-primary text-white rounded-lg hover:bg-primary/90 disabled:opacity-50"
                >
                  {acting ? 'Saving…' : 'Save'}
                </button>
                <button
                  onClick={() => setEditing(false)}
                  className="px-4 py-2 text-sm border border-gray-200 dark:border-gray-700 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-800"
                >
                  Cancel
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </DetailPageLayout>
  );
}
