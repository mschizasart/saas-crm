'use client';

import { useState, useEffect, FormEvent } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface ClientGroup {
  id: string;
  name: string;
}

interface ClientForm {
  company: string;
  phone: string;
  website: string;
  vatNumber: string;
  address: string;
  city: string;
  state: string;
  zipCode: string;
  country: string;
  groupId: string;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001';

const EMPTY_FORM: ClientForm = {
  company: '',
  phone: '',
  website: '',
  vatNumber: '',
  address: '',
  city: '',
  state: '',
  zipCode: '',
  country: '',
  groupId: '',
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function getToken(): string | null {
  if (typeof window === 'undefined') return null;
  return localStorage.getItem('access_token');
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default function NewClientPage() {
  const router = useRouter();
  const [form, setForm] = useState<ClientForm>(EMPTY_FORM);
  const [groups, setGroups] = useState<ClientGroup[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch(`${API_BASE}/api/v1/clients/groups/list`, {
          headers: { Authorization: `Bearer ${getToken()}` },
        });
        if (res.ok) {
          const json = await res.json();
          setGroups(Array.isArray(json) ? json : json.data ?? []);
        }
      } catch {
        // ignore
      }
    })();
  }, []);

  function update<K extends keyof ClientForm>(key: K, value: ClientForm[K]) {
    setForm((prev) => ({ ...prev, [key]: value }));
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      const payload: Record<string, unknown> = { ...form };
      if (!payload.groupId) delete payload.groupId;
      const res = await fetch(`${API_BASE}/api/v1/clients`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${getToken()}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(payload),
      });
      if (!res.ok) throw new Error(`Failed to create client (${res.status})`);
      const created = await res.json();
      router.push(`/clients/${created.id ?? created.data?.id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create client');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="max-w-3xl">
      <div className="mb-4">
        <Link href="/clients" className="text-sm text-gray-500 hover:text-primary">
          ← Back to clients
        </Link>
      </div>

      <h1 className="text-2xl font-bold text-gray-900 mb-6">New Client</h1>

      <form
        onSubmit={handleSubmit}
        className="bg-white rounded-xl border border-gray-100 shadow-sm p-6 space-y-4"
      >
        {error && (
          <div className="px-3 py-2 bg-red-50 border border-red-100 text-sm text-red-600 rounded">
            {error}
          </div>
        )}

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <Field label="Company" required>
            <input
              required
              value={form.company}
              onChange={(e) => update('company', e.target.value)}
              className={inputClass}
            />
          </Field>

          <Field label="Phone">
            <input
              value={form.phone}
              onChange={(e) => update('phone', e.target.value)}
              className={inputClass}
            />
          </Field>

          <Field label="Website">
            <input
              type="url"
              value={form.website}
              onChange={(e) => update('website', e.target.value)}
              className={inputClass}
              placeholder="https://"
            />
          </Field>

          <Field label="VAT Number">
            <input
              value={form.vatNumber}
              onChange={(e) => update('vatNumber', e.target.value)}
              className={inputClass}
            />
          </Field>

          <Field label="Group">
            <select
              value={form.groupId}
              onChange={(e) => update('groupId', e.target.value)}
              className={inputClass}
            >
              <option value="">— None —</option>
              {groups.map((g) => (
                <option key={g.id} value={g.id}>
                  {g.name}
                </option>
              ))}
            </select>
          </Field>
        </div>

        <div className="pt-2 border-t border-gray-100">
          <h2 className="text-sm font-semibold text-gray-700 mt-3 mb-2">Address</h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <Field label="Address" className="sm:col-span-2">
              <input
                value={form.address}
                onChange={(e) => update('address', e.target.value)}
                className={inputClass}
              />
            </Field>
            <Field label="City">
              <input
                value={form.city}
                onChange={(e) => update('city', e.target.value)}
                className={inputClass}
              />
            </Field>
            <Field label="State / Province">
              <input
                value={form.state}
                onChange={(e) => update('state', e.target.value)}
                className={inputClass}
              />
            </Field>
            <Field label="Zip Code">
              <input
                value={form.zipCode}
                onChange={(e) => update('zipCode', e.target.value)}
                className={inputClass}
              />
            </Field>
            <Field label="Country">
              <input
                value={form.country}
                onChange={(e) => update('country', e.target.value)}
                className={inputClass}
              />
            </Field>
          </div>
        </div>

        <div className="flex items-center justify-end gap-2 pt-4 border-t border-gray-100">
          <Link
            href="/clients"
            className="px-4 py-2 text-sm font-medium text-gray-600 hover:text-gray-900"
          >
            Cancel
          </Link>
          <button
            type="submit"
            disabled={saving}
            className="px-4 py-2 bg-primary text-white text-sm font-medium rounded-lg hover:bg-primary/90 disabled:opacity-50"
          >
            {saving ? 'Saving…' : 'Create Client'}
          </button>
        </div>
      </form>
    </div>
  );
}

const inputClass =
  'w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary bg-white';

function Field({
  label,
  required,
  children,
  className,
}: {
  label: string;
  required?: boolean;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={className}>
      <label className="block text-xs font-medium text-gray-600 mb-1">
        {label}
        {required && <span className="text-red-500 ml-0.5">*</span>}
      </label>
      {children}
    </div>
  );
}
