'use client';

// Next 14 static-generation guard — we fetch at runtime and rely on localStorage.
export const dynamic = 'force-dynamic';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';

const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001';

interface PaymentRow {
  id: string;
  amount: number | string;
  paymentDate?: string;
  date?: string;
  createdAt?: string;
  transactionId?: string | null;
  paymentMode?: { name?: string } | null;
  paymentModeName?: string | null;
  mode?: string | null;
  method?: string | null;
  invoice?: { id?: string; number?: string } | null;
  invoiceNumber?: string | null;
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

export default function PortalPaymentsPage() {
  const router = useRouter();

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [items, setItems] = useState<PaymentRow[]>([]);
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

        // Payments controller exposes GET /payments?clientId=... (invoices.view perm).
        // No nested /clients/:id/payments route exists.
        const res = await fetch(`${API_BASE}/api/v1/payments?clientId=${encodeURIComponent(clientId)}&limit=100`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (!res.ok) throw new Error(`Failed to load payments (${res.status})`);
        const json = await res.json();
        const list: PaymentRow[] = json.data ?? json.items ?? json ?? [];
        const arr = Array.isArray(list) ? list : [];
        arr.sort((a, b) => {
          const da = new Date(a.paymentDate ?? a.date ?? a.createdAt ?? 0).getTime();
          const db = new Date(b.paymentDate ?? b.date ?? b.createdAt ?? 0).getTime();
          return db - da;
        });
        setItems(arr);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load payments');
      } finally {
        setLoading(false);
      }
    })();
  }, [router]);

  if (loading) {
    return (
      <div>
        <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100 mb-6">Payments</h1>
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
        <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100 mb-6">Payments</h1>
        <div className="bg-white dark:bg-gray-900 rounded-xl border border-gray-100 dark:border-gray-800 shadow-sm p-8 text-center">
          <p className="text-gray-700 dark:text-gray-300 font-medium">Payments unavailable</p>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
            Your account is not linked to a client record yet. Please contact support.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div>
      <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100 mb-6">Payments</h1>

      {error && (
        <div className="mb-4 px-4 py-3 bg-red-50 border border-red-100 text-sm text-red-600 rounded-lg">{error}</div>
      )}

      <div className="bg-white dark:bg-gray-900 rounded-xl border border-gray-100 dark:border-gray-800 shadow-sm overflow-hidden">
        {items.length === 0 ? (
          <div className="p-8 text-center text-sm text-gray-500 dark:text-gray-400">No payments yet</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead className="bg-gray-50 dark:bg-gray-900 text-xs text-gray-500 dark:text-gray-400 uppercase tracking-wide">
                <tr>
                  <th className="px-4 py-3 text-left font-medium">Date</th>
                  <th className="px-4 py-3 text-left font-medium">Invoice #</th>
                  <th className="px-4 py-3 text-right font-medium">Amount</th>
                  <th className="px-4 py-3 text-left font-medium">Payment mode</th>
                  <th className="px-4 py-3 text-left font-medium">Transaction ID</th>
                  <th className="px-4 py-3 text-right font-medium">Receipt</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
                {items.map((p) => {
                  const date = p.paymentDate ?? p.date ?? p.createdAt;
                  const mode =
                    p.paymentMode?.name ?? p.paymentModeName ?? p.mode ?? p.method ?? '—';
                  const invNum = p.invoice?.number ?? p.invoiceNumber ?? '—';
                  return (
                    <tr key={p.id} className="hover:bg-gray-50 dark:hover:bg-gray-800">
                      <td className="px-4 py-3 text-gray-700 dark:text-gray-300 whitespace-nowrap">{formatDate(date)}</td>
                      <td className="px-4 py-3 text-gray-900 dark:text-gray-100 font-medium whitespace-nowrap">{invNum}</td>
                      <td className="px-4 py-3 text-right tabular-nums text-gray-900 dark:text-gray-100">
                        {formatMoney(toNumber(p.amount))}
                      </td>
                      <td className="px-4 py-3 text-gray-600 dark:text-gray-400">{mode}</td>
                      <td className="px-4 py-3 text-gray-500 dark:text-gray-400 font-mono text-xs">{p.transactionId ?? '—'}</td>
                      <td className="px-4 py-3 text-right">
                        <button
                          type="button"
                          onClick={async () => {
                            const token = getToken();
                            if (!token) return;
                            const res = await fetch(
                              `${API_BASE}/api/v1/payments/${p.id}/pdf`,
                              { headers: { Authorization: `Bearer ${token}` } },
                            );
                            if (!res.ok) return;
                            const blob = await res.blob();
                            const url = URL.createObjectURL(blob);
                            const a = document.createElement('a');
                            a.href = url;
                            a.download = `receipt-${p.id}.pdf`;
                            document.body.appendChild(a);
                            a.click();
                            a.remove();
                            URL.revokeObjectURL(url);
                          }}
                          className="text-xs text-primary hover:underline"
                        >
                          Download
                        </button>
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
