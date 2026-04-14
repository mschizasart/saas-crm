'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';

interface Invoice {
  id: string;
  number: string;
  date: string;
  dueDate: string;
  total: number;
  currency: string;
  status: string;
}

const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001';

function getToken(): string | null {
  if (typeof window === 'undefined') return null;
  return localStorage.getItem('access_token');
}

const STATUS_COLORS: Record<string, string> = {
  draft: 'bg-gray-100 text-gray-700',
  sent: 'bg-blue-100 text-blue-700',
  paid: 'bg-green-100 text-green-700',
  overdue: 'bg-red-100 text-red-700',
};

export default function PortalInvoicesPage() {
  const [items, setItems] = useState<Invoice[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch(`${API_BASE}/api/v1/portal/invoices`, { headers: { Authorization: `Bearer ${getToken()}` } });
        if (!res.ok) throw new Error(`Failed (${res.status})`);
        const json = await res.json();
        setItems(json.data ?? json ?? []);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed');
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  return (
    <div>
      <h1 className="text-2xl font-bold text-gray-900 mb-6">Your Invoices</h1>

      {error && <div className="mb-4 px-4 py-3 bg-red-50 border border-red-100 text-sm text-red-600 rounded-lg">{error}</div>}

      <div className="bg-white rounded-xl border border-gray-100 shadow-sm overflow-hidden">
        <table className="min-w-full text-sm">
          <thead>
            <tr className="bg-gray-50 border-b border-gray-100 text-left text-xs font-semibold text-gray-500 uppercase">
              <th className="px-4 py-3">Number</th>
              <th className="px-4 py-3">Date</th>
              <th className="px-4 py-3">Due</th>
              <th className="px-4 py-3">Amount</th>
              <th className="px-4 py-3">Status</th>
              <th className="px-4 py-3 text-right">Actions</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              Array.from({ length: 5 }).map((_, i) => (
                <tr key={i} className="border-b border-gray-100">
                  {Array.from({ length: 6 }).map((__, j) => (
                    <td key={j} className="px-4 py-3"><div className="h-4 bg-gray-100 rounded animate-pulse" /></td>
                  ))}
                </tr>
              ))
            ) : items.length === 0 ? (
              <tr><td colSpan={6} className="px-4 py-12 text-center text-sm text-gray-400">No invoices yet</td></tr>
            ) : items.map((inv) => (
              <tr key={inv.id} className="border-b border-gray-100 hover:bg-gray-50/60">
                <td className="px-4 py-3 font-medium text-gray-900">
                  <Link href={`/invoices/${inv.id}`} className="hover:text-primary">{inv.number}</Link>
                </td>
                <td className="px-4 py-3 text-gray-600">{inv.date ? new Date(inv.date).toLocaleDateString() : '—'}</td>
                <td className="px-4 py-3 text-gray-600">{inv.dueDate ? new Date(inv.dueDate).toLocaleDateString() : '—'}</td>
                <td className="px-4 py-3 tabular-nums">{inv.total?.toFixed?.(2) ?? inv.total} {inv.currency}</td>
                <td className="px-4 py-3">
                  <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${STATUS_COLORS[inv.status] ?? 'bg-gray-100 text-gray-700'}`}>
                    {inv.status}
                  </span>
                </td>
                <td className="px-4 py-3 text-right">
                  <div className="flex items-center justify-end gap-3">
                    <button className="text-xs text-gray-500 hover:text-primary">PDF</button>
                    {inv.status !== 'paid' && (
                      <button className="text-xs px-3 py-1 bg-primary text-white rounded hover:bg-primary/90">Pay Now</button>
                    )}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
