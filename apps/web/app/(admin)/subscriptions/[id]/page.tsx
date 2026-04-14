'use client';

import { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';

interface Subscription {
  id: string;
  name: string;
  amount: number;
  currency: string;
  frequency: string;
  status: string;
  startDate: string;
  endDate: string | null;
  nextBillingDate: string | null;
  description: string | null;
  client?: { id: string; company: string } | null;
}

const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001';

function authHeaders(): HeadersInit {
  const token = typeof window === 'undefined' ? null : localStorage.getItem('access_token');
  return { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
}

function StatusBadge({ status }: { status: string }) {
  const map: Record<string, string> = {
    active: 'bg-green-100 text-green-700',
    paused: 'bg-yellow-100 text-yellow-700',
    cancelled: 'bg-red-100 text-red-700',
  };
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium capitalize ${map[status] ?? 'bg-gray-100 text-gray-500'}`}>
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

  const fetchSub = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`${API_BASE}/api/v1/subscriptions/${id}`, { headers: authHeaders() });
      if (!res.ok) throw new Error(`Server responded with ${res.status}`);
      setSub(await res.json());
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

  if (loading) return <div className="flex justify-center py-24 text-sm text-gray-400">Loading…</div>;

  if (error || !sub) {
    return (
      <div className="px-4 py-8 text-center">
        <p className="text-red-600 text-sm mb-3">{error ?? 'Not found'}</p>
        <button onClick={fetchSub} className="text-sm text-primary underline">Retry</button>
      </div>
    );
  }

  return (
    <div className="max-w-4xl mx-auto">
      <div className="flex items-center gap-2 mb-6 text-sm text-gray-500">
        <Link href="/subscriptions" className="hover:text-primary">Subscriptions</Link>
        <span>/</span>
        <span className="text-gray-900 font-medium">{sub.name}</span>
      </div>

      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mb-6">
        <div className="flex items-center gap-3">
          <h1 className="text-2xl font-bold text-gray-900">{sub.name}</h1>
          <StatusBadge status={sub.status} />
        </div>
        <div className="flex gap-2">
          {sub.status === 'active' && (
            <button
              onClick={() => action('/pause')}
              disabled={acting}
              className="px-4 py-2 text-sm font-medium border border-gray-200 rounded-lg hover:bg-gray-50 disabled:opacity-50"
            >
              Pause
            </button>
          )}
          {sub.status === 'paused' && (
            <button
              onClick={() => action('/resume')}
              disabled={acting}
              className="px-4 py-2 text-sm font-medium bg-primary text-white rounded-lg hover:bg-primary/90 disabled:opacity-50"
            >
              Resume
            </button>
          )}
          {sub.status !== 'cancelled' && (
            <button
              onClick={() => confirm('Cancel this subscription?') && action('/cancel')}
              disabled={acting}
              className="px-4 py-2 text-sm font-medium border border-red-200 text-red-600 rounded-lg hover:bg-red-50 disabled:opacity-50"
            >
              Cancel
            </button>
          )}
        </div>
      </div>

      <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-6">
        <dl className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-sm">
          <div>
            <dt className="text-xs font-semibold text-gray-400 uppercase">Client</dt>
            <dd className="text-gray-900 mt-1">
              {sub.client ? (
                <Link href={`/clients/${sub.client.id}`} className="text-primary hover:underline">
                  {sub.client.company}
                </Link>
              ) : '—'}
            </dd>
          </div>
          <div>
            <dt className="text-xs font-semibold text-gray-400 uppercase">Amount</dt>
            <dd className="text-gray-900 mt-1">{Number(sub.amount).toFixed(2)} {sub.currency}</dd>
          </div>
          <div>
            <dt className="text-xs font-semibold text-gray-400 uppercase">Frequency</dt>
            <dd className="text-gray-900 mt-1 capitalize">{sub.frequency}</dd>
          </div>
          <div>
            <dt className="text-xs font-semibold text-gray-400 uppercase">Next Billing</dt>
            <dd className="text-gray-900 mt-1">
              {sub.nextBillingDate ? new Date(sub.nextBillingDate).toLocaleDateString() : '—'}
            </dd>
          </div>
          <div>
            <dt className="text-xs font-semibold text-gray-400 uppercase">Start Date</dt>
            <dd className="text-gray-900 mt-1">{new Date(sub.startDate).toLocaleDateString()}</dd>
          </div>
          <div>
            <dt className="text-xs font-semibold text-gray-400 uppercase">End Date</dt>
            <dd className="text-gray-900 mt-1">
              {sub.endDate ? new Date(sub.endDate).toLocaleDateString() : '—'}
            </dd>
          </div>
          {sub.description && (
            <div className="sm:col-span-2">
              <dt className="text-xs font-semibold text-gray-400 uppercase">Description</dt>
              <dd className="text-gray-700 mt-1 whitespace-pre-wrap">{sub.description}</dd>
            </div>
          )}
        </dl>
      </div>
    </div>
  );
}
