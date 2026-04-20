'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { FormPageLayout } from '@/components/layouts/form-page-layout';
import { Button } from '@/components/ui/button';

interface Client {
  id: string;
  company?: string;
  company_name?: string;
}

const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001';

function authHeaders(): HeadersInit {
  const token =
    typeof window === 'undefined' ? null : localStorage.getItem('access_token');
  return { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
}

const CURRENCIES = ['USD', 'EUR', 'GBP', 'CAD', 'AUD', 'JPY'];

// Frequency preset -> (interval, intervalCount) pairs.
const FREQUENCY_PRESETS: {
  value: string;
  label: string;
  interval: 'day' | 'week' | 'month' | 'year';
  intervalCount: number;
}[] = [
  { value: 'daily', label: 'Daily', interval: 'day', intervalCount: 1 },
  { value: 'weekly', label: 'Weekly', interval: 'week', intervalCount: 1 },
  { value: 'monthly', label: 'Monthly', interval: 'month', intervalCount: 1 },
  {
    value: 'quarterly',
    label: 'Quarterly',
    interval: 'month',
    intervalCount: 3,
  },
  { value: 'yearly', label: 'Yearly', interval: 'year', intervalCount: 1 },
];

function addInterval(
  from: Date,
  interval: 'day' | 'week' | 'month' | 'year',
  count: number,
): Date {
  const d = new Date(from);
  const c = Math.max(1, Math.floor(count));
  switch (interval) {
    case 'day':
      d.setDate(d.getDate() + c);
      break;
    case 'week':
      d.setDate(d.getDate() + c * 7);
      break;
    case 'month':
      d.setMonth(d.getMonth() + c);
      break;
    case 'year':
      d.setFullYear(d.getFullYear() + c);
      break;
  }
  return d;
}

function todayISO(): string {
  return new Date().toISOString().slice(0, 10);
}

export default function NewSubscriptionPage() {
  const router = useRouter();
  const [clients, setClients] = useState<Client[]>([]);
  const [form, setForm] = useState({
    name: '',
    clientId: '',
    unitPrice: '',
    currency: 'USD',
    createdAt: todayISO(),
    cancelledAt: '',
    description: '',
    frequency: 'monthly',
    nextInvoiceAt: '',
  });
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch(`${API_BASE}/api/v1/clients?limit=100`, { headers: authHeaders() })
      .then((r) => r.json())
      .then((d) => setClients(d?.data ?? []))
      .catch(() => setClients([]));
  }, []);

  // Default nextInvoiceAt = today + one interval (based on selected frequency)
  useEffect(() => {
    if (!form.nextInvoiceAt) {
      const preset = FREQUENCY_PRESETS.find((p) => p.value === form.frequency);
      if (preset) {
        const next = addInterval(
          new Date(),
          preset.interval,
          preset.intervalCount,
        );
        setForm((prev) => ({ ...prev, nextInvoiceAt: next.toISOString().slice(0, 10) }));
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function update<K extends keyof typeof form>(key: K, val: (typeof form)[K]) {
    setForm((p) => ({ ...p, [key]: val }));
  }

  function onFrequencyChange(value: string) {
    setForm((prev) => {
      const preset = FREQUENCY_PRESETS.find((p) => p.value === value);
      if (!preset) return { ...prev, frequency: value };
      const next = addInterval(
        new Date(),
        preset.interval,
        preset.intervalCount,
      );
      return {
        ...prev,
        frequency: value,
        nextInvoiceAt: next.toISOString().slice(0, 10),
      };
    });
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      const preset = FREQUENCY_PRESETS.find((p) => p.value === form.frequency);
      const body: Record<string, unknown> = {
        name: form.name,
        clientId: form.clientId,
        unitPrice: Number(form.unitPrice),
        currency: form.currency,
        createdAt: form.createdAt,
        description: form.description,
        interval: preset?.interval ?? 'month',
        intervalCount: preset?.intervalCount ?? 1,
      };
      if (form.nextInvoiceAt) body.nextInvoiceAt = form.nextInvoiceAt;
      if (form.cancelledAt) body.cancelledAt = form.cancelledAt;

      const res = await fetch(`${API_BASE}/api/v1/subscriptions`, {
        method: 'POST',
        headers: authHeaders(),
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        throw new Error(j.message || `Failed with status ${res.status}`);
      }
      const created = await res.json();
      router.push(`/subscriptions/${created.id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <FormPageLayout
      title="New Subscription"
      backHref="/subscriptions"
      backLabel="Subscriptions"
      onSubmit={submit}
      footer={
        <>
          <Link
            href="/subscriptions"
            className="px-4 py-2 text-sm font-medium border border-gray-200 dark:border-gray-700 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-800"
          >
            Cancel
          </Link>
          <Button type="submit" disabled={submitting}>
            {submitting ? 'Creating…' : 'Create Subscription'}
          </Button>
        </>
      }
    >
      {error && (
        <div className="mb-4 px-3 py-2 bg-red-50 border border-red-100 text-red-600 text-sm rounded-lg">
          {error}
        </div>
      )}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div className="sm:col-span-2">
          <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">
            Name *
          </label>
          <input
            type="text"
            required
            value={form.name}
            onChange={(e) => update('name', e.target.value)}
            className="w-full px-3 py-2 text-sm border border-gray-200 dark:border-gray-700 rounded-lg"
          />
        </div>
        <div className="sm:col-span-2">
          <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">
            Client *
          </label>
          <select
            required
            value={form.clientId}
            onChange={(e) => update('clientId', e.target.value)}
            className="w-full px-3 py-2 text-sm border border-gray-200 dark:border-gray-700 rounded-lg bg-white dark:bg-gray-900"
          >
            <option value="">— Select client —</option>
            {clients.map((c) => (
              <option key={c.id} value={c.id}>
                {c.company ?? c.company_name}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">
            Unit Price *
          </label>
          <input
            type="number"
            step="0.01"
            required
            value={form.unitPrice}
            onChange={(e) => update('unitPrice', e.target.value)}
            className="w-full px-3 py-2 text-sm border border-gray-200 dark:border-gray-700 rounded-lg"
          />
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">
            Currency
          </label>
          <select
            value={form.currency}
            onChange={(e) => update('currency', e.target.value)}
            className="w-full px-3 py-2 text-sm border border-gray-200 dark:border-gray-700 rounded-lg bg-white dark:bg-gray-900"
          >
            {CURRENCIES.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">
            Billing frequency *
          </label>
          <select
            value={form.frequency}
            onChange={(e) => onFrequencyChange(e.target.value)}
            className="w-full px-3 py-2 text-sm border border-gray-200 dark:border-gray-700 rounded-lg bg-white dark:bg-gray-900"
          >
            {FREQUENCY_PRESETS.map((p) => (
              <option key={p.value} value={p.value}>
                {p.label}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">
            Next invoice at
          </label>
          <input
            type="date"
            value={form.nextInvoiceAt}
            onChange={(e) => update('nextInvoiceAt', e.target.value)}
            className="w-full px-3 py-2 text-sm border border-gray-200 dark:border-gray-700 rounded-lg"
          />
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">
            Created At
          </label>
          <input
            type="date"
            value={form.createdAt}
            onChange={(e) => update('createdAt', e.target.value)}
            className="w-full px-3 py-2 text-sm border border-gray-200 dark:border-gray-700 rounded-lg"
          />
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">
            Cancelled At (optional)
          </label>
          <input
            type="date"
            value={form.cancelledAt}
            onChange={(e) => update('cancelledAt', e.target.value)}
            className="w-full px-3 py-2 text-sm border border-gray-200 dark:border-gray-700 rounded-lg"
          />
        </div>
        <div className="sm:col-span-2">
          <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">
            Description
          </label>
          <textarea
            rows={3}
            value={form.description}
            onChange={(e) => update('description', e.target.value)}
            className="w-full px-3 py-2 text-sm border border-gray-200 dark:border-gray-700 rounded-lg"
          />
        </div>
      </div>
    </FormPageLayout>
  );
}
