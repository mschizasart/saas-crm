'use client';

import { useState, useEffect, FormEvent } from 'react';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';

interface LeadForm {
  name: string;
  email: string;
  phone: string;
  company: string;
  position: string;
  website: string;
  address: string;
  city: string;
  country: string;
  status: string;
  source: string;
  budget: string;
  description: string;
}

const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001';
const STATUSES = ['new', 'contacted', 'qualified', 'proposal', 'won', 'lost'];
const SOURCES = ['website', 'referral', 'social', 'email', 'phone', 'other'];

const EMPTY: LeadForm = {
  name: '', email: '', phone: '', company: '', position: '', website: '',
  address: '', city: '', country: '', status: 'new', source: 'website',
  budget: '', description: '',
};

function getToken(): string | null {
  if (typeof window === 'undefined') return null;
  return localStorage.getItem('access_token');
}

export default function EditLeadPage() {
  const { id } = useParams() as { id: string };
  const router = useRouter();
  const [form, setForm] = useState<LeadForm>(EMPTY);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch(`${API_BASE}/api/v1/leads/${id}`, {
          headers: { Authorization: `Bearer ${getToken()}` },
        });
        if (!res.ok) throw new Error(`Failed (${res.status})`);
        const json = await res.json();
        const data = json.data ?? json;
        setForm({
          name: data.name ?? '',
          email: data.email ?? '',
          phone: data.phone ?? '',
          company: data.company ?? '',
          position: data.position ?? '',
          website: data.website ?? '',
          address: data.address ?? '',
          city: data.city ?? '',
          country: data.country ?? '',
          status: data.status ?? 'new',
          source: data.source ?? 'website',
          budget: data.budget != null ? String(data.budget) : '',
          description: data.description ?? '',
        });
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed');
      } finally {
        setLoading(false);
      }
    })();
  }, [id]);

  function update<K extends keyof LeadForm>(key: K, value: LeadForm[K]) {
    setForm((p) => ({ ...p, [key]: value }));
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setSaving(true);
    try {
      const payload = { ...form, budget: form.budget ? Number(form.budget) : undefined };
      const res = await fetch(`${API_BASE}/api/v1/leads/${id}`, {
        method: 'PATCH',
        headers: { Authorization: `Bearer ${getToken()}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (!res.ok) throw new Error(`Save failed (${res.status})`);
      router.push(`/leads/${id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Save failed');
    } finally {
      setSaving(false);
    }
  }

  if (loading) return <div className="animate-pulse h-80 bg-gray-100 rounded-xl max-w-3xl" />;

  return (
    <div className="max-w-3xl">
      <div className="mb-4">
        <Link href={`/leads/${id}`} className="text-sm text-gray-500 hover:text-primary">← Back</Link>
      </div>
      <h1 className="text-2xl font-bold text-gray-900 mb-6">Edit Lead</h1>

      <form onSubmit={handleSubmit} className="bg-white rounded-xl border border-gray-100 shadow-sm p-6 space-y-4">
        {error && <div className="px-3 py-2 bg-red-50 border border-red-100 text-sm text-red-600 rounded">{error}</div>}

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <Field label="Name" required>
            <input required value={form.name} onChange={(e) => update('name', e.target.value)} className={inputClass} />
          </Field>
          <Field label="Email">
            <input type="email" value={form.email} onChange={(e) => update('email', e.target.value)} className={inputClass} />
          </Field>
          <Field label="Phone">
            <input value={form.phone} onChange={(e) => update('phone', e.target.value)} className={inputClass} />
          </Field>
          <Field label="Company">
            <input value={form.company} onChange={(e) => update('company', e.target.value)} className={inputClass} />
          </Field>
          <Field label="Position">
            <input value={form.position} onChange={(e) => update('position', e.target.value)} className={inputClass} />
          </Field>
          <Field label="Website">
            <input type="url" value={form.website} onChange={(e) => update('website', e.target.value)} className={inputClass} />
          </Field>
          <Field label="Address" className="sm:col-span-2">
            <input value={form.address} onChange={(e) => update('address', e.target.value)} className={inputClass} />
          </Field>
          <Field label="City">
            <input value={form.city} onChange={(e) => update('city', e.target.value)} className={inputClass} />
          </Field>
          <Field label="Country">
            <input value={form.country} onChange={(e) => update('country', e.target.value)} className={inputClass} />
          </Field>
          <Field label="Status">
            <select value={form.status} onChange={(e) => update('status', e.target.value)} className={inputClass}>
              {STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
          </Field>
          <Field label="Source">
            <select value={form.source} onChange={(e) => update('source', e.target.value)} className={inputClass}>
              {SOURCES.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
          </Field>
          <Field label="Budget">
            <input type="number" value={form.budget} onChange={(e) => update('budget', e.target.value)} className={inputClass} />
          </Field>
          <Field label="Description" className="sm:col-span-2">
            <textarea rows={4} value={form.description} onChange={(e) => update('description', e.target.value)} className={inputClass} />
          </Field>
        </div>

        <div className="flex justify-end gap-2 pt-4 border-t border-gray-100">
          <Link href={`/leads/${id}`} className="px-4 py-2 text-sm font-medium text-gray-600 hover:text-gray-900">Cancel</Link>
          <button type="submit" disabled={saving} className="px-4 py-2 bg-primary text-white text-sm font-medium rounded-lg hover:bg-primary/90 disabled:opacity-50">
            {saving ? 'Saving…' : 'Save'}
          </button>
        </div>
      </form>
    </div>
  );
}

const inputClass = 'w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary bg-white';

function Field({ label, required, children, className }: { label: string; required?: boolean; children: React.ReactNode; className?: string }) {
  return (
    <div className={className}>
      <label className="block text-xs font-medium text-gray-600 mb-1">
        {label}{required && <span className="text-red-500 ml-0.5">*</span>}
      </label>
      {children}
    </div>
  );
}
