'use client';

/**
 * Quote detail — Wave F2 (CPQ).
 *
 * Read-only view of the quote header + line items, with status-aware
 * action buttons:
 *   draft     → Edit, Send, Delete, Duplicate
 *   sent      → Mark Accepted, Mark Rejected, Duplicate
 *   accepted  → Convert to Invoice (idempotent), Duplicate
 *   rejected  → Duplicate
 *   expired   → Duplicate
 *
 * "Edit" jumps to /quotes/new pre-loaded? — kept as a TODO; for now,
 * editing draft quotes happens via inline PUT on this page (toggle).
 */

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { ErrorBanner } from '@/components/ui/error-banner';
import { apiFetch } from '@/lib/api';

interface LineItem {
  id: string;
  productId: string | null;
  bundleId: string | null;
  description: string | null;
  quantity: number;
  unitPrice: number | string;
  discountPercent: number | string;
  lineTotal: number | string;
  order: number;
  product?: { id: string; name: string; sku: string | null } | null;
  bundle?: { id: string; name: string } | null;
}

interface Quote {
  id: string;
  number: string;
  status: 'draft' | 'sent' | 'accepted' | 'rejected' | 'expired';
  validUntil: string | null;
  subtotal: number | string;
  discountPercent: number | string;
  total: number | string;
  currency: string;
  notes: string | null;
  sentAt: string | null;
  acceptedAt: string | null;
  convertedInvoiceId: string | null;
  client: { id: string; company: string };
  opportunity: { id: string; name: string } | null;
  convertedInvoice: { id: string; number: string } | null;
  lineItems: LineItem[];
}

const STATUS_COLORS: Record<string, string> = {
  draft: 'bg-gray-100 text-gray-700',
  sent: 'bg-blue-100 text-blue-700',
  accepted: 'bg-green-100 text-green-700',
  rejected: 'bg-red-100 text-red-700',
  expired: 'bg-orange-100 text-orange-700',
};

function toNum(v: number | string | null | undefined): number {
  if (v == null) return 0;
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

export default function QuoteDetailPage({
  params,
}: {
  params: { id: string };
}) {
  const id = params.id;

  const router = useRouter();
  const [quote, setQuote] = useState<Quote | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await apiFetch(`/api/v1/quotes/${id}`);
      if (!res.ok) throw new Error('Failed to load quote');
      const data = await res.json();
      setQuote(data);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Unknown error');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  const action = async (
    path: string,
    method: 'POST' | 'DELETE' = 'POST',
    body?: any,
  ) => {
    setBusy(true);
    setError(null);
    try {
      const res = await apiFetch(`/api/v1/quotes/${id}${path}`, {
        method,
        headers: body ? { 'Content-Type': 'application/json' } : undefined,
        body: body ? JSON.stringify(body) : undefined,
      });
      if (!res.ok && res.status !== 204) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.message || 'Action failed');
      }
      return res.status === 204 ? null : await res.json().catch(() => null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Unknown error');
      return null;
    } finally {
      setBusy(false);
    }
  };

  const send = async () => {
    if (!confirm('Send this quote to the client?')) return;
    await action('/send', 'POST', {});
    await load();
  };
  const markAccepted = async () => {
    await action('/mark-accepted');
    await load();
  };
  const markRejected = async () => {
    if (!confirm('Mark this quote as rejected?')) return;
    await action('/mark-rejected');
    await load();
  };
  const duplicate = async () => {
    const dup = await action('/duplicate');
    if (dup?.id) router.push(`/quotes/${dup.id}`);
  };
  const del = async () => {
    if (!confirm('Delete this draft quote? This cannot be undone.')) return;
    const ok = await action('', 'DELETE');
    if (ok !== undefined) router.push('/quotes');
  };
  const convert = async () => {
    if (!confirm('Convert this accepted quote to a new draft invoice?'))
      return;
    const out = await action('/convert-to-invoice');
    if (out?.invoiceId) {
      router.push(`/invoices/${out.invoiceId}`);
    } else {
      await load();
    }
  };

  if (loading) {
    return <div className="p-6 text-sm text-gray-500">Loading…</div>;
  }
  if (!quote) {
    return <ErrorBanner message={error ?? 'Quote not found'} />;
  }

  const isDraft = quote.status === 'draft';
  const isSent = quote.status === 'sent';
  const isAccepted = quote.status === 'accepted';

  return (
    <div className="max-w-5xl mx-auto p-6 space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          <div className="flex items-center gap-3">
            <h1 className="text-xl font-semibold font-mono">{quote.number}</h1>
            <span
              className={`text-xs px-2 py-0.5 rounded ${
                STATUS_COLORS[quote.status] ?? 'bg-gray-100 text-gray-700'
              }`}
            >
              {quote.status}
            </span>
          </div>
          <p className="text-sm text-gray-500 mt-1">
            For{' '}
            <Link
              href={`/clients/${quote.client.id}`}
              className="text-primary hover:underline"
            >
              {quote.client.company}
            </Link>
            {quote.opportunity && (
              <>
                {' '}
                ·{' '}
                <Link
                  href={`/opportunities/${quote.opportunity.id}`}
                  className="text-primary hover:underline"
                >
                  {quote.opportunity.name}
                </Link>
              </>
            )}
          </p>
        </div>
        <div className="flex flex-wrap gap-2 justify-end">
          <Button variant="secondary" onClick={() => router.back()}>
            Back
          </Button>
          {isDraft && (
            <>
              <Button onClick={send} disabled={busy}>
                Send
              </Button>
              <Button variant="secondary" onClick={del} disabled={busy}>
                Delete
              </Button>
            </>
          )}
          {isSent && (
            <>
              <Button onClick={markAccepted} disabled={busy}>
                Mark accepted
              </Button>
              <Button variant="secondary" onClick={markRejected} disabled={busy}>
                Mark rejected
              </Button>
            </>
          )}
          {isAccepted && !quote.convertedInvoiceId && (
            <Button onClick={convert} disabled={busy}>
              Convert to invoice
            </Button>
          )}
          <Button variant="secondary" onClick={duplicate} disabled={busy}>
            Duplicate
          </Button>
        </div>
      </div>

      {error && <ErrorBanner message={error} />}

      {quote.convertedInvoice && (
        <div className="bg-green-50 dark:bg-green-950/30 border border-green-200 dark:border-green-900 rounded p-3 text-sm">
          Converted to invoice{' '}
          <Link
            href={`/invoices/${quote.convertedInvoice.id}`}
            className="text-primary font-mono hover:underline"
          >
            {quote.convertedInvoice.number}
          </Link>
        </div>
      )}

      {/* Meta */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
        <div>
          <div className="text-xs text-gray-500">Valid until</div>
          <div>
            {quote.validUntil
              ? new Date(quote.validUntil).toLocaleDateString()
              : '—'}
          </div>
        </div>
        <div>
          <div className="text-xs text-gray-500">Currency</div>
          <div>{quote.currency}</div>
        </div>
        <div>
          <div className="text-xs text-gray-500">Sent at</div>
          <div>
            {quote.sentAt ? new Date(quote.sentAt).toLocaleString() : '—'}
          </div>
        </div>
        <div>
          <div className="text-xs text-gray-500">Accepted at</div>
          <div>
            {quote.acceptedAt
              ? new Date(quote.acceptedAt).toLocaleString()
              : '—'}
          </div>
        </div>
      </div>

      {/* Line items */}
      <div>
        <h2 className="text-sm font-semibold mb-2">Line items</h2>
        <div className="overflow-x-auto border rounded">
          <table className="min-w-full text-sm">
            <thead className="border-b bg-gray-50 dark:bg-gray-900">
              <tr className="text-left text-xs uppercase text-gray-500">
                <th className="py-2 px-3">Description</th>
                <th className="py-2 px-3">Ref</th>
                <th className="py-2 px-3 text-right">Qty</th>
                <th className="py-2 px-3 text-right">Unit price</th>
                <th className="py-2 px-3 text-right">Disc %</th>
                <th className="py-2 px-3 text-right">Line total</th>
              </tr>
            </thead>
            <tbody>
              {quote.lineItems.map((li) => (
                <tr key={li.id} className="border-b">
                  <td className="py-2 px-3">{li.description ?? '—'}</td>
                  <td className="py-2 px-3 text-xs text-gray-500">
                    {li.product
                      ? `Product: ${li.product.name}`
                      : li.bundle
                      ? `Bundle: ${li.bundle.name}`
                      : '—'}
                  </td>
                  <td className="py-2 px-3 text-right">{li.quantity}</td>
                  <td className="py-2 px-3 text-right font-mono">
                    {formatMoney(li.unitPrice, quote.currency)}
                  </td>
                  <td className="py-2 px-3 text-right">
                    {Number(li.discountPercent).toFixed(2)}
                  </td>
                  <td className="py-2 px-3 text-right font-mono">
                    {formatMoney(li.lineTotal, quote.currency)}
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot className="border-t">
              <tr>
                <td colSpan={5} className="py-2 px-3 text-right text-xs">
                  Subtotal
                </td>
                <td className="py-2 px-3 text-right font-mono">
                  {formatMoney(quote.subtotal, quote.currency)}
                </td>
              </tr>
              <tr>
                <td colSpan={5} className="py-2 px-3 text-right text-xs">
                  Discount ({Number(quote.discountPercent).toFixed(2)}%)
                </td>
                <td className="py-2 px-3 text-right font-mono">
                  −{' '}
                  {formatMoney(
                    toNum(quote.subtotal) - toNum(quote.total),
                    quote.currency,
                  )}
                </td>
              </tr>
              <tr>
                <td colSpan={5} className="py-2 px-3 text-right text-sm font-semibold">
                  Total
                </td>
                <td className="py-2 px-3 text-right font-mono text-base font-semibold">
                  {formatMoney(quote.total, quote.currency)}
                </td>
              </tr>
            </tfoot>
          </table>
        </div>
      </div>

      {quote.notes && (
        <div>
          <h2 className="text-sm font-semibold mb-2">Notes</h2>
          <p className="text-sm whitespace-pre-wrap">{quote.notes}</p>
        </div>
      )}
    </div>
  );
}
