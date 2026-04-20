'use client';

import { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import { CreditCard } from 'lucide-react';
import { ListPageLayout } from '@/components/layouts/list-page-layout';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { TableSkeleton } from '@/components/ui/table-skeleton';
import { EmptyState } from '@/components/ui/empty-state';
import { ErrorBanner } from '@/components/ui/error-banner';
import { FormField, inputClass } from '@/components/ui/form-field';

interface Payment {
  id: string;
  amount: number | string;
  currency: string | null;
  paymentDate: string;
  note: string | null;
  invoice?: { id: string; number: string; total: number; status: string } | null;
  client?: { id: string; company: string } | null;
  paymentMode?: { id: string; name: string } | null;
  paymentModeId?: string | null;
  refundedAt?: string | null;
  refundedAmount?: number | string | null;
}

interface Response {
  data: Payment[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001';

function authHeaders(): HeadersInit {
  const token =
    typeof window === 'undefined' ? null : localStorage.getItem('access_token');
  return { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
}

function formatDate(iso: string): string {
  try {
    return new Intl.DateTimeFormat('en-GB', {
      day: '2-digit',
      month: 'short',
      year: 'numeric',
    }).format(new Date(iso));
  } catch {
    return iso;
  }
}

function formatCurrency(amount: number, currency: string): string {
  try {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency,
      minimumFractionDigits: 2,
    }).format(amount);
  } catch {
    return `${currency} ${amount.toFixed(2)}`;
  }
}

export default function PaymentsListPage() {
  const [items, setItems] = useState<Payment[]>([]);
  const [page, setPage] = useState(1);
  const [meta, setMeta] = useState<{ totalPages: number; total: number } | null>(
    null,
  );
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [refundOpen, setRefundOpen] = useState<Payment | null>(null);
  const [refundAmount, setRefundAmount] = useState('');
  const [refundReason, setRefundReason] = useState('');
  const [refunding, setRefunding] = useState(false);

  const fetchItems = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({
        page: String(page),
        limit: '20',
      });
      const res = await fetch(
        `${API_BASE}/api/v1/payments?${params.toString()}`,
        { headers: authHeaders() },
      );
      if (!res.ok) throw new Error(`Server responded with ${res.status}`);
      const json: Response = await res.json();
      setItems(json.data ?? []);
      setMeta({ totalPages: json.totalPages, total: json.total });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed');
    } finally {
      setLoading(false);
    }
  }, [page]);

  useEffect(() => {
    fetchItems();
  }, [fetchItems]);

  async function downloadPdf(id: string) {
    try {
      const res = await fetch(`${API_BASE}/api/v1/payments/${id}/pdf`, {
        headers: { Authorization: authHeaders().Authorization ?? '' } as any,
      });
      if (!res.ok) throw new Error(`Failed ${res.status}`);
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `receipt-${id}.pdf`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Download failed');
    }
  }

  function openRefund(p: Payment) {
    const amount = Math.max(
      0,
      Number(p.amount) - Number(p.refundedAmount ?? 0),
    );
    setRefundAmount(amount.toFixed(2));
    setRefundReason('');
    setRefundOpen(p);
  }

  async function submitRefund(e: React.FormEvent) {
    e.preventDefault();
    if (!refundOpen) return;
    setRefunding(true);
    try {
      const body = {
        amount: Number(refundAmount),
        reason: refundReason || undefined,
        refundDate: new Date().toISOString(),
      };
      const res = await fetch(
        `${API_BASE}/api/v1/payments/${refundOpen.id}/refund`,
        {
          method: 'POST',
          headers: authHeaders(),
          body: JSON.stringify(body),
        },
      );
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        throw new Error(j.message || `Failed ${res.status}`);
      }
      setRefundOpen(null);
      fetchItems();
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Refund failed');
    } finally {
      setRefunding(false);
    }
  }

  const paginationNode =
    meta && meta.totalPages > 1 ? (
      <div className="flex items-center justify-between text-sm">
        <span className="text-gray-500 dark:text-gray-400">
          Page {page} of {meta.totalPages} — {meta.total} payments
        </span>
        <div className="flex gap-2">
          <Button variant="secondary" size="sm" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>
            Previous
          </Button>
          <Button variant="secondary" size="sm" disabled={page >= meta.totalPages} onClick={() => setPage((p) => p + 1)}>
            Next
          </Button>
        </div>
      </div>
    ) : null;

  return (
    <ListPageLayout
      title="Payments"
      primaryAction={{ label: 'Batch record', href: '/payments/batch' }}
      pagination={paginationNode}
    >
      <Card>
        {error && (
          <ErrorBanner message={error} onRetry={fetchItems} className="rounded-none border-0 border-b border-red-100" />
        )}
        <div className="overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead>
              <tr className="bg-gray-50 dark:bg-gray-900 border-b border-gray-100 dark:border-gray-800 text-left text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide">
                <th className="px-4 py-3">Date</th>
                <th className="px-4 py-3">Invoice</th>
                <th className="px-4 py-3 hidden lg:table-cell">Client</th>
                <th className="px-4 py-3 text-right">Amount</th>
                <th className="px-4 py-3 hidden lg:table-cell">Mode</th>
                <th className="px-4 py-3 text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <TableSkeleton rows={6} columns={6} columnWidths={['30%', '40%', '40%', '25%', '30%', '25%']} />
              ) : items.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-4 py-8">
                    <EmptyState
                      icon={<CreditCard className="w-10 h-10" />}
                      title="No payments yet"
                    />
                  </td>
                </tr>
              ) : (
                items.map((p) => {
                  const amt = Number(p.amount);
                  const isRefund = amt < 0;
                  const isRefunded = !!p.refundedAt;
                  return (
                    <tr
                      key={p.id}
                      className="border-b border-gray-100 dark:border-gray-800 last:border-0 hover:bg-gray-50/60"
                    >
                      <td className="px-4 py-3 text-gray-500 dark:text-gray-400">
                        {formatDate(p.paymentDate)}
                      </td>
                      <td className="px-4 py-3 font-medium text-gray-900 dark:text-gray-100">
                        {p.invoice ? (
                          <Link
                            href={`/invoices/${p.invoice.id}`}
                            className="text-primary hover:underline"
                          >
                            {p.invoice.number}
                          </Link>
                        ) : (
                          '—'
                        )}
                      </td>
                      <td className="px-4 py-3 text-gray-500 dark:text-gray-400 hidden lg:table-cell">
                        {p.client?.company ?? '—'}
                      </td>
                      <td
                        className={`px-4 py-3 text-right font-medium ${
                          isRefund ? 'text-red-600' : 'text-gray-900'
                        }`}
                      >
                        {formatCurrency(amt, p.currency || 'USD')}
                        {isRefunded && (
                          <span className="ml-2 text-xs text-orange-600">
                            refunded
                          </span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-gray-500 dark:text-gray-400 hidden lg:table-cell">
                        {p.paymentMode?.name ?? '—'}
                      </td>
                      <td className="px-4 py-3 text-right">
                        <div className="inline-flex gap-3">
                          <button
                            onClick={() => downloadPdf(p.id)}
                            className="text-xs text-gray-500 dark:text-gray-400 hover:text-primary font-medium"
                          >
                            PDF
                          </button>
                          {!isRefund && !isRefunded && (
                            <button
                              onClick={() => openRefund(p)}
                              className="text-xs text-red-500 hover:text-red-700 font-medium"
                            >
                              Refund
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </Card>

      {/* Refund modal */}
      {refundOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40"
          role="dialog"
          aria-modal="true"
          aria-labelledby="refund-title"
        >
          <form
            onSubmit={submitRefund}
            className="bg-white dark:bg-gray-900 rounded-xl shadow-lg w-full max-w-md p-6 space-y-4"
          >
            <div>
              <h2 id="refund-title" className="text-lg font-semibold mb-1">Refund payment</h2>
              <p className="text-xs text-gray-500 dark:text-gray-400">
                Invoice {refundOpen.invoice?.number ?? '—'} · Original:{' '}
                {formatCurrency(
                  Number(refundOpen.amount),
                  refundOpen.currency || 'USD',
                )}
              </p>
            </div>

            <FormField label="Amount" required htmlFor="refund-amount">
              <input
                id="refund-amount"
                type="number"
                min="0"
                step="0.01"
                required
                value={refundAmount}
                onChange={(e) => setRefundAmount(e.target.value)}
                className={inputClass}
              />
            </FormField>

            <FormField label="Reason" hint="Optional" htmlFor="refund-reason">
              <textarea
                id="refund-reason"
                rows={3}
                value={refundReason}
                onChange={(e) => setRefundReason(e.target.value)}
                className={inputClass}
              />
            </FormField>

            <div className="flex justify-end gap-2">
              <Button
                type="button"
                variant="secondary"
                onClick={() => setRefundOpen(null)}
              >
                Cancel
              </Button>
              <Button
                type="submit"
                variant="destructive"
                loading={refunding}
                disabled={refunding}
              >
                {refunding ? 'Refunding…' : 'Refund'}
              </Button>
            </div>
          </form>
        </div>
      )}
    </ListPageLayout>
  );
}
