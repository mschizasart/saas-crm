'use client';

/**
 * Quotes list — Wave F2 (CPQ).
 *
 * Status filter + paged table. Click row → detail page. "+ New Quote"
 * jumps to /quotes/new (full editor with line-items builder).
 */

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { ListPageLayout } from '@/components/layouts/list-page-layout';
import { ErrorBanner } from '@/components/ui/error-banner';
import { apiFetch } from '@/lib/api';

interface QuoteRow {
  id: string;
  number: string;
  status: 'draft' | 'sent' | 'accepted' | 'rejected' | 'expired';
  validUntil: string | null;
  total: number | string;
  currency: string;
  client?: { id: string; company: string } | null;
  createdAt: string;
}

const STATUS_COLORS: Record<string, string> = {
  draft: 'bg-gray-100 text-gray-700',
  sent: 'bg-blue-100 text-blue-700',
  accepted: 'bg-green-100 text-green-700',
  rejected: 'bg-red-100 text-red-700',
  expired: 'bg-orange-100 text-orange-700',
};

function toNum(v: number | string): number {
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) ? n : 0;
}

function formatMoney(amount: number | string, currency: string): string {
  const n = toNum(amount);
  try {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: currency || 'USD',
    }).format(n);
  } catch {
    return `${currency} ${n.toFixed(2)}`;
  }
}

export default function QuotesPage() {
  const router = useRouter();
  const [quotes, setQuotes] = useState<QuoteRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<string>('');

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      const qs = new URLSearchParams();
      qs.set('limit', '100');
      if (status) qs.set('status', status);
      const res = await apiFetch(`/api/v1/quotes?${qs.toString()}`);
      if (!res.ok) throw new Error('Failed to load quotes');
      const data = await res.json();
      setQuotes(data.data ?? []);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Unknown error');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status]);

  return (
    <ListPageLayout
      title="Quotes"
      subtitle="Salesforce-style CPQ — build, send, accept, convert to invoice"
      primaryAction={{
        label: '+ New Quote',
        onClick: () => router.push('/quotes/new'),
      }}
      filters={
        <div className="flex items-center gap-2">
          <label className="text-xs text-gray-500">Status:</label>
          <select
            value={status}
            onChange={(e) => setStatus(e.target.value)}
            className="rounded border px-2 py-1 text-xs bg-transparent"
          >
            <option value="">All</option>
            <option value="draft">Draft</option>
            <option value="sent">Sent</option>
            <option value="accepted">Accepted</option>
            <option value="rejected">Rejected</option>
            <option value="expired">Expired</option>
          </select>
        </div>
      }
    >
      {error && <ErrorBanner message={error} />}
      {loading ? (
        <p className="text-sm text-gray-500 p-4">Loading…</p>
      ) : quotes.length === 0 ? (
        <p className="text-sm text-gray-500 p-4">
          No quotes yet. Click "+ New Quote" to create one.
        </p>
      ) : (
        <div className="overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead className="border-b">
              <tr className="text-left text-xs uppercase text-gray-500">
                <th className="py-2 px-3">Number</th>
                <th className="py-2 px-3">Client</th>
                <th className="py-2 px-3">Status</th>
                <th className="py-2 px-3 text-right">Total</th>
                <th className="py-2 px-3">Valid until</th>
                <th className="py-2 px-3">Created</th>
              </tr>
            </thead>
            <tbody>
              {quotes.map((q) => (
                <tr
                  key={q.id}
                  className="border-b hover:bg-gray-50 dark:hover:bg-gray-900 cursor-pointer"
                  onClick={() => router.push(`/quotes/${q.id}`)}
                >
                  <td className="py-2 px-3 font-mono text-xs">
                    <Link
                      href={`/quotes/${q.id}`}
                      className="text-primary hover:underline"
                    >
                      {q.number}
                    </Link>
                  </td>
                  <td className="py-2 px-3">{q.client?.company ?? '—'}</td>
                  <td className="py-2 px-3">
                    <span
                      className={`text-xs px-2 py-0.5 rounded ${
                        STATUS_COLORS[q.status] ?? 'bg-gray-100 text-gray-700'
                      }`}
                    >
                      {q.status}
                    </span>
                  </td>
                  <td className="py-2 px-3 text-right">
                    {formatMoney(q.total, q.currency)}
                  </td>
                  <td className="py-2 px-3 text-xs text-gray-500">
                    {q.validUntil
                      ? new Date(q.validUntil).toLocaleDateString()
                      : '—'}
                  </td>
                  <td className="py-2 px-3 text-xs text-gray-500">
                    {new Date(q.createdAt).toLocaleDateString()}
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
