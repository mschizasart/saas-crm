'use client';

import { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';

type Status = 'all' | 'active' | 'paused' | 'cancelled';

interface Subscription {
  id: string;
  name: string;
  amount: number;
  currency: string;
  frequency: string;
  status: string;
  nextBillingDate: string | null;
  client?: { id: string; company: string } | null;
}

interface Response {
  data: Subscription[];
  meta?: { total: number };
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

export default function SubscriptionsPage() {
  const [status, setStatus] = useState<Status>('all');
  const [items, setItems] = useState<Subscription[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchItems = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      if (status !== 'all') params.set('status', status);
      const res = await fetch(`${API_BASE}/api/v1/subscriptions?${params.toString()}`, {
        headers: authHeaders(),
      });
      if (!res.ok) throw new Error(`Server responded with ${res.status}`);
      const json: Response = await res.json();
      setItems(json.data ?? (Array.isArray(json) ? json : []));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed');
    } finally {
      setLoading(false);
    }
  }, [status]);

  useEffect(() => {
    fetchItems();
  }, [fetchItems]);

  const tabs: { key: Status; label: string }[] = [
    { key: 'all', label: 'All' },
    { key: 'active', label: 'Active' },
    { key: 'paused', label: 'Paused' },
    { key: 'cancelled', label: 'Cancelled' },
  ];

  return (
    <div>
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mb-6">
        <h1 className="text-2xl font-bold text-gray-900">Subscriptions</h1>
        <Link
          href="/subscriptions/new"
          className="inline-flex items-center gap-1.5 bg-primary text-white text-sm font-medium px-4 py-2 rounded-lg hover:bg-primary/90"
        >
          <span className="text-lg leading-none">+</span>
          New Subscription
        </Link>
      </div>

      <div className="border-b border-gray-200 mb-4">
        <nav className="flex gap-1 -mb-px">
          {tabs.map((t) => (
            <button
              key={t.key}
              onClick={() => setStatus(t.key)}
              className={`px-4 py-2.5 text-sm font-medium border-b-2 transition-colors ${
                status === t.key ? 'border-primary text-primary' : 'border-transparent text-gray-500 hover:text-gray-700'
              }`}
            >
              {t.label}
            </button>
          ))}
        </nav>
      </div>

      <div className="bg-white rounded-xl border border-gray-100 shadow-sm overflow-hidden">
        {error && (
          <div className="px-4 py-3 bg-red-50 border-b border-red-100 text-sm text-red-600">
            {error} — <button className="underline" onClick={fetchItems}>retry</button>
          </div>
        )}
        <div className="overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead>
              <tr className="bg-gray-50 border-b border-gray-100 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide">
                <th className="px-4 py-3">Name</th>
                <th className="px-4 py-3">Client</th>
                <th className="px-4 py-3 text-right">Amount</th>
                <th className="px-4 py-3">Frequency</th>
                <th className="px-4 py-3">Next Billing</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3 text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={7} className="px-4 py-12 text-center text-gray-400">Loading…</td></tr>
              ) : items.length === 0 ? (
                <tr><td colSpan={7} className="px-4 py-12 text-center text-gray-400">No subscriptions found</td></tr>
              ) : (
                items.map((s) => (
                  <tr key={s.id} className="border-b border-gray-100 last:border-0 hover:bg-gray-50/60">
                    <td className="px-4 py-3 font-medium text-gray-900">
                      <Link href={`/subscriptions/${s.id}`} className="text-primary hover:underline">{s.name}</Link>
                    </td>
                    <td className="px-4 py-3 text-gray-500">{s.client?.company ?? '—'}</td>
                    <td className="px-4 py-3 text-right font-medium text-gray-900">
                      {Number(s.amount).toFixed(2)} {s.currency}
                    </td>
                    <td className="px-4 py-3 text-gray-500 capitalize">{s.frequency}</td>
                    <td className="px-4 py-3 text-gray-500">
                      {s.nextBillingDate ? new Date(s.nextBillingDate).toLocaleDateString() : '—'}
                    </td>
                    <td className="px-4 py-3"><StatusBadge status={s.status} /></td>
                    <td className="px-4 py-3 text-right">
                      <Link href={`/subscriptions/${s.id}`} className="text-xs text-gray-500 hover:text-primary">View</Link>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
