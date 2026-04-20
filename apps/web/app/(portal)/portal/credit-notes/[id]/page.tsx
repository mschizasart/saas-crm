'use client';

export const dynamic = 'force-dynamic';

import { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';

const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001';

interface CreditNoteItem {
  id: string;
  description: string;
  quantity: number | string;
  unitPrice: number | string;
  taxRate?: number | string | null;
  total?: number | string;
}

interface CreditNote {
  id: string;
  number?: string;
  date?: string;
  createdAt?: string;
  notes?: string | null;
  currency?: string;
  status?: string;
  subtotal?: number | string;
  tax?: number | string;
  discount?: number | string;
  total: number | string;
  client?: { id?: string; company?: string } | null;
  invoice?: { id?: string; number?: string } | null;
  items?: CreditNoteItem[];
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

export default function PortalCreditNoteDetailPage() {
  const router = useRouter();
  const params = useParams<{ id: string }>();
  const id = params?.id;

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [unavailable, setUnavailable] = useState(false);
  const [cn, setCn] = useState<CreditNote | null>(null);

  useEffect(() => {
    const token = getToken();
    if (!token) {
      router.push('/portal/login');
      return;
    }
    if (!id) return;

    (async () => {
      try {
        const res = await fetch(`${API_BASE}/api/v1/credit-notes/${id}`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (res.status === 401) {
          router.push('/portal/login');
          return;
        }
        if (res.status === 403 || res.status === 404) {
          setUnavailable(true);
          setLoading(false);
          return;
        }
        if (!res.ok) throw new Error(`Failed to load credit note (${res.status})`);
        const json = await res.json();
        setCn(json.data ?? json);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load credit note');
      } finally {
        setLoading(false);
      }
    })();
  }, [id, router]);

  if (loading) {
    return (
      <div>
        <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100 mb-6">Credit Note</h1>
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

  if (unavailable || !cn) {
    return (
      <div>
        <div className="mb-4">
          <Link href="/portal/credit-notes" className="text-sm text-gray-500 dark:text-gray-400 hover:text-primary">
            ← Back to credit notes
          </Link>
        </div>
        <div className="bg-white dark:bg-gray-900 rounded-xl border border-gray-100 dark:border-gray-800 shadow-sm p-8 text-center">
          <p className="text-gray-700 dark:text-gray-300 font-medium">Credit note unavailable</p>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
            {error ?? 'This credit note does not exist or is not accessible from your account.'}
          </p>
        </div>
      </div>
    );
  }

  const items = cn.items ?? [];
  const currency = cn.currency ?? '';

  return (
    <div>
      <div className="mb-4">
        <Link href="/portal/credit-notes" className="text-sm text-gray-500 dark:text-gray-400 hover:text-primary">
          ← Back to credit notes
        </Link>
      </div>

      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">{cn.number ?? 'Credit Note'}</h1>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
            {formatDate(cn.date ?? cn.createdAt)}
            {cn.status ? ` · ${cn.status}` : ''}
            {cn.invoice?.number ? ` · Applied to ${cn.invoice.number}` : ''}
          </p>
        </div>
        <button
          type="button"
          onClick={async () => {
            const token = getToken();
            if (!token || !cn) return;
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
          className="px-3 py-2 text-sm text-gray-700 dark:text-gray-300 bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-800"
        >
          Download PDF
        </button>
      </div>

      {error && (
        <div className="mb-4 px-4 py-3 bg-red-50 border border-red-100 text-sm text-red-600 rounded-lg">{error}</div>
      )}

      <div className="bg-white dark:bg-gray-900 rounded-xl border border-gray-100 dark:border-gray-800 shadow-sm overflow-hidden mb-6">
        {items.length === 0 ? (
          <div className="p-8 text-center text-sm text-gray-500 dark:text-gray-400">No line items on this credit note.</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead className="bg-gray-50 dark:bg-gray-900 text-xs text-gray-500 dark:text-gray-400 uppercase tracking-wide">
                <tr>
                  <th className="px-4 py-3 text-left font-medium">Description</th>
                  <th className="px-4 py-3 text-right font-medium">Qty</th>
                  <th className="px-4 py-3 text-right font-medium">Unit price</th>
                  <th className="px-4 py-3 text-right font-medium">Tax</th>
                  <th className="px-4 py-3 text-right font-medium">Total</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
                {items.map((it) => {
                  const qty = toNumber(it.quantity);
                  const unit = toNumber(it.unitPrice);
                  const taxRate = toNumber(it.taxRate);
                  const line = it.total != null ? toNumber(it.total) : qty * unit * (1 + taxRate / 100);
                  return (
                    <tr key={it.id}>
                      <td className="px-4 py-3 text-gray-900 dark:text-gray-100">{it.description}</td>
                      <td className="px-4 py-3 text-right tabular-nums text-gray-700 dark:text-gray-300">{qty}</td>
                      <td className="px-4 py-3 text-right tabular-nums text-gray-700 dark:text-gray-300">{formatMoney(unit)}</td>
                      <td className="px-4 py-3 text-right tabular-nums text-gray-500 dark:text-gray-400">{taxRate ? `${taxRate}%` : '—'}</td>
                      <td className="px-4 py-3 text-right tabular-nums font-medium text-gray-900 dark:text-gray-100">{formatMoney(line)}</td>
                    </tr>
                  );
                })}
              </tbody>
              <tfoot className="bg-gray-50 dark:bg-gray-900 text-sm">
                {cn.subtotal != null && (
                  <tr>
                    <td colSpan={4} className="px-4 py-2 text-right text-gray-500 dark:text-gray-400">Subtotal</td>
                    <td className="px-4 py-2 text-right tabular-nums text-gray-900 dark:text-gray-100">{formatMoney(toNumber(cn.subtotal))}</td>
                  </tr>
                )}
                {cn.tax != null && (
                  <tr>
                    <td colSpan={4} className="px-4 py-2 text-right text-gray-500 dark:text-gray-400">Tax</td>
                    <td className="px-4 py-2 text-right tabular-nums text-gray-900 dark:text-gray-100">{formatMoney(toNumber(cn.tax))}</td>
                  </tr>
                )}
                {cn.discount != null && toNumber(cn.discount) > 0 && (
                  <tr>
                    <td colSpan={4} className="px-4 py-2 text-right text-gray-500 dark:text-gray-400">Discount</td>
                    <td className="px-4 py-2 text-right tabular-nums text-gray-900 dark:text-gray-100">−{formatMoney(toNumber(cn.discount))}</td>
                  </tr>
                )}
                <tr>
                  <td colSpan={4} className="px-4 py-3 text-right text-xs uppercase tracking-wide text-gray-500 dark:text-gray-400 font-medium">
                    Total
                  </td>
                  <td className="px-4 py-3 text-right tabular-nums font-bold text-gray-900 dark:text-gray-100">
                    {formatMoney(toNumber(cn.total))} {currency}
                  </td>
                </tr>
              </tfoot>
            </table>
          </div>
        )}
      </div>

      {cn.notes && (
        <div className="bg-white dark:bg-gray-900 rounded-xl border border-gray-100 dark:border-gray-800 shadow-sm p-6">
          <h2 className="text-sm font-semibold text-gray-900 dark:text-gray-100 uppercase tracking-wide mb-2">Notes</h2>
          <p className="text-sm text-gray-700 dark:text-gray-300 whitespace-pre-wrap">{cn.notes}</p>
        </div>
      )}
    </div>
  );
}
