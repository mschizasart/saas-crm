'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { SettingsPageLayout, SettingsSection } from '@/components/layouts/settings-page-layout';
import { typography } from '@/lib/ui-tokens';

const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001';

function headers(): HeadersInit {
  const token = typeof window === 'undefined' ? null : localStorage.getItem('access_token');
  return { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
}

interface EmailTemplate {
  id: string;
  slug: string;
  subject: string;
  body: string;
  type?: string;
  active: boolean;
}

const MERGE_FIELDS = [
  { label: 'Company Name', field: '{{company_name}}' },
  { label: 'Client Name', field: '{{client_name}}' },
  { label: 'Client Email', field: '{{client_email}}' },
  { label: 'Invoice Number', field: '{{invoice_number}}' },
  { label: 'Invoice Total', field: '{{invoice_total}}' },
  { label: 'Invoice Due Date', field: '{{invoice_due_date}}' },
  { label: 'Invoice Link', field: '{{invoice_link}}' },
  { label: 'Estimate Number', field: '{{estimate_number}}' },
  { label: 'Ticket Subject', field: '{{ticket_subject}}' },
  { label: 'Ticket ID', field: '{{ticket_id}}' },
  { label: 'Contract Subject', field: '{{contract_subject}}' },
  { label: 'Sign Link', field: '{{sign_link}}' },
  { label: 'Reset Link', field: '{{reset_link}}' },
];

export default function EmailTemplatesPage() {
  const [templates, setTemplates] = useState<EmailTemplate[]>([]);
  const [loading, setLoading] = useState(true);
  const [editId, setEditId] = useState<string | null>(null);
  const [showNew, setShowNew] = useState(false);
  const [form, setForm] = useState({ slug: '', subject: '', body: '', type: '' });
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  async function load() {
    try {
      const res = await fetch(`${API_BASE}/api/v1/emails/templates`, { headers: headers() });
      if (res.ok) {
        const data = await res.json();
        setTemplates(Array.isArray(data) ? data : (data.data ?? []));
      }
    } catch { /* ignore */ }
    setLoading(false);
  }

  useEffect(() => { load(); }, []);

  function startEdit(t: EmailTemplate) {
    setEditId(t.id);
    setForm({ slug: t.slug, subject: t.subject, body: t.body, type: t.type ?? '' });
    setShowNew(false);
  }

  function startNew() {
    setEditId(null);
    setForm({ slug: '', subject: '', body: '', type: '' });
    setShowNew(true);
  }

  async function save() {
    setSaving(true);
    setMessage(null);
    try {
      const url = editId
        ? `${API_BASE}/api/v1/emails/templates/${editId}`
        : `${API_BASE}/api/v1/emails/templates`;
      const method = editId ? 'PATCH' : 'POST';
      const res = await fetch(url, { method, headers: headers(), body: JSON.stringify(form) });
      if (!res.ok) throw new Error(`Failed (${res.status})`);
      setMessage(editId ? 'Updated' : 'Created');
      setShowNew(false);
      setEditId(null);
      await load();
    } catch (err) {
      setMessage(err instanceof Error ? err.message : 'Failed');
    } finally {
      setSaving(false);
    }
  }

  async function deleteTemplate(id: string) {
    if (!confirm('Delete this email template?')) return;
    try {
      await fetch(`${API_BASE}/api/v1/emails/templates/${id}`, { method: 'DELETE', headers: headers() });
      await load();
    } catch { /* ignore */ }
  }

  function insertMergeField(field: string) {
    setForm((f) => ({ ...f, body: f.body + field }));
  }

  if (loading) return <div className="p-6 text-sm text-gray-500 dark:text-gray-400">Loading...</div>;

  return (
    <SettingsPageLayout title="Email Templates" description="Customize the emails sent by the CRM. Use merge fields for dynamic content.">
      <div className="mb-[-0.5rem]">
        <Link href="/settings" className={`${typography.bodyMuted} hover:text-primary`}>← Settings</Link>
      </div>

      {message && (
        <div className="px-3 py-2 bg-blue-50 border border-blue-100 text-sm text-blue-700 rounded">{message}</div>
      )}

      {(showNew || editId) && (
        <SettingsSection title={editId ? 'Edit Template' : 'New Template'}>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-4">
            {!editId && (
              <div>
                <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">Slug *</label>
                <input
                  value={form.slug}
                  onChange={(e) => setForm({ ...form, slug: e.target.value })}
                  className="w-full px-3 py-2 text-sm border border-gray-200 dark:border-gray-700 rounded-lg font-mono"
                  placeholder="e.g. invoice_send_to_client"
                />
              </div>
            )}
            <div>
              <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">Type</label>
              <select
                value={form.type}
                onChange={(e) => setForm({ ...form, type: e.target.value })}
                className="w-full px-3 py-2 text-sm border border-gray-200 dark:border-gray-700 rounded-lg bg-white dark:bg-gray-900"
              >
                <option value="">General</option>
                <option value="invoice">Invoice</option>
                <option value="estimate">Estimate</option>
                <option value="ticket">Ticket</option>
                <option value="contract">Contract</option>
                <option value="proposal">Proposal</option>
                <option value="auth">Auth</option>
              </select>
            </div>
            <div className="sm:col-span-2">
              <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">Subject *</label>
              <input
                value={form.subject}
                onChange={(e) => setForm({ ...form, subject: e.target.value })}
                className="w-full px-3 py-2 text-sm border border-gray-200 dark:border-gray-700 rounded-lg"
                placeholder="e.g. Invoice {{invoice_number}} from {{company_name}}"
              />
            </div>
          </div>

          <div className="mb-2">
            <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">Body (HTML with merge fields) *</label>
            <div className="flex flex-wrap gap-1 mb-2">
              {MERGE_FIELDS.map((m) => (
                <button
                  key={m.field}
                  type="button"
                  onClick={() => insertMergeField(m.field)}
                  className="text-xs px-2 py-1 bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-400 rounded hover:bg-gray-200"
                >
                  {m.label}
                </button>
              ))}
            </div>
            <textarea
              rows={10}
              value={form.body}
              onChange={(e) => setForm({ ...form, body: e.target.value })}
              className="w-full px-3 py-2 text-sm border border-gray-200 dark:border-gray-700 rounded-lg font-mono"
              placeholder="<p>Hi {{client_name}},</p>"
            />
          </div>

          <div className="flex gap-2 mt-4">
            <button onClick={save} disabled={saving || !form.subject || !form.body} className="px-4 py-2 bg-primary text-white text-sm rounded-lg disabled:opacity-50">
              {saving ? 'Saving...' : editId ? 'Update' : 'Create'}
            </button>
            <button onClick={() => { setShowNew(false); setEditId(null); }} className="px-3 py-2 text-sm text-gray-500 dark:text-gray-400">Cancel</button>
          </div>
        </SettingsSection>
      )}

      <SettingsSection title="Templates">
        <div className="flex items-center justify-end mb-4">
          <button onClick={startNew} className="px-4 py-2 bg-primary text-white text-sm font-medium rounded-lg hover:bg-primary/90">
            + New Template
          </button>
        </div>
        {templates.length === 0 ? (
          <div className="p-8 text-center text-sm text-gray-400 dark:text-gray-500">No email templates yet. Create one to customize outgoing emails.</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs text-gray-500 dark:text-gray-400 uppercase border-b border-gray-100 dark:border-gray-800">
                  <th className="px-4 py-3">Slug</th>
                  <th className="px-4 py-3">Subject</th>
                  <th className="px-4 py-3 w-24">Type</th>
                  <th className="px-4 py-3 w-20">Active</th>
                  <th className="px-4 py-3 w-24" />
                </tr>
              </thead>
              <tbody>
                {templates.map((t) => (
                  <tr key={t.id} className="border-b border-gray-50 hover:bg-gray-50/50">
                    <td className="px-4 py-3 font-mono text-xs text-gray-700 dark:text-gray-300">{t.slug}</td>
                    <td className="px-4 py-3">{t.subject}</td>
                    <td className="px-4 py-3 text-gray-500 dark:text-gray-400">{t.type || '-'}</td>
                    <td className="px-4 py-3">
                      <span className={`text-xs px-2 py-0.5 rounded ${t.active ? 'bg-green-50 text-green-700' : 'bg-gray-100 text-gray-500'}`}>
                        {t.active ? 'Yes' : 'No'}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex gap-2">
                        <button onClick={() => startEdit(t)} className="text-xs text-primary hover:underline">Edit</button>
                        <button onClick={() => deleteTemplate(t.id)} className="text-xs text-red-500 hover:underline">Delete</button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </SettingsSection>
    </SettingsPageLayout>
  );
}
