'use client';

import { useState, useEffect, useCallback, useMemo } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';

interface Client {
  id: string;
  company?: string;
  company_name?: string;
}

interface Invoice {
  id: string;
  number: string;
  total: number | string;
  status: string;
  currency?: string;
  payments?: { amount: number | string }[];
}

interface PaymentMode {
  id: string;
  name: string;
}

interface Row {
  invoiceId: string;
  invoiceNumber: string;
  outstanding: number;
  selected: boolean;
  amount: string;
  paymentDate: string;
  paymentModeId: string;
  note: string;
}

const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001';

function authHeaders(): HeadersInit {
  const token =
    typeof window === 'undefined' ? null : localStorage.getItem('access_token');
  return { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
}

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

export default function BatchPaymentPage() {
  const router = useRouter();
  const [clients, setClients] = useState<Client[]>([]);
  const [clientId, setClientId] = useState('');
  const [rows, setRows] = useState<Row[]>([]);
  const [modes, setModes] = useState<PaymentMode[]>([]);
  const [loadingInvoices, setLoadingInvoices] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Load clients
  useEffect(() => {
    fetch(`${API_BASE}/api/v1/clients?limit=200`, { headers: authHeaders() })
      .then((r) => r.json())
      .then((d) => setClients(d?.data ?? []))
      .catch(() => setClients([]));
    fetch(`${API_BASE}/api/v1/payments/modes`, { headers: authHeaders() })
      .then((r) => r.json())
      .then((d) => setModes(Array.isArray(d) ? d : d?.data ?? []))
      .catch(() => setModes([]));
  }, []);

  const loadInvoices = useCallback(async (cid: string) => {
    if (!cid) {
      setRows([]);
      return;
    }
    setLoadingInvoices(true);
    setError(null);
    try {
      // Fetch unpaid + partial separately then merge (status is a single-value filter here)
      const [unpaidRes, partialRes, sentRes] = await Promise.all([
        fetch(
          `${API_BASE}/api/v1/invoices?clientId=${cid}&status=unpaid&limit=200`,
          { headers: authHeaders() },
        ),
        fetch(
          `${API_BASE}/api/v1/invoices?clientId=${cid}&status=partial&limit=200`,
          { headers: authHeaders() },
        ),
        fetch(
          `${API_BASE}/api/v1/invoices?clientId=${cid}&status=sent&limit=200`,
          { headers: authHeaders() },
        ),
      ]);
      const unpaid = (await unpaidRes.json())?.data ?? [];
      const partial = (await partialRes.json())?.data ?? [];
      const sent = (await sentRes.json())?.data ?? [];
      const merged: Invoice[] = [...unpaid, ...partial, ...sent];

      const enriched: Row[] = await Promise.all(
        merged.map(async (inv) => {
          // fetch payments per invoice to compute outstanding
          let paidSum = 0;
          try {
            const res = await fetch(
              `${API_BASE}/api/v1/payments?invoiceId=${inv.id}&limit=100`,
              { headers: authHeaders() },
            );
            const j = await res.json();
            const arr: any[] = j?.data ?? [];
            paidSum = arr.reduce((acc, p) => acc + Number(p.amount), 0);
          } catch {
            paidSum = 0;
          }
          const outstanding = Math.max(0, Number(inv.total) - paidSum);
          return {
            invoiceId: inv.id,
            invoiceNumber: inv.number,
            outstanding,
            selected: outstanding > 0,
            amount: outstanding.toFixed(2),
            paymentDate: today(),
            paymentModeId: '',
            note: '',
          };
        }),
      );

      setRows(enriched.filter((r) => r.outstanding > 0));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load invoices');
    } finally {
      setLoadingInvoices(false);
    }
  }, []);

  useEffect(() => {
    loadInvoices(clientId);
  }, [clientId, loadInvoices]);

  function updateRow(idx: number, patch: Partial<Row>) {
    setRows((prev) =>
      prev.map((r, i) => (i === idx ? { ...r, ...patch } : r)),
    );
  }

  const selectedCount = useMemo(
    () => rows.filter((r) => r.selected).length,
    [rows],
  );
  const totalAmount = useMemo(
    () =>
      rows
        .filter((r) => r.selected)
        .reduce((acc, r) => acc + (Number(r.amount) || 0), 0),
    [rows],
  );

  async function submit() {
    if (selectedCount === 0) {
      setError('Select at least one invoice to pay');
      return;
    }
    const payments = rows
      .filter((r) => r.selected)
      .map((r) => ({
        invoiceId: r.invoiceId,
        amount: Number(r.amount),
        paymentDate: new Date(r.paymentDate).toISOString(),
        paymentMode: r.paymentModeId || undefined,
        note: r.note || undefined,
      }));

    // Client-side validation: all amounts > 0
    for (const p of payments) {
      if (!(p.amount > 0)) {
        setError('All selected rows must have amount > 0');
        return;
      }
    }

    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch(`${API_BASE}/api/v1/payments/batch`, {
        method: 'POST',
        headers: authHeaders(),
        body: JSON.stringify({ payments }),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        throw new Error(j.message || `Failed ${res.status}`);
      }
      router.push('/payments');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="max-w-6xl mx-auto">
      <div className="flex items-center gap-2 mb-6 text-sm text-gray-500 dark:text-gray-400">
        <Link href="/payments" className="hover:text-primary">
          Payments
        </Link>
        <span>/</span>
        <span className="text-gray-900 dark:text-gray-100 font-medium">Batch record</span>
      </div>

      <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100 mb-6">
        Record payments (batch)
      </h1>

      <div className="bg-white dark:bg-gray-900 rounded-xl border border-gray-100 dark:border-gray-800 shadow-sm p-6 mb-6">
        <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">
          Client *
        </label>
        <select
          value={clientId}
          onChange={(e) => setClientId(e.target.value)}
          className="w-full sm:w-1/2 px-3 py-2 text-sm border border-gray-200 dark:border-gray-700 rounded-lg bg-white dark:bg-gray-900"
        >
          <option value="">— Select client —</option>
          {clients.map((c) => (
            <option key={c.id} value={c.id}>
              {c.company ?? c.company_name}
            </option>
          ))}
        </select>
      </div>

      {error && (
        <div className="mb-4 px-3 py-2 bg-red-50 border border-red-100 text-red-600 text-sm rounded-lg">
          {error}
        </div>
      )}

      {clientId && (
        <div className="bg-white dark:bg-gray-900 rounded-xl border border-gray-100 dark:border-gray-800 shadow-sm overflow-hidden">
          <div className="overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead>
                <tr className="bg-gray-50 dark:bg-gray-900 border-b border-gray-100 dark:border-gray-800 text-left text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide">
                  <th className="px-3 py-3 w-8"></th>
                  <th className="px-3 py-3">Invoice #</th>
                  <th className="px-3 py-3 text-right">Outstanding</th>
                  <th className="px-3 py-3 text-right">Amount</th>
                  <th className="px-3 py-3">Date</th>
                  <th className="px-3 py-3">Mode</th>
                  <th className="px-3 py-3">Note</th>
                </tr>
              </thead>
              <tbody>
                {loadingInvoices ? (
                  <tr>
                    <td
                      colSpan={7}
                      className="px-4 py-12 text-center text-gray-400 dark:text-gray-500"
                    >
                      Loading invoices…
                    </td>
                  </tr>
                ) : rows.length === 0 ? (
                  <tr>
                    <td
                      colSpan={7}
                      className="px-4 py-12 text-center text-gray-400 dark:text-gray-500"
                    >
                      No unpaid or partial invoices for this client
                    </td>
                  </tr>
                ) : (
                  rows.map((r, idx) => (
                    <tr
                      key={r.invoiceId}
                      className="border-b border-gray-100 dark:border-gray-800 last:border-0 hover:bg-gray-50/60"
                    >
                      <td className="px-3 py-2">
                        <input
                          type="checkbox"
                          checked={r.selected}
                          onChange={(e) =>
                            updateRow(idx, { selected: e.target.checked })
                          }
                        />
                      </td>
                      <td className="px-3 py-2 font-medium text-gray-900 dark:text-gray-100">
                        {r.invoiceNumber}
                      </td>
                      <td className="px-3 py-2 text-right text-gray-600 dark:text-gray-400">
                        {r.outstanding.toFixed(2)}
                      </td>
                      <td className="px-3 py-2 text-right">
                        <input
                          type="number"
                          step="0.01"
                          min="0"
                          value={r.amount}
                          onChange={(e) =>
                            updateRow(idx, { amount: e.target.value })
                          }
                          className="w-28 px-2 py-1 text-sm border border-gray-200 dark:border-gray-700 rounded-md text-right"
                        />
                      </td>
                      <td className="px-3 py-2">
                        <input
                          type="date"
                          value={r.paymentDate}
                          onChange={(e) =>
                            updateRow(idx, { paymentDate: e.target.value })
                          }
                          className="px-2 py-1 text-sm border border-gray-200 dark:border-gray-700 rounded-md"
                        />
                      </td>
                      <td className="px-3 py-2">
                        <select
                          value={r.paymentModeId}
                          onChange={(e) =>
                            updateRow(idx, { paymentModeId: e.target.value })
                          }
                          className="px-2 py-1 text-sm border border-gray-200 dark:border-gray-700 rounded-md bg-white dark:bg-gray-900"
                        >
                          <option value="">—</option>
                          {modes.map((m) => (
                            <option key={m.id} value={m.id}>
                              {m.name}
                            </option>
                          ))}
                        </select>
                      </td>
                      <td className="px-3 py-2">
                        <input
                          type="text"
                          value={r.note}
                          onChange={(e) =>
                            updateRow(idx, { note: e.target.value })
                          }
                          className="w-full px-2 py-1 text-sm border border-gray-200 dark:border-gray-700 rounded-md"
                        />
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>

          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 p-4 border-t border-gray-100 dark:border-gray-800 bg-gray-50 dark:bg-gray-900">
            <div className="text-sm text-gray-700 dark:text-gray-300">
              <span className="font-medium">{selectedCount}</span> invoice(s)
              selected · Total{' '}
              <span className="font-semibold text-gray-900 dark:text-gray-100">
                {totalAmount.toFixed(2)}
              </span>
            </div>
            <div className="flex gap-2">
              <Link
                href="/payments"
                className="px-4 py-2 text-sm border border-gray-200 dark:border-gray-700 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-800"
              >
                Cancel
              </Link>
              <button
                onClick={submit}
                disabled={submitting || selectedCount === 0}
                className="px-4 py-2 text-sm font-medium bg-primary text-white rounded-lg hover:bg-primary/90 disabled:opacity-50"
              >
                {submitting ? 'Recording…' : 'Record payments'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
