'use client';

export const dynamic = 'force-dynamic';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';

const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001';

interface CreditNote {
  id: string;
  number?: string;
  date?: string;
  createdAt?: string;
  reference?: string | null;
  invoice?: { id?: string; number?: string } | null;
  total: number | string;
  currency?: string;
  status?: string;
}

function getToken(): string | null {
  if (typeof window === 'undefined') return null;
  return localStorage.getItem('access_token');
}

function toNumber(v: number | string | undefined | null): number {
  if (v == null) return 0;
  return typeof v === 'number' ? v : Number(v) || 0;
}

function formatMoney(n: number): string {
  return n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function formatDate(iso?: string): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString();
}

const STATUS_COLORS: Record<string, string> = {
  draft: 'bg-gray-100 text-gray-700',
  issued: 'bg-blue-100 text-blue-700',
  applied: 'bg-green-100 text-green-700',
  void: 'bg-red-100 text-red-700',
  voided: 'bg-red-100 text-red-700',
};

export default function PortalCreditNotesPage() {
  const router = useRouter();

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [items, setItems] = useState<CreditNote[]>([]);
  const [noClient, setNoClient] = useState(false);

  useEffect(() => {
    const token = getToken();
    if (!token) {
      router.push('/portal/login');
      return;
    }

    (async () => {
      try {
        const meRes = await fetch(`${API_BASE}/api/v1/auth/me`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (meRes.status === 401) {
          router.push('/portal/login');
          return;
        }
        if (!meRes.ok) throw new Error(`Failed to load account (${meRes.status})`);
        const meJson = await meRes.json();
        const me = meJson.data ?? meJson;
        const clientId: string | null = me.clientId ?? me.client?.id ?? null;
        if (!clientId) {
          setNoClient(true);
          setLoading(false);
          return;
        }

        const res = await fetch(
          `${API_BASE}/api/v1/credit-notes?clientId=${encodeURIComponent(clientId)}&limit=100`,
          { headers: { Authorization: `Bearer ${token}` } },
        );
        if (res.status === 403) {
          setError('Credit notes are not visible to portal users on this workspace.');
          setLoading(false);
          return;
        }
        if (!res.ok) throw new Error(`Failed to load credit notes (${res.status})`);
        const json = await res.json();
        const list: CreditNote[] = json.data ?? json.items ?? json ?? [];
        const arr = Array.isArray(list) ? list : [];
        arr.sort((a, b) => {
          const da = new Date(a.date ?? a.createdAt ?? 0).getTime();
          const db = new Date(b.date ?? b.createdAt ?? 0).getTime();
          return db - da;
        });
        setItems(arr);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load credit notes');
      } finally {
        setLoading(false);
      }
    })();
  }, [router]);

  if (loading) {
    return (
      <div>
        <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100 mb-6">Credit Notes</h1>
        <div className="bg-white dark:bg-gray-900 rounded-xl border border-gray-100 dark:border-gray-800 shadow-sm p-6">
          <div className="animate-pulse space-y-3">
            <div className="h-4 w-64 bg-gray-100 dark:bg-gray-800 rounded" />
            <div className="h-4 w-full bg-gray-100 dark:bg-gray-800 rounded" />
            <div className="h-4 w-full bg-gray-100 dark:bg-gray-800 rounded" />
            <div className="h-4 w-5/6 bg-gray-100 dark:bg-gray-800 rounded" />
          </div>
        </div>
      </div>
    );
  }

  if (noClient) {
    return (
      <div>
        <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100 mb-6">Credit Notes</h1>
        <div className="bg-white dark:bg-gray-900 rounded-xl border border-gray-100 dark:border-gray-800 shadow-sm p-8 text-center">
          <p className="text-gray-700 dark:text-gray-300 font-medium">Credit notes unavailable</p>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
            Your account is not linked to a client record yet. Please contact support.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div>
      <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100 mb-6">Credit Notes</h1>

      {error && (
        <div className="mb-4 px-4 py-3 bg-red-50 border border-red-100 text-sm text-red-600 rounded-lg">{error}</div>
      )}

      <div className="bg-white dark:bg-gray-900 rounded-xl border border-gray-100 dark:border-gray-800 shadow-sm overflow-hidden">
        {items.length === 0 && !error ? (
          <div className="p-8 text-center text-sm text-gray-500 dark:text-gray-400">No credit notes yet</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead className="bg-gray-50 dark:bg-gray-900 text-xs text-gray-500 dark:text-gray-400 uppercase tracking-wide">
                <tr>
                  <th className="px-4 py-3 text-left font-medium">#</th>
                  <th className="px-4 py-3 text-left font-medium">Date</th>
                  <th className="px-4 py-3 text-left font-medium">Reference</th>
                  <th className="px-4 py-3 text-right font-medium">Total</th>
                  <th className="px-4 py-3 text-left font-medium">Status</th>
                  <th className="px-4 py-3 text-right font-medium">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
                {items.map((cn) => {
                  const ref = cn.reference ?? cn.invoice?.number ?? '—';
                  return (
                    <tr key={cn.id} className="hover:bg-gray-50 dark:hover:bg-gray-800">
                      <td className="px-4 py-3 text-gray-900 dark:text-gray-100 font-medium whitespace-nowrap">{cn.number ?? cn.id.slice(0, 8)}</td>
                      <td className="px-4 py-3 text-gray-700 dark:text-gray-300 whitespace-nowrap">{formatDate(cn.date ?? cn.createdAt)}</td>
                      <td className="px-4 py-3 text-gray-600 dark:text-gray-400">{ref}</td>
                      <td className="px-4 py-3 text-right tabular-nums text-gray-900 dark:text-gray-100">
                        {formatMoney(toNumber(cn.total))} {cn.currency ?? ''}
                      </td>
                      <td className="px-4 py-3">
                        <span
                          className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${
                            STATUS_COLORS[cn.status ?? ''] ?? 'bg-gray-100 text-gray-700'
                          }`}
                        >
                          {cn.status ?? '—'}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-right">
                        <div className="flex items-center justify-end gap-3">
                          <Link
                            href={`/portal/credit-notes/${cn.id}`}
                            className="text-xs text-primary hover:underline"
                          >
                            View
                          </Link>
                          <button
                            type="button"
                            onClick={async () => {
                              const token = getToken();
                              if (!token) return;
                              const res = await fetch(
                                `${API_BASE}/api/v1/credit-notes/${cn.id}/pdf`,
                                { headers: { Authorization: `Bearer ${token}` } },
                              );
                              if (!res.ok) return;
                              const blob = await res.blob();
                              const url = URL.createObjectURL(blob);
                              const a = document.createElement('a');
                              a.href = url;
                              a.download = `credit-note-${cn.number ?? cn.id}.pdf`;
                              document.body.appendChild(a);
                              a.click();
                              a.remove();
                              URL.revokeObjectURL(url);
                            }}
                            className="text-xs text-gray-600 dark:text-gray-400 hover:underline"
                          >
                            PDF
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
