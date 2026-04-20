'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';

const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001';

interface InvoiceRow {
  id: string;
  number?: string;
  date: string;
  total: number | string;
  status?: string;
}

interface PaymentRow {
  id: string;
  amount: number | string;
  paymentDate: string;
  transactionId?: string;
}

interface LedgerLine {
  date: string;
  reference: string;
  description: string;
  debit: number;
  credit: number;
  balance: number;
}

function getToken(): string | null {
  if (typeof window === 'undefined') return null;
  return localStorage.getItem('access_token');
}

function toNumber(v: number | string | undefined): number {
  if (v == null) return 0;
  return typeof v === 'number' ? v : Number(v) || 0;
}

function formatMoney(n: number): string {
  return n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function formatDate(iso: string): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString();
}

export default function PortalStatementPage() {
  const router = useRouter();

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [clientId, setClientId] = useState<string | null>(null);
  const [company, setCompany] = useState<string | null>(null);
  const [ledger, setLedger] = useState<LedgerLine[]>([]);
  const [downloading, setDownloading] = useState(false);
  const [noClient, setNoClient] = useState(false);

  // NOTE: The backend getStatement(orgId, clientId) does not accept from/to query
  // params, so the date range selector described in the spec is omitted. The
  // server returns all invoices + payments for the client.

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

        const cid: string | null = me.clientId ?? me.client?.id ?? null;
        if (!cid) {
          setNoClient(true);
          setLoading(false);
          return;
        }
        setClientId(cid);
        setCompany(me.client?.company ?? null);

        const stRes = await fetch(`${API_BASE}/api/v1/clients/${cid}/statement`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (!stRes.ok) throw new Error(`Failed to load statement (${stRes.status})`);
        const stJson = await stRes.json();
        const data = stJson.data ?? stJson;

        const invoices: InvoiceRow[] = data.invoices ?? [];
        const payments: PaymentRow[] = data.payments ?? [];

        // Merge + sort ascending by date, then compute running balance.
        type Entry = { date: string; type: 'invoice' | 'payment'; row: any };
        const entries: Entry[] = [
          ...invoices.map((inv) => ({ date: inv.date, type: 'invoice' as const, row: inv })),
          ...payments.map((p) => ({ date: p.paymentDate, type: 'payment' as const, row: p })),
        ];
        entries.sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());

        let balance = 0;
        const lines: LedgerLine[] = entries.map((e) => {
          if (e.type === 'invoice') {
            const amt = toNumber(e.row.total);
            balance += amt;
            return {
              date: e.date,
              reference: e.row.number ?? e.row.id.slice(0, 8),
              description: `Invoice${e.row.status ? ` (${e.row.status})` : ''}`,
              debit: amt,
              credit: 0,
              balance,
            };
          }
          const amt = toNumber(e.row.amount);
          balance -= amt;
          return {
            date: e.date,
            reference: e.row.transactionId ?? e.row.id.slice(0, 8),
            description: 'Payment received',
            debit: 0,
            credit: amt,
            balance,
          };
        });

        setLedger(lines);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load statement');
      } finally {
        setLoading(false);
      }
    })();
  }, [router]);

  async function downloadPdf() {
    if (!clientId) return;
    const token = getToken();
    if (!token) {
      router.push('/portal/login');
      return;
    }
    setDownloading(true);
    setError(null);
    try {
      const res = await fetch(`${API_BASE}/api/v1/clients/${clientId}/statement/pdf`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) throw new Error(`Download failed (${res.status})`);
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `statement-${company?.replace(/\s+/g, '-') ?? clientId}.pdf`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Download failed');
    } finally {
      setDownloading(false);
    }
  }

  if (loading) {
    return (
      <div>
        <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100 mb-6">Statement</h1>
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
        <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100 mb-6">Statement</h1>
        <div className="bg-white dark:bg-gray-900 rounded-xl border border-gray-100 dark:border-gray-800 shadow-sm p-8 text-center">
          <p className="text-gray-700 dark:text-gray-300 font-medium">Statement unavailable</p>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
            Your account is not linked to a client record yet. Please contact support.
          </p>
        </div>
      </div>
    );
  }

  const total = ledger.length ? ledger[ledger.length - 1].balance : 0;

  return (
    <div>
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">Statement</h1>
          {company && <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">{company}</p>}
        </div>
        <button
          onClick={downloadPdf}
          disabled={downloading || !clientId}
          className="px-4 py-2.5 bg-primary text-white rounded-lg font-medium hover:bg-primary/90 disabled:opacity-50 text-sm"
        >
          {downloading ? 'Downloading…' : 'Download PDF'}
        </button>
      </div>

      {error && (
        <div className="mb-4 px-4 py-3 bg-red-50 border border-red-100 text-sm text-red-600 rounded-lg">{error}</div>
      )}

      <div className="bg-white dark:bg-gray-900 rounded-xl border border-gray-100 dark:border-gray-800 shadow-sm overflow-hidden">
        {ledger.length === 0 ? (
          <div className="p-8 text-center text-sm text-gray-500 dark:text-gray-400">No transactions on your account yet.</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead className="bg-gray-50 dark:bg-gray-900 text-xs text-gray-500 dark:text-gray-400 uppercase tracking-wide">
                <tr>
                  <th className="px-4 py-3 text-left font-medium">Date</th>
                  <th className="px-4 py-3 text-left font-medium">Reference</th>
                  <th className="px-4 py-3 text-left font-medium">Description</th>
                  <th className="px-4 py-3 text-right font-medium">Debit</th>
                  <th className="px-4 py-3 text-right font-medium">Credit</th>
                  <th className="px-4 py-3 text-right font-medium">Balance</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
                {ledger.map((line, i) => (
                  <tr key={i} className="hover:bg-gray-50 dark:hover:bg-gray-800">
                    <td className="px-4 py-3 text-gray-700 dark:text-gray-300 whitespace-nowrap">{formatDate(line.date)}</td>
                    <td className="px-4 py-3 text-gray-900 dark:text-gray-100 font-medium whitespace-nowrap">{line.reference}</td>
                    <td className="px-4 py-3 text-gray-600 dark:text-gray-400">{line.description}</td>
                    <td className="px-4 py-3 text-right tabular-nums text-gray-900 dark:text-gray-100">
                      {line.debit ? formatMoney(line.debit) : ''}
                    </td>
                    <td className="px-4 py-3 text-right tabular-nums text-gray-900 dark:text-gray-100">
                      {line.credit ? formatMoney(line.credit) : ''}
                    </td>
                    <td className="px-4 py-3 text-right tabular-nums font-medium text-gray-900 dark:text-gray-100">
                      {formatMoney(line.balance)}
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot className="bg-gray-50 dark:bg-gray-900">
                <tr>
                  <td colSpan={5} className="px-4 py-3 text-right text-xs uppercase tracking-wide text-gray-500 dark:text-gray-400 font-medium">
                    Balance due
                  </td>
                  <td className="px-4 py-3 text-right tabular-nums font-bold text-gray-900 dark:text-gray-100">{formatMoney(total)}</td>
                </tr>
              </tfoot>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
