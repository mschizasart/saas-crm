'use client';

import { useState, useEffect, FormEvent } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { RichTextEditor } from '../../../../components/rich-text-editor';
import { FormPageLayout } from '@/components/layouts/form-page-layout';
import { Button } from '@/components/ui/button';

interface ClientOption { id: string; company?: string; company_name?: string; name?: string; }

const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001';

function getToken(): string | null {
  if (typeof window === 'undefined') return null;
  return localStorage.getItem('access_token');
}

export default function NewProposalPage() {
  const router = useRouter();
  const [subject, setSubject] = useState('');
  const [clientId, setClientId] = useState('');
  const [total, setTotal] = useState('');
  const [currency, setCurrency] = useState('USD');
  const [content, setContent] = useState('');
  const [allowComments, setAllowComments] = useState(true);
  const [clients, setClients] = useState<ClientOption[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const cRes = await fetch(`${API_BASE}/api/v1/clients?limit=100`, { headers: { Authorization: `Bearer ${getToken()}` } });
        if (cRes.ok) setClients((await cRes.json()).data ?? []);
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
        total: Number(total) || 0,
        currency,
        content,
        allowComments,
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
    <FormPageLayout
      title="New Proposal"
      backHref="/proposals"
      onSubmit={handleSubmit}
      footer={
        <>
          <Link href="/proposals" className="px-4 py-2 text-sm font-medium text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-gray-100">Cancel</Link>
          <Button type="submit" disabled={saving}>
            {saving ? 'Saving…' : 'Create Proposal'}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
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
          <Field label="Total Value">
            <input type="number" step="0.01" value={total} onChange={(e) => setTotal(e.target.value)} className={inputClass} />
          </Field>
          <Field label="Currency">
            <input value={currency} onChange={(e) => setCurrency(e.target.value)} className={inputClass} />
          </Field>
        </div>

        <Field label="Content" required>
          <RichTextEditor value={content} onChange={setContent} placeholder="Write your proposal content here..." minHeight="250px" />
        </Field>

        <label className="flex items-center gap-2 text-sm text-gray-700 dark:text-gray-300">
          <input type="checkbox" checked={allowComments} onChange={(e) => setAllowComments(e.target.checked)} />
          Allow comments
        </label>
      </div>
    </FormPageLayout>
  );
}

const inputClass = 'w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary bg-white';

function Field({ label, required, children }: { label: string; required?: boolean; children: React.ReactNode }) {
  return (
    <div>
      <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">
        {label}{required && <span className="text-red-500 ml-0.5">*</span>}
      </label>
      {children}
    </div>
  );
}
