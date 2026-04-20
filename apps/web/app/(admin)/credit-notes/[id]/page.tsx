'use client';

import { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { DetailPageLayout } from '@/components/layouts/detail-page-layout';

interface Item {
  id: string;
  description: string;
  qty: number;
  rate: number;
  tax1: number;
  total: number;
}

interface CreditNote {
  id: string;
  number: string;
  date: string;
  status: string;
  currency: string;
  subTotal: number;
  totalTax: number;
  total: number;
  appliedTotal?: number;
  notes: string | null;
  invoiceId: string | null;
  clientId?: string | null;
  client?: { id: string; company: string } | null;
  invoice?: { id: string; number: string } | null;
  items: Item[];
}

interface InvoiceRow {
  id: string;
  number: string;
  total: number;
  currency: string;
  status: string;
  dueDate?: string;
  payments?: { amount: number }[];
}

const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001';

function authHeaders(): HeadersInit {
  const token = typeof window === 'undefined' ? null : localStorage.getItem('access_token');
  return { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
}

function StatusBadge({ status }: { status: string }) {
  const map: Record<string, string> = {
    draft: 'bg-gray-100 text-gray-500',
    open: 'bg-blue-100 text-blue-700',
    applied: 'bg-green-100 text-green-700',
    voided: 'bg-red-100 text-red-700',
  };
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium capitalize ${map[status] ?? 'bg-gray-100 text-gray-500'}`}>
      {status}
    </span>
  );
}

export default function CreditNoteDetailPage() {
  const params = useParams();
  const router = useRouter();
  const id = params.id as string;

  const [cn, setCn] = useState<CreditNote | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [acting, setActing] = useState(false);
  const [showApplyModal, setShowApplyModal] = useState(false);
  const [invoices, setInvoices] = useState<InvoiceRow[]>([]);
  const [invoicesLoading, setInvoicesLoading] = useState(false);
  const [selectedInvoiceId, setSelectedInvoiceId] = useState<string>('');
  const [toast, setToast] = useState<string | null>(null);

  const fetchCn = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`${API_BASE}/api/v1/credit-notes/${id}`, { headers: authHeaders() });
      if (!res.ok) throw new Error(`Server responded with ${res.status}`);
      setCn(await res.json());
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed');
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    fetchCn();
  }, [fetchCn]);

  async function doAction(path: string, method: string = 'POST') {
    setActing(true);
    try {
      const res = await fetch(`${API_BASE}/api/v1/credit-notes/${id}${path}`, {
        method,
        headers: authHeaders(),
      });
      if (!res.ok) throw new Error(`Failed with status ${res.status}`);
      if (method === 'DELETE') {
        router.push('/credit-notes');
        return;
      }
      fetchCn();
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Failed');
    } finally {
      setActing(false);
    }
  }

  // Load unpaid/partial invoices for the credit note's client when the modal opens
  async function openApplyModal() {
    if (!cn) return;
    setShowApplyModal(true);
    setSelectedInvoiceId('');
    setInvoicesLoading(true);
    try {
      const clientId = cn.clientId ?? cn.client?.id;
      if (!clientId) { setInvoices([]); return; }
      // Fetch unpaid + partial in parallel. 'all' + filter client-side keeps
      // this resilient to any server-side filter shape drift.
      const res = await fetch(
        `${API_BASE}/api/v1/invoices?clientId=${clientId}&limit=100`,
        { headers: authHeaders() },
      );
      if (!res.ok) throw new Error(`Server ${res.status}`);
      const json = await res.json();
      const rows: InvoiceRow[] = (json.data ?? []).filter((inv: InvoiceRow) =>
        ['sent', 'partial', 'overdue', 'viewed'].includes(inv.status),
      );
      // Pull full detail for payment sums (list endpoint doesn't include
      // payments). For a large result set we'd batch — for typical 10-50
      // invoices per client this is fine.
      const detailed = await Promise.all(
        rows.map(async (r) => {
          try {
            const d = await fetch(`${API_BASE}/api/v1/invoices/${r.id}`, {
              headers: authHeaders(),
            });
            if (!d.ok) return r;
            const full = await d.json();
            return { ...r, payments: full.payments ?? [] } as InvoiceRow;
          } catch {
            return r;
          }
        }),
      );
      setInvoices(detailed);
    } catch (err) {
      setToast(err instanceof Error ? err.message : 'Failed');
    } finally {
      setInvoicesLoading(false);
    }
  }

  async function submitApply() {
    if (!selectedInvoiceId) return;
    setActing(true);
    try {
      const res = await fetch(
        `${API_BASE}/api/v1/credit-notes/${id}/apply-to/${selectedInvoiceId}`,
        { method: 'POST', headers: authHeaders() },
      );
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body?.message ?? `Failed (${res.status})`);
      }
      setShowApplyModal(false);
      setToast('Credit note applied');
      setTimeout(() => setToast(null), 3000);
      fetchCn();
    } catch (err) {
      setToast(err instanceof Error ? err.message : 'Failed');
      setTimeout(() => setToast(null), 4000);
    } finally {
      setActing(false);
    }
  }

  if (loading) return <div className="flex justify-center py-24 text-sm text-gray-400 dark:text-gray-500">Loading…</div>;

  if (error || !cn) {
    return (
      <div className="px-4 py-8 text-center">
        <p className="text-red-600 text-sm mb-3">{error ?? 'Not found'}</p>
        <button onClick={fetchCn} className="text-sm text-primary underline">Retry</button>
      </div>
    );
  }

  const actions: { label: string; onClick: () => void; disabled?: boolean; variant?: 'primary' | 'secondary' }[] = [];
  if (cn.status === 'draft') {
    actions.push({
      label: 'Delete',
      onClick: () => { if (confirm('Delete this credit note?')) doAction('', 'DELETE'); },
      disabled: acting,
      variant: 'secondary',
    });
  }
  if (cn.status === 'open' && cn.invoiceId) {
    actions.push({ label: 'Apply to Invoice', onClick: () => doAction('/apply'), disabled: acting, variant: 'primary' });
  }
  if (cn.status === 'open') {
    actions.push({ label: 'Apply to invoice', onClick: openApplyModal, disabled: acting, variant: 'secondary' });
    actions.push({ label: 'Void', onClick: () => doAction('/void'), disabled: acting, variant: 'secondary' });
  }

  return (
    <DetailPageLayout
      title={cn.number}
      breadcrumbs={[
        { label: 'Credit Notes', href: '/credit-notes' },
        { label: cn.number },
      ]}
      badge={<StatusBadge status={cn.status} />}
      actions={actions}
    >
      <div className="bg-white dark:bg-gray-900 rounded-xl border border-gray-100 dark:border-gray-800 shadow-sm p-6 mb-6">
        <dl className="grid grid-cols-1 sm:grid-cols-3 gap-4 text-sm">
          <div>
            <dt className="text-xs font-semibold text-gray-400 dark:text-gray-500 uppercase">Date</dt>
            <dd className="text-gray-900 dark:text-gray-100 mt-1">{new Date(cn.date).toLocaleDateString()}</dd>
          </div>
          <div>
            <dt className="text-xs font-semibold text-gray-400 dark:text-gray-500 uppercase">Client</dt>
            <dd className="text-gray-900 dark:text-gray-100 mt-1">
              {cn.client ? (
                <Link href={`/clients/${cn.client.id}`} className="text-primary hover:underline">
                  {cn.client.company}
                </Link>
              ) : '—'}
            </dd>
          </div>
          <div>
            <dt className="text-xs font-semibold text-gray-400 dark:text-gray-500 uppercase">Invoice</dt>
            <dd className="text-gray-900 dark:text-gray-100 mt-1">
              {cn.invoice ? (
                <Link href={`/invoices/${cn.invoice.id}`} className="text-primary hover:underline">
                  {cn.invoice.number}
                </Link>
              ) : '—'}
            </dd>
          </div>
        </dl>
      </div>

      <div className="bg-white dark:bg-gray-900 rounded-xl border border-gray-100 dark:border-gray-800 shadow-sm overflow-hidden mb-6">
        <table className="min-w-full text-sm">
          <thead>
            <tr className="bg-gray-50 dark:bg-gray-900 border-b border-gray-100 dark:border-gray-800 text-left text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide">
              <th className="px-4 py-3">Description</th>
              <th className="px-4 py-3 text-right">Qty</th>
              <th className="px-4 py-3 text-right">Unit Price</th>
              <th className="px-4 py-3 text-right">Tax %</th>
              <th className="px-4 py-3 text-right">Total</th>
            </tr>
          </thead>
          <tbody>
            {cn.items.map((it) => (
              <tr key={it.id} className="border-b border-gray-100 dark:border-gray-800 last:border-0">
                <td className="px-4 py-3 text-gray-900 dark:text-gray-100">{it.description}</td>
                <td className="px-4 py-3 text-right text-gray-500 dark:text-gray-400">{Number(it.qty)}</td>
                <td className="px-4 py-3 text-right text-gray-500 dark:text-gray-400">{Number(it.rate).toFixed(2)}</td>
                <td className="px-4 py-3 text-right text-gray-500 dark:text-gray-400">{Number(it.tax1).toFixed(2)}</td>
                <td className="px-4 py-3 text-right font-medium text-gray-900 dark:text-gray-100">{Number(it.total).toFixed(2)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <div className="border-t border-gray-100 dark:border-gray-800 p-4 text-sm space-y-1 max-w-xs ml-auto">
          <div className="flex justify-between">
            <span className="text-gray-500 dark:text-gray-400">Subtotal</span>
            <span className="font-medium">{Number(cn.subTotal).toFixed(2)}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-gray-500 dark:text-gray-400">Tax</span>
            <span className="font-medium">{Number(cn.totalTax).toFixed(2)}</span>
          </div>
          <div className="flex justify-between text-base font-semibold border-t border-gray-100 dark:border-gray-800 pt-2 mt-2">
            <span>Total</span>
            <span>{Number(cn.total).toFixed(2)} {cn.currency}</span>
          </div>
        </div>
      </div>

      {cn.notes && (
        <div className="bg-white dark:bg-gray-900 rounded-xl border border-gray-100 dark:border-gray-800 shadow-sm p-6">
          <h2 className="text-xs font-semibold text-gray-400 dark:text-gray-500 uppercase mb-2">Notes</h2>
          <p className="text-sm text-gray-700 dark:text-gray-300 whitespace-pre-wrap">{cn.notes}</p>
        </div>
      )}

      {toast && (
        <div className="fixed bottom-6 right-6 z-50 bg-gray-900 text-white text-sm px-4 py-2 rounded-lg shadow-lg">
          {toast}
        </div>
      )}

      {showApplyModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="bg-white dark:bg-gray-900 rounded-xl shadow-2xl w-full max-w-2xl max-h-[85vh] flex flex-col">
            <div className="px-6 py-4 border-b border-gray-100 dark:border-gray-800 flex items-center justify-between">
              <h2 className="text-base font-semibold text-gray-900 dark:text-gray-100">Apply credit note to invoice</h2>
              <button
                onClick={() => setShowApplyModal(false)}
                className="text-gray-400 dark:text-gray-500 hover:text-gray-700 dark:hover:text-gray-300 text-xl leading-none"
              >×</button>
            </div>
            <div className="p-6 overflow-auto flex-1">
              {invoicesLoading ? (
                <div className="text-sm text-gray-400 dark:text-gray-500 py-8 text-center">Loading invoices…</div>
              ) : invoices.length === 0 ? (
                <div className="text-sm text-gray-400 dark:text-gray-500 py-8 text-center">
                  No unpaid invoices found for this client.
                </div>
              ) : (
                <table className="min-w-full text-sm">
                  <thead>
                    <tr className="text-left text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide border-b border-gray-100 dark:border-gray-800">
                      <th className="px-2 py-2 w-8"></th>
                      <th className="px-2 py-2">Invoice</th>
                      <th className="px-2 py-2">Status</th>
                      <th className="px-2 py-2 text-right">Total</th>
                      <th className="px-2 py-2 text-right">Remaining</th>
                    </tr>
                  </thead>
                  <tbody>
                    {invoices.map((inv) => {
                      const paid = (inv.payments ?? []).reduce(
                        (s, p) => s + Number(p.amount ?? 0),
                        0,
                      );
                      const remaining = Number(inv.total ?? 0) - paid;
                      return (
                        <tr key={inv.id} className="border-b border-gray-50 last:border-0">
                          <td className="px-2 py-2">
                            <input
                              type="radio"
                              name="apply-invoice"
                              checked={selectedInvoiceId === inv.id}
                              onChange={() => setSelectedInvoiceId(inv.id)}
                            />
                          </td>
                          <td className="px-2 py-2 font-medium">{inv.number}</td>
                          <td className="px-2 py-2 text-gray-500 dark:text-gray-400 capitalize">{inv.status}</td>
                          <td className="px-2 py-2 text-right tabular-nums">
                            {Number(inv.total).toFixed(2)} {inv.currency}
                          </td>
                          <td className="px-2 py-2 text-right tabular-nums font-medium">
                            {remaining.toFixed(2)}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              )}
            </div>
            <div className="px-6 py-4 border-t border-gray-100 dark:border-gray-800 flex justify-end gap-2">
              <button
                onClick={() => setShowApplyModal(false)}
                className="px-4 py-2 text-sm font-medium text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-gray-100"
              >Cancel</button>
              <button
                disabled={!selectedInvoiceId || acting}
                onClick={submitApply}
                className="px-4 py-2 text-sm font-medium bg-primary text-white rounded-lg hover:bg-primary/90 disabled:opacity-50"
              >
                {acting ? 'Applying…' : 'Apply'}
              </button>
            </div>
          </div>
        </div>
      )}
    </DetailPageLayout>
  );
}
