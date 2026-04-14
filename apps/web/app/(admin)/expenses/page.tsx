'use client';

import { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';

interface Expense {
  id: string;
  name: string;
  amount: number;
  date: string;
  billable: boolean;
  category?: { id: string; name: string } | null;
  client?: { id: string; company?: string; company_name?: string } | null;
}

interface Category { id: string; name: string; }
interface ClientOption { id: string; company?: string; company_name?: string; }

interface Stats { total?: number; billable?: number; reimbursed?: number; }

const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001';

function getToken(): string | null {
  if (typeof window === 'undefined') return null;
  return localStorage.getItem('access_token');
}

export default function ExpensesPage() {
  const [expenses, setExpenses] = useState<Expense[]>([]);
  const [stats, setStats] = useState<Stats>({});
  const [categories, setCategories] = useState<Category[]>([]);
  const [clients, setClients] = useState<ClientOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [categoryId, setCategoryId] = useState('');
  const [clientId, setClientId] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (categoryId) params.set('categoryId', categoryId);
      if (clientId) params.set('clientId', clientId);
      if (from) params.set('from', from);
      if (to) params.set('to', to);
      const [lRes, sRes] = await Promise.all([
        fetch(`${API_BASE}/api/v1/expenses?${params}`, { headers: { Authorization: `Bearer ${getToken()}` } }),
        fetch(`${API_BASE}/api/v1/expenses/stats`, { headers: { Authorization: `Bearer ${getToken()}` } }),
      ]);
      if (!lRes.ok) throw new Error(`Failed (${lRes.status})`);
      const json = await lRes.json();
      setExpenses(json.data ?? json ?? []);
      if (sRes.ok) setStats(await sRes.json());
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed');
    } finally {
      setLoading(false);
    }
  }, [categoryId, clientId, from, to]);

  useEffect(() => {
    (async () => {
      try {
        const [catRes, cRes] = await Promise.all([
          fetch(`${API_BASE}/api/v1/expenses/categories`, { headers: { Authorization: `Bearer ${getToken()}` } }),
          fetch(`${API_BASE}/api/v1/clients?limit=100`, { headers: { Authorization: `Bearer ${getToken()}` } }),
        ]);
        if (catRes.ok) {
          const j = await catRes.json();
          setCategories(Array.isArray(j) ? j : j.data ?? []);
        }
        if (cRes.ok) setClients((await cRes.json()).data ?? []);
      } catch { /* ignore */ }
    })();
  }, []);

  useEffect(() => { fetchData(); }, [fetchData]);

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold text-gray-900">Expenses</h1>
        <Link href="/expenses/new" className="inline-flex items-center gap-1.5 bg-primary text-white text-sm font-medium px-4 py-2 rounded-lg hover:bg-primary/90">
          <span className="text-lg leading-none">+</span>New Expense
        </Link>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-6">
        <StatCard label="Total" value={stats.total ?? 0} />
        <StatCard label="Billable" value={stats.billable ?? 0} />
        <StatCard label="Reimbursed" value={stats.reimbursed ?? 0} />
      </div>

      <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-4 mb-4 grid grid-cols-1 sm:grid-cols-4 gap-3">
        <select value={categoryId} onChange={(e) => setCategoryId(e.target.value)} className={inputClass}>
          <option value="">All categories</option>
          {categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
        <select value={clientId} onChange={(e) => setClientId(e.target.value)} className={inputClass}>
          <option value="">All clients</option>
          {clients.map((c) => <option key={c.id} value={c.id}>{c.company ?? c.company_name ?? c.id}</option>)}
        </select>
        <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className={inputClass} />
        <input type="date" value={to} onChange={(e) => setTo(e.target.value)} className={inputClass} />
      </div>

      <div className="bg-white rounded-xl border border-gray-100 shadow-sm overflow-hidden">
        {error && <div className="px-4 py-3 bg-red-50 text-sm text-red-600">{error}</div>}
        <table className="min-w-full text-sm">
          <thead>
            <tr className="bg-gray-50 border-b border-gray-100 text-left text-xs font-semibold text-gray-500 uppercase">
              <th className="px-4 py-3">Name</th>
              <th className="px-4 py-3">Category</th>
              <th className="px-4 py-3">Client</th>
              <th className="px-4 py-3">Date</th>
              <th className="px-4 py-3">Amount</th>
              <th className="px-4 py-3">Billable</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              Array.from({ length: 6 }).map((_, i) => (
                <tr key={i} className="border-b border-gray-100">
                  {Array.from({ length: 6 }).map((__, j) => (
                    <td key={j} className="px-4 py-3"><div className="h-4 bg-gray-100 rounded animate-pulse" /></td>
                  ))}
                </tr>
              ))
            ) : expenses.length === 0 ? (
              <tr><td colSpan={6} className="px-4 py-12 text-center text-sm text-gray-400">No expenses</td></tr>
            ) : expenses.map((e) => (
              <tr key={e.id} className="border-b border-gray-100 hover:bg-gray-50/60">
                <td className="px-4 py-3 font-medium text-gray-900">{e.name}</td>
                <td className="px-4 py-3 text-gray-600">{e.category?.name ?? '—'}</td>
                <td className="px-4 py-3 text-gray-600">{e.client?.company ?? e.client?.company_name ?? '—'}</td>
                <td className="px-4 py-3 text-gray-600">{e.date ? new Date(e.date).toLocaleDateString() : '—'}</td>
                <td className="px-4 py-3 tabular-nums">{e.amount?.toFixed?.(2) ?? e.amount}</td>
                <td className="px-4 py-3">
                  {e.billable ? <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-green-100 text-green-700">Yes</span> : <span className="text-gray-300">—</span>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

const inputClass = 'w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary bg-white';

function StatCard({ label, value }: { label: string; value: number }) {
  return (
    <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-4">
      <p className="text-xs text-gray-500 uppercase tracking-wide">{label}</p>
      <p className="text-2xl font-bold text-gray-900 mt-1 tabular-nums">{typeof value === 'number' ? value.toFixed(2) : value}</p>
    </div>
  );
}
