'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';

interface Item {
  id?: string;
  description: string;
  quantity: number;
  unitPrice: number;
  taxRate: number;
}

interface Invoice {
  id: string;
  number: string;
  date: string;
  dueDate: string;
  currency: string;
  status: string;
  subtotal: number;
  tax: number;
  discount: number;
  total: number;
  amountPaid?: number;
  notes?: string;
  items: Item[];
}

const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001';

function getToken(): string | null {
  if (typeof window === 'undefined') return null;
  return localStorage.getItem('access_token');
}

export default function PortalInvoiceDetailPage() {
  const { id } = useParams() as { id: string };
  const [inv, setInv] = useState<Invoice | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [gateway, setGateway] = useState<'stripe' | 'paypal' | 'mollie'>('stripe');
  const [paying, setPaying] = useState(false);
  const [payError, setPayError] = useState<string | null>(null);

  const handlePay = async () => {
    if (!inv) return;
    setPaying(true);
    setPayError(null);
    try {
      const res = await fetch(`${API_BASE}/api/v1/payments/checkout/${inv.id}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          gateway,
          successUrl: window.location.href,
          cancelUrl: window.location.href,
        }),
      });
      if (!res.ok) throw new Error(`Checkout failed (${res.status})`);
      const data = await res.json();
      if (data.checkoutUrl) {
        window.location.href = data.checkoutUrl;
      } else {
        throw new Error('No checkout URL returned');
      }
    } catch (err) {
      setPayError(err instanceof Error ? err.message : 'Failed to start checkout');
      setPaying(false);
    }
  };

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch(`${API_BASE}/api/v1/portal/invoices/${id}`, { headers: { Authorization: `Bearer ${getToken()}` } });
        if (!res.ok) throw new Error(`Failed (${res.status})`);
        const json = await res.json();
        setInv(json.data ?? json);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed');
      } finally {
        setLoading(false);
      }
    })();
  }, [id]);

  if (loading) return <div className="animate-pulse h-96 bg-gray-100 rounded-xl" />;
  if (error || !inv) return <div className="text-red-600">{error ?? 'Not found'}</div>;

  const balance = inv.total - (inv.amountPaid ?? 0);

  return (
    <div>
      <div className="mb-4"><Link href="/portal/invoices" className="text-sm text-gray-500 hover:text-primary">← Back to invoices</Link></div>

      <div className="flex items-start justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Invoice {inv.number}</h1>
          <p className="text-sm text-gray-500 mt-1">
            Issued {inv.date ? new Date(inv.date).toLocaleDateString() : '—'} · Due {inv.dueDate ? new Date(inv.dueDate).toLocaleDateString() : '—'}
          </p>
        </div>
        <span className="inline-flex items-center px-3 py-1 rounded-full text-xs font-medium bg-primary/10 text-primary">{inv.status}</span>
      </div>

      <div className="bg-white rounded-xl border border-gray-100 shadow-sm overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 text-left text-xs text-gray-500 uppercase">
            <tr>
              <th className="px-4 py-3">Description</th>
              <th className="px-4 py-3 w-20 text-right">Qty</th>
              <th className="px-4 py-3 w-28 text-right">Unit</th>
              <th className="px-4 py-3 w-28 text-right">Amount</th>
            </tr>
          </thead>
          <tbody>
            {inv.items.map((it, i) => (
              <tr key={it.id ?? i} className="border-t border-gray-100">
                <td className="px-4 py-3">{it.description}</td>
                <td className="px-4 py-3 text-right tabular-nums">{it.quantity}</td>
                <td className="px-4 py-3 text-right tabular-nums">{it.unitPrice.toFixed(2)}</td>
                <td className="px-4 py-3 text-right tabular-nums">{(it.quantity * it.unitPrice).toFixed(2)}</td>
              </tr>
            ))}
          </tbody>
        </table>

        <div className="flex justify-end p-4 border-t border-gray-100 bg-gray-50/50">
          <div className="w-64 text-sm space-y-1">
            <Row label="Subtotal" value={inv.subtotal?.toFixed?.(2) ?? inv.subtotal} />
            <Row label="Tax" value={inv.tax?.toFixed?.(2) ?? inv.tax} />
            <Row label="Discount" value={`-${inv.discount?.toFixed?.(2) ?? inv.discount}`} />
            <div className="border-t border-gray-200 mt-2 pt-2">
              <Row label="Total" value={`${inv.total?.toFixed?.(2) ?? inv.total} ${inv.currency}`} bold />
              {inv.amountPaid != null && inv.amountPaid > 0 && (
                <Row label="Paid" value={inv.amountPaid.toFixed(2)} />
              )}
              {balance > 0 && <Row label="Balance Due" value={balance.toFixed(2)} bold />}
            </div>
          </div>
        </div>
      </div>

      {balance > 0 && inv.status !== 'paid' && (
        <div className="mt-6 flex flex-col items-end gap-2">
          {payError && <p className="text-xs text-red-600">{payError}</p>}
          <div className="flex items-center justify-end gap-3">
            <button className="px-4 py-2 border border-gray-200 text-sm rounded-lg hover:bg-gray-50">Download PDF</button>
            <select
              value={gateway}
              onChange={(e) => setGateway(e.target.value as 'stripe' | 'paypal' | 'mollie')}
              className="px-3 py-2 border border-gray-200 text-sm rounded-lg bg-white"
              disabled={paying}
            >
              <option value="stripe">Stripe</option>
              <option value="paypal">PayPal</option>
              <option value="mollie">Mollie</option>
            </select>
            <button
              onClick={handlePay}
              disabled={paying}
              className="px-4 py-2 bg-primary text-white text-sm font-medium rounded-lg hover:bg-primary/90 disabled:opacity-50"
            >
              {paying ? 'Redirecting…' : 'Pay Now'}
            </button>
          </div>
        </div>
      )}

      {inv.notes && (
        <div className="mt-6 bg-white rounded-xl border border-gray-100 p-4">
          <h3 className="text-xs font-semibold text-gray-500 uppercase mb-2">Notes</h3>
          <p className="text-sm text-gray-700 whitespace-pre-wrap">{inv.notes}</p>
        </div>
      )}
    </div>
  );
}

function Row({ label, value, bold }: { label: string; value: React.ReactNode; bold?: boolean }) {
  return (
    <div className={`flex justify-between ${bold ? 'font-semibold text-gray-900' : 'text-gray-600'}`}>
      <span>{label}</span><span className="tabular-nums">{value}</span>
    </div>
  );
}
