'use client';

import { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface InvoiceItem {
  id: string;
  description: string;
  quantity: number;
  unitPrice: number;
  taxRate: number;
  total: number;
  order: number;
}

interface Payment {
  id: string;
  paymentDate: string;
  amount: number;
  transactionId: string | null;
}

interface Invoice {
  id: string;
  number: string;
  date: string;
  dueDate: string | null;
  status: string;
  subtotal: number;
  tax: number;
  discount: number;
  total: number;
  notes: string | null;
  currency: string;
  client: {
    id: string;
    company: string;
  } | null;
  items: InvoiceItem[];
  payments: Payment[];
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001';

const STATUS_COLOURS: Record<string, string> = {
  draft: 'bg-gray-100 text-gray-500',
  sent: 'bg-blue-100 text-blue-700',
  viewed: 'bg-blue-50 text-blue-600',
  partial: 'bg-orange-100 text-orange-700',
  paid: 'bg-green-100 text-green-700',
  overdue: 'bg-red-100 text-red-700',
  cancelled: 'bg-gray-100 text-gray-500',
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function getToken(): string | null {
  if (typeof window === 'undefined') return null;
  return localStorage.getItem('access_token');
}

function authHeaders(): HeadersInit {
  return { Authorization: `Bearer ${getToken()}`, 'Content-Type': 'application/json' };
}

function fmt(value: number | string, currency = 'USD') {
  return Number(value).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function Spinner() {
  return (
    <div className="flex justify-center items-center py-24">
      <svg
        className="animate-spin h-7 w-7 text-primary"
        xmlns="http://www.w3.org/2000/svg"
        fill="none"
        viewBox="0 0 24 24"
        aria-label="Loading"
      >
        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
      </svg>
    </div>
  );
}

function StatusBadge({ status }: { status: string }) {
  return (
    <span
      className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium capitalize ${STATUS_COLOURS[status] ?? 'bg-gray-100 text-gray-500'}`}
    >
      {status}
    </span>
  );
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default function InvoiceDetailPage() {
  const params = useParams();
  const router = useRouter();
  const invoiceId = params.id as string;

  const [invoice, setInvoice] = useState<Invoice | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [actionLoading, setActionLoading] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  // ── Fetch ──────────────────────────────────────────────────────────────────

  const fetchInvoice = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`${API_BASE}/api/v1/invoices/${invoiceId}`, {
        headers: authHeaders(),
      });
      if (!res.ok) throw new Error(`Server responded with ${res.status}`);
      const data: Invoice = await res.json();
      setInvoice(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load invoice');
    } finally {
      setLoading(false);
    }
  }, [invoiceId]);

  useEffect(() => {
    fetchInvoice();
  }, [fetchInvoice]);

  // ── Action helpers ─────────────────────────────────────────────────────────

  async function runAction(path: string, onSuccess?: (data: any) => void) {
    setActionLoading(true);
    setActionError(null);
    try {
      const res = await fetch(`${API_BASE}/api/v1/invoices/${invoiceId}/${path}`, {
        method: 'POST',
        headers: authHeaders(),
      });
      if (!res.ok) throw new Error(`Action failed with status ${res.status}`);
      const data = await res.json();
      if (onSuccess) {
        onSuccess(data);
      } else {
        await fetchInvoice();
      }
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Action failed');
    } finally {
      setActionLoading(false);
    }
  }

  // ── Render ─────────────────────────────────────────────────────────────────

  if (loading) return <Spinner />;

  if (error || !invoice) {
    return (
      <div className="px-4 py-8 text-center">
        <p className="text-red-600 text-sm mb-3">{error ?? 'Invoice not found'}</p>
        <button onClick={fetchInvoice} className="text-sm text-primary underline">Retry</button>
      </div>
    );
  }

  const { status } = invoice;
  const showSend = status === 'draft';
  const showMarkPaid = ['sent', 'partial', 'overdue', 'viewed'].includes(status);
  const discount = Number(invoice.discount);

  return (
    <div className="max-w-4xl mx-auto">
      {/* ── Breadcrumb ────────────────────────────────────────────────────── */}
      <div className="flex items-center gap-2 mb-6 text-sm text-gray-500">
        <Link href="/invoices" className="hover:text-primary transition-colors">Invoices</Link>
        <span>/</span>
        <span className="text-gray-900 font-medium">Invoice #{invoice.number}</span>
      </div>

      {/* ── Header ───────────────────────────────────────────────────────── */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mb-6">
        <div className="flex items-center gap-3">
          <h1 className="text-2xl font-bold text-gray-900">Invoice {invoice.number}</h1>
          <StatusBadge status={status} />
        </div>

        {/* Action bar */}
        <div className="flex items-center gap-2">
          {showSend && (
            <button
              onClick={() => runAction('send')}
              disabled={actionLoading}
              className="px-4 py-2 text-sm font-medium bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 transition-colors"
            >
              Send Invoice
            </button>
          )}
          {showMarkPaid && (
            <button
              onClick={() => runAction('mark-paid')}
              disabled={actionLoading}
              className="px-4 py-2 text-sm font-medium bg-green-600 text-white rounded-lg hover:bg-green-700 disabled:opacity-50 transition-colors"
            >
              Mark as Paid
            </button>
          )}
          <button
            onClick={() =>
              runAction('duplicate', (data) => {
                if (data?.id) router.push(`/invoices/${data.id}`);
              })
            }
            disabled={actionLoading}
            className="px-4 py-2 text-sm font-medium bg-gray-100 text-gray-700 rounded-lg hover:bg-gray-200 disabled:opacity-50 transition-colors"
          >
            Duplicate
          </button>
        </div>
      </div>

      {actionError && (
        <div className="mb-4 px-3 py-2 bg-red-50 border border-red-100 text-red-600 text-sm rounded-lg">
          {actionError}
        </div>
      )}

      {/* ── Info row ─────────────────────────────────────────────────────── */}
      <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-6 mb-6">
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-6 text-sm">
          <div>
            <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-1">Client</p>
            {invoice.client ? (
              <Link href={`/clients/${invoice.client.id}`} className="text-primary hover:underline font-medium">
                {invoice.client.company}
              </Link>
            ) : (
              <span className="text-gray-300">—</span>
            )}
          </div>
          <div>
            <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-1">Issue Date</p>
            <p className="text-gray-900 font-medium">{new Date(invoice.date).toLocaleDateString()}</p>
          </div>
          <div>
            <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-1">Due Date</p>
            <p className="text-gray-900 font-medium">
              {invoice.dueDate ? new Date(invoice.dueDate).toLocaleDateString() : <span className="text-gray-300">—</span>}
            </p>
          </div>
        </div>
      </div>

      {/* ── Line items ───────────────────────────────────────────────────── */}
      <div className="bg-white rounded-xl border border-gray-100 shadow-sm overflow-hidden mb-6">
        <div className="px-4 py-3 border-b border-gray-100">
          <h2 className="text-sm font-semibold text-gray-700">Line Items</h2>
        </div>
        <div className="overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead>
              <tr className="bg-gray-50 border-b border-gray-100 text-xs font-semibold text-gray-500 uppercase tracking-wide">
                <th className="px-4 py-3 text-left">Description</th>
                <th className="px-4 py-3 text-right">Qty</th>
                <th className="px-4 py-3 text-right">Unit Price</th>
                <th className="px-4 py-3 text-right">Tax %</th>
                <th className="px-4 py-3 text-right">Total</th>
              </tr>
            </thead>
            <tbody>
              {invoice.items.map((item, i) => (
                <tr
                  key={item.id}
                  className={`border-b border-gray-100 last:border-0 ${i % 2 === 1 ? 'bg-gray-50/50' : ''}`}
                >
                  <td className="px-4 py-3 text-gray-900">{item.description}</td>
                  <td className="px-4 py-3 text-right text-gray-600">{Number(item.quantity)}</td>
                  <td className="px-4 py-3 text-right text-gray-600">{fmt(item.unitPrice)}</td>
                  <td className="px-4 py-3 text-right text-gray-600">{Number(item.taxRate)}%</td>
                  <td className="px-4 py-3 text-right font-medium text-gray-900">{fmt(item.total)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* Totals box */}
        <div className="px-4 py-4 border-t border-gray-100 flex justify-end">
          <div className="w-full max-w-xs space-y-1.5 text-sm">
            <div className="flex justify-between text-gray-600">
              <span>Subtotal</span>
              <span>{fmt(invoice.subtotal)}</span>
            </div>
            <div className="flex justify-between text-gray-600">
              <span>Tax</span>
              <span>{fmt(invoice.tax)}</span>
            </div>
            {discount > 0 && (
              <div className="flex justify-between text-gray-600">
                <span>Discount</span>
                <span>-{fmt(discount)}</span>
              </div>
            )}
            <div className="flex justify-between font-bold text-gray-900 text-base pt-2 border-t border-gray-200">
              <span>Total</span>
              <span>{invoice.currency} {fmt(invoice.total)}</span>
            </div>
          </div>
        </div>
      </div>

      {/* ── Payments ─────────────────────────────────────────────────────── */}
      {invoice.payments && invoice.payments.length > 0 && (
        <div className="bg-white rounded-xl border border-gray-100 shadow-sm overflow-hidden mb-6">
          <div className="px-4 py-3 border-b border-gray-100">
            <h2 className="text-sm font-semibold text-gray-700">Payments</h2>
          </div>
          <div className="overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead>
                <tr className="bg-gray-50 border-b border-gray-100 text-xs font-semibold text-gray-500 uppercase tracking-wide">
                  <th className="px-4 py-3 text-left">Date</th>
                  <th className="px-4 py-3 text-right">Amount</th>
                  <th className="px-4 py-3 text-left">Transaction ID</th>
                </tr>
              </thead>
              <tbody>
                {invoice.payments.map((p) => (
                  <tr key={p.id} className="border-b border-gray-100 last:border-0 hover:bg-gray-50/50">
                    <td className="px-4 py-3 text-gray-600">{new Date(p.paymentDate).toLocaleDateString()}</td>
                    <td className="px-4 py-3 text-right font-medium text-gray-900">{fmt(p.amount)}</td>
                    <td className="px-4 py-3 text-gray-500">
                      {p.transactionId ?? <span className="text-gray-300">—</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ── Notes ────────────────────────────────────────────────────────── */}
      {invoice.notes && (
        <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-6">
          <h2 className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-2">Notes</h2>
          <p className="text-sm text-gray-600 whitespace-pre-wrap">{invoice.notes}</p>
        </div>
      )}
    </div>
  );
}
