'use client';

/**
 * Client Statement modal.
 *
 * Lets a staff user pick a date range, preview the statement on screen, and
 * download the PDF version. Mounted from the client detail page header.
 *
 * Why a separate file? The detail page is already 800+ lines; pulling this
 * out keeps the page tidy and lets us test the modal in isolation later.
 *
 * Auth pattern follows the existing convention: localStorage `access_token`,
 * raw `fetch` with manual `Authorization: Bearer` header. We use raw fetch
 * (not `apiFetch`) for the PDF download because we need the binary blob.
 */

import { useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { useModalA11y } from '@/components/ui/use-modal-a11y';

const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001';

function getToken(): string | null {
  if (typeof window === 'undefined') return null;
  return localStorage.getItem('access_token');
}

function authHeaders(): HeadersInit {
  return {
    Authorization: `Bearer ${getToken()}`,
    'Content-Type': 'application/json',
  };
}

// Default range: 1st of current month → today (local TZ).
function defaultRange(): { from: string; to: string } {
  const now = new Date();
  const first = new Date(now.getFullYear(), now.getMonth(), 1);
  const yyyy = (d: Date) => d.toISOString().slice(0, 10);
  return { from: yyyy(first), to: yyyy(now) };
}

function slugify(s: string | null | undefined): string {
  if (!s) return 'client';
  return (
    s
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '') || 'client'
  );
}

// ─── Types (mirror StatementResult from the API) ──────────────────────

interface StatementCurrency {
  id: string;
  code: string | null;
  name: string;
  symbol: string;
}

interface StatementTransaction {
  date: string;
  type: 'invoice' | 'payment' | 'credit_note';
  reference: string;
  description: string;
  debit: number;
  credit: number;
  balance: number;
}

interface StatementData {
  client: {
    id: string;
    company: string;
    address: string | null;
    city: string | null;
    state: string | null;
    country: string | null;
    vat: string | null;
  };
  currency: StatementCurrency | null;
  dateRange: { from: string | null; to: string | null };
  openingBalance: number;
  closingBalance: number;
  transactions: StatementTransaction[];
  totals: { debit: number; credit: number };
  skipCount: number;
}

const TYPE_LABELS: Record<StatementTransaction['type'], string> = {
  invoice: 'Invoice',
  payment: 'Payment',
  credit_note: 'Credit Note',
};

const TYPE_BADGE: Record<StatementTransaction['type'], string> = {
  invoice: 'bg-amber-100 text-amber-700',
  payment: 'bg-green-100 text-green-700',
  credit_note: 'bg-blue-100 text-blue-700',
};

function fmtMoney(
  v: number,
  currency: StatementCurrency | null | undefined,
): string {
  const fixed = Number(v ?? 0).toFixed(2);
  if (!currency) return fixed;
  return `${currency.code ?? currency.symbol ?? ''} ${fixed}`.trim();
}

function fmtDate(iso: string | null | undefined): string {
  if (!iso) return '—';
  try {
    return new Date(iso).toLocaleDateString('en-GB', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
    });
  } catch {
    return '—';
  }
}

// ─── Component ────────────────────────────────────────────────────────

export interface ClientStatementModalProps {
  open: boolean;
  onClose: () => void;
  clientId: string;
  clientCompany: string;
}

export default function ClientStatementModal({
  open,
  onClose,
  clientId,
  clientCompany,
}: ClientStatementModalProps) {
  const containerRef = useModalA11y(open, onClose);

  const initialRange = useMemo(defaultRange, []);
  const [from, setFrom] = useState(initialRange.from);
  const [to, setTo] = useState(initialRange.to);

  const [previewing, setPreviewing] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const [data, setData] = useState<StatementData | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Reset state every time the modal is reopened.
  useEffect(() => {
    if (!open) return;
    setFrom(initialRange.from);
    setTo(initialRange.to);
    setData(null);
    setError(null);
  }, [open, initialRange]);

  function buildQuery(format: 'html' | 'pdf'): string {
    const params = new URLSearchParams();
    if (from) params.set('from', from);
    if (to) params.set('to', to);
    params.set('format', format);
    return params.toString();
  }

  async function handlePreview() {
    if (!from || !to) {
      setError('Please pick both From and To dates');
      return;
    }
    if (from > to) {
      setError('"From" must be on or before "To"');
      return;
    }
    setPreviewing(true);
    setError(null);
    try {
      const res = await fetch(
        `${API_BASE}/api/v1/clients/${clientId}/statement?${buildQuery('html')}`,
        { headers: authHeaders() },
      );
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        throw new Error(j.message || `Failed (${res.status})`);
      }
      const json: StatementData = await res.json();
      setData(json);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load statement');
      setData(null);
    } finally {
      setPreviewing(false);
    }
  }

  async function handleDownload() {
    if (!from || !to) {
      setError('Please pick both From and To dates');
      return;
    }
    if (from > to) {
      setError('"From" must be on or before "To"');
      return;
    }
    setDownloading(true);
    setError(null);
    try {
      const res = await fetch(
        `${API_BASE}/api/v1/clients/${clientId}/statement?${buildQuery('pdf')}`,
        {
          headers: { Authorization: `Bearer ${getToken()}`, Accept: 'application/pdf' },
        },
      );
      if (!res.ok) {
        // Server may return JSON for errors even when format=pdf was requested
        let msg = `Failed (${res.status})`;
        try {
          const j = await res.json();
          if (j?.message) msg = String(j.message);
        } catch {
          /* ignore */
        }
        throw new Error(msg);
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      const stamp = new Date().toISOString().slice(0, 10).replace(/-/g, '');
      a.download = `statement-${slugify(clientCompany)}-${stamp}.pdf`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 0);
      toast.success('Statement downloaded');
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to download';
      setError(msg);
      toast.error(msg);
    } finally {
      setDownloading(false);
    }
  }

  if (!open) return null;

  function handleBackdrop(e: React.MouseEvent<HTMLDivElement>) {
    if (e.target === e.currentTarget) onClose();
  }

  const inputClass =
    'w-full px-3 py-2 text-sm border border-gray-200 dark:border-gray-700 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary bg-white dark:bg-gray-900';

  return (
    <div
      onClick={handleBackdrop}
      className="fixed inset-0 z-50 flex items-start justify-center bg-black/40 backdrop-blur-sm overflow-y-auto"
    >
      <div
        ref={containerRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="client-statement-modal-title"
        className="bg-white dark:bg-gray-900 rounded-xl shadow-2xl max-w-4xl w-full mx-4 mt-12 mb-10"
      >
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100 dark:border-gray-800">
          <div>
            <h2
              id="client-statement-modal-title"
              className="text-lg font-semibold text-gray-900 dark:text-gray-100"
            >
              Statement of Account
            </h2>
            <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
              {clientCompany}
            </p>
          </div>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-gray-600 text-2xl leading-none p-1"
            aria-label="Close"
          >
            &times;
          </button>
        </div>

        {/* Date pickers */}
        <div className="px-6 py-5 border-b border-gray-100 dark:border-gray-800 grid grid-cols-1 sm:grid-cols-3 gap-4 items-end">
          <div>
            <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">
              From
            </label>
            <input
              type="date"
              value={from}
              onChange={(e) => setFrom(e.target.value)}
              className={inputClass}
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">
              To
            </label>
            <input
              type="date"
              value={to}
              onChange={(e) => setTo(e.target.value)}
              className={inputClass}
            />
          </div>
          <div className="flex gap-2">
            <Button
              variant="secondary"
              size="md"
              onClick={handlePreview}
              loading={previewing}
              disabled={previewing || downloading}
            >
              Preview on screen
            </Button>
            <Button
              variant="primary"
              size="md"
              onClick={handleDownload}
              loading={downloading}
              disabled={previewing || downloading}
            >
              Download PDF
            </Button>
          </div>
        </div>

        {/* Body */}
        <div className="px-6 py-5">
          {error && (
            <div className="mb-4 px-3 py-2 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 text-sm text-red-700 dark:text-red-300 rounded-lg">
              {error}
            </div>
          )}

          {!data && !previewing && (
            <p className="text-sm text-gray-500 dark:text-gray-400 text-center py-12">
              Pick a date range and click <strong>Preview on screen</strong> to
              see the statement, or <strong>Download PDF</strong> to save it.
            </p>
          )}

          {previewing && (
            <p className="text-sm text-gray-500 dark:text-gray-400 text-center py-12">
              Loading statement…
            </p>
          )}

          {data && (
            <StatementPreview data={data} />
          )}
        </div>

        {/* Footer */}
        <div className="flex justify-end gap-3 px-6 py-4 border-t border-gray-100 dark:border-gray-800">
          <Button variant="secondary" onClick={onClose}>
            Close
          </Button>
        </div>
      </div>
    </div>
  );
}

// ─── On-screen preview ────────────────────────────────────────────────
//
// Same data and same opening/closing summary as the PDF, but rendered with
// the app's existing on-screen styles (light cards, stripe rows, status
// pills) — *not* the full A4 layout. Trade-off: the user sees the same
// numbers, but the on-screen layout is denser. The PDF is the canonical
// document for sending to clients.

function StatementPreview({ data }: { data: StatementData }) {
  const periodLabel =
    data.dateRange.from && data.dateRange.to
      ? `${fmtDate(data.dateRange.from)} — ${fmtDate(data.dateRange.to)}`
      : 'All time';

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
        <div className="text-gray-500 dark:text-gray-400">
          Period: <span className="font-medium text-gray-800 dark:text-gray-200">{periodLabel}</span>
          {data.currency && (
            <>
              <span className="mx-2 text-gray-300">•</span>
              Currency:{' '}
              <span className="font-medium text-gray-800 dark:text-gray-200">
                {data.currency.code ?? data.currency.name}
              </span>
            </>
          )}
        </div>
        <div className="flex gap-4">
          <div>
            <span className="text-gray-500 dark:text-gray-400">Opening</span>{' '}
            <span className="font-semibold text-gray-900 dark:text-gray-100">
              {fmtMoney(data.openingBalance, data.currency)}
            </span>
          </div>
          <div>
            <span className="text-gray-500 dark:text-gray-400">Closing</span>{' '}
            <span className="font-semibold text-primary">
              {fmtMoney(data.closingBalance, data.currency)}
            </span>
          </div>
        </div>
      </div>

      <div className="overflow-x-auto border border-gray-200 dark:border-gray-700 rounded-lg">
        <table className="min-w-full text-sm">
          <thead>
            <tr className="bg-gray-50 dark:bg-gray-900 border-b border-gray-100 dark:border-gray-800 text-left text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide">
              <th className="px-3 py-2">Date</th>
              <th className="px-3 py-2">Reference</th>
              <th className="px-3 py-2">Description</th>
              <th className="px-3 py-2 text-right">Debit</th>
              <th className="px-3 py-2 text-right">Credit</th>
              <th className="px-3 py-2 text-right">Balance</th>
            </tr>
          </thead>
          <tbody>
            {/* Opening balance row */}
            <tr className="bg-blue-50 dark:bg-blue-900/20 font-semibold border-b-2 border-primary/30">
              <td className="px-3 py-2">{fmtDate(data.dateRange.from)}</td>
              <td className="px-3 py-2"></td>
              <td className="px-3 py-2 italic text-gray-700 dark:text-gray-300">
                Opening balance
              </td>
              <td className="px-3 py-2"></td>
              <td className="px-3 py-2"></td>
              <td className="px-3 py-2 text-right tabular-nums">
                {fmtMoney(data.openingBalance, data.currency)}
              </td>
            </tr>

            {data.transactions.length === 0 && (
              <tr>
                <td
                  colSpan={6}
                  className="px-3 py-10 text-center text-sm text-gray-400 dark:text-gray-500"
                >
                  No transactions in this period
                </td>
              </tr>
            )}

            {data.transactions.map((t, i) => (
              <tr
                key={`${t.type}-${t.reference}-${i}`}
                className="border-b border-gray-100 dark:border-gray-800 last:border-0 hover:bg-gray-50/60 dark:hover:bg-gray-800/40"
              >
                <td className="px-3 py-2 text-gray-700 dark:text-gray-300 whitespace-nowrap">
                  {fmtDate(t.date)}
                </td>
                <td className="px-3 py-2 text-gray-700 dark:text-gray-300">
                  {t.reference}
                </td>
                <td className="px-3 py-2">
                  <span
                    className={`inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-medium ${TYPE_BADGE[t.type]}`}
                  >
                    {TYPE_LABELS[t.type]}
                  </span>
                  {t.description && t.description !== TYPE_LABELS[t.type] && (
                    <span className="ml-2 text-xs text-gray-500 dark:text-gray-400">
                      {t.description}
                    </span>
                  )}
                </td>
                <td className="px-3 py-2 text-right tabular-nums text-gray-900 dark:text-gray-100">
                  {t.debit ? fmtMoney(t.debit, data.currency) : ''}
                </td>
                <td className="px-3 py-2 text-right tabular-nums text-gray-900 dark:text-gray-100">
                  {t.credit ? fmtMoney(t.credit, data.currency) : ''}
                </td>
                <td className="px-3 py-2 text-right tabular-nums text-gray-700 dark:text-gray-300">
                  {fmtMoney(t.balance, data.currency)}
                </td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr className="bg-gray-50 dark:bg-gray-900 border-t border-gray-200 dark:border-gray-700 text-sm font-semibold">
              <td className="px-3 py-3" colSpan={3}>
                Closing balance
              </td>
              <td className="px-3 py-3 text-right tabular-nums">
                {fmtMoney(data.totals.debit, data.currency)}
              </td>
              <td className="px-3 py-3 text-right tabular-nums">
                {fmtMoney(data.totals.credit, data.currency)}
              </td>
              <td className="px-3 py-3 text-right tabular-nums text-primary">
                {fmtMoney(data.closingBalance, data.currency)}
              </td>
            </tr>
          </tfoot>
        </table>
      </div>

      {data.skipCount > 0 && (
        <p className="text-xs text-amber-700 dark:text-amber-300 bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 rounded-lg px-3 py-2">
          {data.skipCount} transaction{data.skipCount === 1 ? '' : 's'} in other
          currencies {data.skipCount === 1 ? 'is' : 'are'} not shown.
        </p>
      )}
    </div>
  );
}
