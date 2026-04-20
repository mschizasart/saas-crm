'use client';

import { useState, useEffect, useRef, FormEvent } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { RichTextEditor, RichTextEditorHandle } from '../../../../components/rich-text-editor';
import { FormPageLayout } from '@/components/layouts/form-page-layout';
import { Button } from '@/components/ui/button';

interface ClientOption { id: string; company?: string; company_name?: string; name?: string; }
interface MergeField { key: string; label: string; }

const MERGE_FIELDS: MergeField[] = [
  { key: '{client_name}', label: 'Client Company Name' },
  { key: '{contact_name}', label: 'Primary Contact Name' },
  { key: '{contact_email}', label: 'Primary Contact Email' },
  { key: '{contract_value}', label: 'Contract Value' },
  { key: '{start_date}', label: 'Start Date' },
  { key: '{end_date}', label: 'End Date' },
  { key: '{today}', label: "Today's Date" },
  { key: '{organization_name}', label: 'Your Company Name' },
  { key: '{organization_address}', label: 'Your Company Address' },
];

const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001';

function getToken(): string | null {
  if (typeof window === 'undefined') return null;
  return localStorage.getItem('access_token');
}

export default function NewContractPage() {
  const router = useRouter();
  const editorRef = useRef<RichTextEditorHandle>(null);
  const [subject, setSubject] = useState('');
  const [clientId, setClientId] = useState('');
  const [content, setContent] = useState('');
  const [type, setType] = useState('service');
  const [value, setValue] = useState('');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [clients, setClients] = useState<ClientOption[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showMergeFields, setShowMergeFields] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch(`${API_BASE}/api/v1/clients?limit=100`, { headers: { Authorization: `Bearer ${getToken()}` } });
        if (res.ok) setClients((await res.json()).data ?? []);
      } catch { /* ignore */ }
    })();
  }, []);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      const payload = { subject, clientId, content, type, value: Number(value) || 0, startDate, endDate };
      const res = await fetch(`${API_BASE}/api/v1/contracts`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${getToken()}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (!res.ok) throw new Error(`Failed (${res.status})`);
      const created = await res.json();
      router.push(`/contracts/${created.id ?? created.data?.id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed');
    } finally {
      setSaving(false);
    }
  }

  return (
    <FormPageLayout
      title="New Contract"
      backHref="/contracts"
      onSubmit={handleSubmit}
      footer={
        <>
          <Link href="/contracts" className="px-4 py-2 text-sm font-medium text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-gray-100">Cancel</Link>
          <Button type="submit" disabled={saving}>
            {saving ? 'Saving…' : 'Create Contract'}
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
          <Field label="Type">
            <select value={type} onChange={(e) => setType(e.target.value)} className={inputClass}>
              <option value="service">Service</option>
              <option value="nda">NDA</option>
              <option value="employment">Employment</option>
              <option value="partnership">Partnership</option>
              <option value="other">Other</option>
            </select>
          </Field>
          <Field label="Value">
            <input type="number" step="0.01" value={value} onChange={(e) => setValue(e.target.value)} className={inputClass} />
          </Field>
          <Field label="Start Date">
            <input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} className={inputClass} />
          </Field>
          <Field label="End Date">
            <input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} className={inputClass} />
          </Field>
        </div>

        <Field label="Content" required>
          <div className="flex gap-2 mb-2">
            <button
              type="button"
              onClick={() => setShowMergeFields(!showMergeFields)}
              className="px-3 py-1.5 text-xs font-medium text-gray-600 dark:text-gray-400 bg-gray-100 dark:bg-gray-800 hover:bg-gray-200 rounded-lg transition-colors"
            >
              {showMergeFields ? 'Hide Merge Fields' : 'Insert Merge Field'}
            </button>
          </div>
          {showMergeFields && (
            <div className="flex flex-wrap gap-1.5 mb-2 p-2 bg-blue-50 border border-blue-100 rounded-lg">
              {MERGE_FIELDS.map((field) => (
                <button
                  key={field.key}
                  type="button"
                  onClick={() => editorRef.current?.insertText(field.key)}
                  className="px-2 py-1 text-xs bg-white dark:bg-gray-900 border border-blue-200 text-blue-700 rounded hover:bg-blue-100 transition-colors"
                  title={field.label}
                >
                  {field.key}
                </button>
              ))}
            </div>
          )}
          <RichTextEditor ref={editorRef} value={content} onChange={setContent} placeholder="Write your contract content here... Use merge fields to insert dynamic values." minHeight="250px" />
        </Field>
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
