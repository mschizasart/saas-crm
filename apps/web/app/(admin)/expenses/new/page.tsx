'use client';

import { useState, useEffect, FormEvent } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';

interface Category { id: string; name: string; }
interface ClientOption { id: string; company?: string; company_name?: string; }
interface ProjectOption { id: string; name: string; }

const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001';

function getToken(): string | null {
  if (typeof window === 'undefined') return null;
  return localStorage.getItem('access_token');
}

export default function NewExpensePage() {
  const router = useRouter();
  const [name, setName] = useState('');
  const [amount, setAmount] = useState('');
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const [categoryId, setCategoryId] = useState('');
  const [clientId, setClientId] = useState('');
  const [projectId, setProjectId] = useState('');
  const [note, setNote] = useState('');
  const [billable, setBillable] = useState(false);
  const [recurring, setRecurring] = useState(false);
  const [recurringType, setRecurringType] = useState('monthly');
  const [recurringEndDate, setRecurringEndDate] = useState('');
  const [categories, setCategories] = useState<Category[]>([]);
  const [clients, setClients] = useState<ClientOption[]>([]);
  const [projects, setProjects] = useState<ProjectOption[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const [catRes, cRes, pRes] = await Promise.all([
          fetch(`${API_BASE}/api/v1/expenses/categories`, { headers: { Authorization: `Bearer ${getToken()}` } }),
          fetch(`${API_BASE}/api/v1/clients?limit=100`, { headers: { Authorization: `Bearer ${getToken()}` } }),
          fetch(`${API_BASE}/api/v1/projects?limit=100`, { headers: { Authorization: `Bearer ${getToken()}` } }),
        ]);
        if (catRes.ok) {
          const j = await catRes.json();
          setCategories(Array.isArray(j) ? j : j.data ?? []);
        }
        if (cRes.ok) setClients((await cRes.json()).data ?? []);
        if (pRes.ok) setProjects((await pRes.json()).data ?? []);
      } catch { /* ignore */ }
    })();
  }, []);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      const payload: any = {
        name,
        amount: Number(amount) || 0,
        date,
        categoryId,
        clientId: clientId || undefined,
        projectId: projectId || undefined,
        note,
        billable,
        recurring,
        recurringType: recurring ? recurringType : undefined,
        recurringNextDate: recurring ? date : undefined,
        recurringEndDate: recurring && recurringEndDate ? recurringEndDate : undefined,
      };
      const res = await fetch(`${API_BASE}/api/v1/expenses`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${getToken()}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (!res.ok) throw new Error(`Failed (${res.status})`);
      router.push('/expenses');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="max-w-3xl">
      <div className="mb-4"><Link href="/expenses" className="text-sm text-gray-500 hover:text-primary">← Back</Link></div>
      <h1 className="text-2xl font-bold text-gray-900 mb-6">New Expense</h1>

      <form onSubmit={handleSubmit} className="bg-white rounded-xl border border-gray-100 shadow-sm p-6 space-y-4">
        {error && <div className="px-3 py-2 bg-red-50 border border-red-100 text-sm text-red-600 rounded">{error}</div>}

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <Field label="Name" required>
            <input required value={name} onChange={(e) => setName(e.target.value)} className={inputClass} />
          </Field>
          <Field label="Amount" required>
            <input required type="number" step="0.01" value={amount} onChange={(e) => setAmount(e.target.value)} className={inputClass} />
          </Field>
          <Field label="Date" required>
            <input required type="date" value={date} onChange={(e) => setDate(e.target.value)} className={inputClass} />
          </Field>
          <Field label="Category" required>
            <select required value={categoryId} onChange={(e) => setCategoryId(e.target.value)} className={inputClass}>
              <option value="">— Select —</option>
              {categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </Field>
          <Field label="Client">
            <select value={clientId} onChange={(e) => setClientId(e.target.value)} className={inputClass}>
              <option value="">— None —</option>
              {clients.map((c) => <option key={c.id} value={c.id}>{c.company ?? c.company_name ?? c.id}</option>)}
            </select>
          </Field>
          <Field label="Project">
            <select value={projectId} onChange={(e) => setProjectId(e.target.value)} className={inputClass}>
              <option value="">— None —</option>
              {projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          </Field>
        </div>

        <Field label="Note">
          <textarea rows={3} value={note} onChange={(e) => setNote(e.target.value)} className={inputClass} />
        </Field>

        <div className="flex items-center gap-6">
          <label className="flex items-center gap-2 text-sm text-gray-700">
            <input type="checkbox" checked={billable} onChange={(e) => setBillable(e.target.checked)} />
            Billable
          </label>
          <label className="flex items-center gap-2 text-sm text-gray-700">
            <input type="checkbox" checked={recurring} onChange={(e) => setRecurring(e.target.checked)} />
            Recurring
          </label>
        </div>

        {recurring && (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 p-4 bg-blue-50 rounded-lg border border-blue-100">
            <Field label="Frequency">
              <select value={recurringType} onChange={(e) => setRecurringType(e.target.value)} className={inputClass}>
                <option value="monthly">Monthly</option>
                <option value="quarterly">Quarterly</option>
                <option value="yearly">Yearly</option>
              </select>
            </Field>
            <Field label="End Date (optional)">
              <input type="date" value={recurringEndDate} onChange={(e) => setRecurringEndDate(e.target.value)} className={inputClass} />
            </Field>
          </div>
        )}

        <div className="flex justify-end gap-2 pt-4 border-t border-gray-100">
          <Link href="/expenses" className="px-4 py-2 text-sm font-medium text-gray-600 hover:text-gray-900">Cancel</Link>
          <button type="submit" disabled={saving} className="px-4 py-2 bg-primary text-white text-sm font-medium rounded-lg hover:bg-primary/90 disabled:opacity-50">
            {saving ? 'Saving…' : 'Create Expense'}
          </button>
        </div>
      </form>
    </div>
  );
}

const inputClass = 'w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary bg-white';

function Field({ label, required, children }: { label: string; required?: boolean; children: React.ReactNode }) {
  return (
    <div>
      <label className="block text-xs font-medium text-gray-600 mb-1">
        {label}{required && <span className="text-red-500 ml-0.5">*</span>}
      </label>
      {children}
    </div>
  );
}
