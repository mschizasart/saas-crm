'use client';

import { useState, useEffect, FormEvent } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';

interface ClientOption { id: string; company?: string; company_name?: string; name?: string; }
interface UserOption { id: string; name?: string; email?: string; }

const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001';

function getToken(): string | null {
  if (typeof window === 'undefined') return null;
  return localStorage.getItem('access_token');
}

export default function NewProposalPage() {
  const router = useRouter();
  const [subject, setSubject] = useState('');
  const [clientId, setClientId] = useState('');
  const [totalValue, setTotalValue] = useState('');
  const [currency, setCurrency] = useState('USD');
  const [content, setContent] = useState('');
  const [allowComments, setAllowComments] = useState(true);
  const [assignedTo, setAssignedTo] = useState('');
  const [clients, setClients] = useState<ClientOption[]>([]);
  const [users, setUsers] = useState<UserOption[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const [cRes, uRes] = await Promise.all([
          fetch(`${API_BASE}/api/v1/clients?limit=100`, { headers: { Authorization: `Bearer ${getToken()}` } }),
          fetch(`${API_BASE}/api/v1/users`, { headers: { Authorization: `Bearer ${getToken()}` } }),
        ]);
        if (cRes.ok) setClients((await cRes.json()).data ?? []);
        if (uRes.ok) {
          const json = await uRes.json();
          setUsers(json.data ?? json ?? []);
        }
      } catch { /* ignore */ }
    })();
  }, []);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      const payload = {
        subject,
        clientId,
        totalValue: Number(totalValue) || 0,
        currency,
        content,
        allowComments,
        assignedTo: assignedTo || undefined,
      };
      const res = await fetch(`${API_BASE}/api/v1/proposals`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${getToken()}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (!res.ok) throw new Error(`Failed (${res.status})`);
      const created = await res.json();
      router.push(`/proposals/${created.id ?? created.data?.id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="max-w-3xl">
      <div className="mb-4"><Link href="/proposals" className="text-sm text-gray-500 hover:text-primary">← Back</Link></div>
      <h1 className="text-2xl font-bold text-gray-900 mb-6">New Proposal</h1>

      <form onSubmit={handleSubmit} className="bg-white rounded-xl border border-gray-100 shadow-sm p-6 space-y-4">
        {error && <div className="px-3 py-2 bg-red-50 border border-red-100 text-sm text-red-600 rounded">{error}</div>}

        <Field label="Subject" required>
          <input required value={subject} onChange={(e) => setSubject(e.target.value)} className={inputClass} />
        </Field>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <Field label="Client" required>
            <select required value={clientId} onChange={(e) => setClientId(e.target.value)} className={inputClass}>
              <option value="">— Select —</option>
              {clients.map((c) => (
                <option key={c.id} value={c.id}>{c.company ?? c.company_name ?? c.name ?? c.id}</option>
              ))}
            </select>
          </Field>
          <Field label="Assigned To">
            <select value={assignedTo} onChange={(e) => setAssignedTo(e.target.value)} className={inputClass}>
              <option value="">— None —</option>
              {users.map((u) => (
                <option key={u.id} value={u.id}>{u.name ?? u.email ?? u.id}</option>
              ))}
            </select>
          </Field>
          <Field label="Total Value">
            <input type="number" step="0.01" value={totalValue} onChange={(e) => setTotalValue(e.target.value)} className={inputClass} />
          </Field>
          <Field label="Currency">
            <input value={currency} onChange={(e) => setCurrency(e.target.value)} className={inputClass} />
          </Field>
        </div>

        <Field label="Content (HTML)" required>
          <textarea required rows={12} value={content} onChange={(e) => setContent(e.target.value)} className={inputClass} placeholder="<h1>Proposal</h1>..." />
        </Field>

        <label className="flex items-center gap-2 text-sm text-gray-700">
          <input type="checkbox" checked={allowComments} onChange={(e) => setAllowComments(e.target.checked)} />
          Allow comments
        </label>

        <div className="flex justify-end gap-2 pt-4 border-t border-gray-100">
          <Link href="/proposals" className="px-4 py-2 text-sm font-medium text-gray-600 hover:text-gray-900">Cancel</Link>
          <button type="submit" disabled={saving} className="px-4 py-2 bg-primary text-white text-sm font-medium rounded-lg hover:bg-primary/90 disabled:opacity-50">
            {saving ? 'Saving…' : 'Create Proposal'}
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
