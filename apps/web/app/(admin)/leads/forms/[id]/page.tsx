'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import {
  Plus,
  Trash2,
  ArrowUp,
  ArrowDown,
  Copy,
  Check,
  ExternalLink,
} from 'lucide-react';
import { PageHeader } from '@/components/ui/page-header';
import { Card, CardBody, CardHeader } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { ErrorBanner } from '@/components/ui/error-banner';
import { inputClass, FormField } from '@/components/ui/form-field';
import { apiFetch } from '@/lib/api';
import { useToast } from '@/components/toast-provider';

// ---------------------------------------------------------------------------

const FIELD_TYPES = [
  { value: 'text', label: 'Text' },
  { value: 'email', label: 'Email' },
  { value: 'phone', label: 'Phone' },
  { value: 'textarea', label: 'Long text' },
  { value: 'select', label: 'Dropdown' },
] as const;
type FieldType = (typeof FIELD_TYPES)[number]['value'];

interface FormFieldRow {
  key: string;
  label: string;
  type: FieldType;
  required: boolean;
  options?: string[];
}

interface LeadForm {
  id: string;
  slug: string;
  name: string;
  title: string;
  description: string | null;
  fields: FormFieldRow[];
  redirectUrl: string | null;
  captchaEnabled: boolean;
  notifyEmail: string | null;
  assignToUserId: string | null;
  isActive: boolean;
  submissionCount: number;
}

function publicOrigin(): string {
  if (typeof window === 'undefined') return '';
  return process.env.NEXT_PUBLIC_APP_URL || window.location.origin;
}

function slugify(s: string): string {
  return s
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
}

function toKey(s: string): string {
  const cleaned = s
    .normalize('NFKD')
    .replace(/[^a-zA-Z0-9_]+/g, '_')
    .replace(/^_+|_+$/g, '');
  const prefixed = /^[a-zA-Z]/.test(cleaned) ? cleaned : `f_${cleaned}`;
  return prefixed.slice(0, 64) || 'field';
}

// ---------------------------------------------------------------------------

export default function LeadFormEditorPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const { show } = useToast();
  const id = params?.id;

  const [form, setForm] = useState<LeadForm | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [orgSlug, setOrgSlug] = useState('');
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        const res = await apiFetch('/api/v1/organizations/current');
        if (res.ok) {
          const data = await res.json();
          setOrgSlug(data.slug || data.id || '');
        }
      } catch {
        /* ignore */
      }
    })();
  }, []);

  const loadForm = useCallback(async () => {
    if (!id) return;
    setLoading(true);
    setError(null);
    try {
      const res = await apiFetch(`/api/v1/lead-forms/${id}`);
      if (!res.ok) throw new Error(`Failed to load form (${res.status})`);
      const data = await res.json();
      setForm({
        ...data,
        fields: Array.isArray(data.fields) ? data.fields : [],
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load');
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    loadForm();
  }, [loadForm]);

  const updateField = <K extends keyof LeadForm>(k: K, v: LeadForm[K]) => {
    setForm((prev) => (prev ? { ...prev, [k]: v } : prev));
  };

  const addFieldRow = () => {
    if (!form) return;
    const key = `field_${form.fields.length + 1}`;
    setForm({
      ...form,
      fields: [
        ...form.fields,
        { key, label: `Field ${form.fields.length + 1}`, type: 'text', required: false },
      ],
    });
  };

  const patchFieldRow = (idx: number, patch: Partial<FormFieldRow>) => {
    setForm((prev) => {
      if (!prev) return prev;
      const next = prev.fields.slice();
      const current = next[idx];
      const merged: FormFieldRow = { ...current, ...patch };
      // If the label changed and the key still looks auto-generated, keep them in sync.
      if (patch.label && current.key === toKey(current.label)) {
        merged.key = toKey(patch.label);
      }
      next[idx] = merged;
      return { ...prev, fields: next };
    });
  };

  const removeFieldRow = (idx: number) => {
    setForm((prev) => {
      if (!prev) return prev;
      return { ...prev, fields: prev.fields.filter((_, i) => i !== idx) };
    });
  };

  const moveFieldRow = (idx: number, dir: -1 | 1) => {
    setForm((prev) => {
      if (!prev) return prev;
      const next = prev.fields.slice();
      const target = idx + dir;
      if (target < 0 || target >= next.length) return prev;
      [next[idx], next[target]] = [next[target], next[idx]];
      return { ...prev, fields: next };
    });
  };

  const handleSave = async () => {
    if (!form) return;
    setSaving(true);
    setError(null);
    try {
      // Normalize keys and strip empty options.
      const cleanedFields = form.fields.map((f) => ({
        key: toKey(f.key || f.label),
        label: f.label.trim(),
        type: f.type,
        required: !!f.required,
        options:
          f.type === 'select'
            ? (f.options ?? []).map((o) => o.trim()).filter(Boolean)
            : undefined,
      }));
      const payload = {
        slug: slugify(form.slug) || form.slug,
        name: form.name,
        title: form.title,
        description: form.description || undefined,
        fields: cleanedFields,
        redirectUrl: form.redirectUrl || undefined,
        captchaEnabled: form.captchaEnabled,
        notifyEmail: form.notifyEmail || undefined,
        assignToUserId: form.assignToUserId || undefined,
        isActive: form.isActive,
      };
      const res = await apiFetch(`/api/v1/lead-forms/${form.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        const body = await res.text().catch(() => '');
        throw new Error(body || `Save failed (${res.status})`);
      }
      show({ title: 'Form saved', type: 'success' });
      await loadForm();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Save failed');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!form) return;
    if (!confirm(`Delete "${form.name}"? This cannot be undone.`)) return;
    try {
      const res = await apiFetch(`/api/v1/lead-forms/${form.id}`, { method: 'DELETE' });
      if (!res.ok && res.status !== 204) throw new Error(`Failed: ${res.status}`);
      show({ title: 'Form deleted', type: 'success' });
      router.push('/leads/forms');
    } catch (err) {
      show({ title: err instanceof Error ? err.message : 'Delete failed', type: 'error' });
    }
  };

  const publicUrl = useMemo(() => {
    if (!form || !orgSlug) return '';
    return `${publicOrigin()}/forms/${orgSlug}/${form.slug}`;
  }, [form, orgSlug]);

  const embedSnippet = useMemo(() => {
    if (!publicUrl) return '';
    return `<iframe src="${publicUrl}" width="100%" height="600" frameborder="0"></iframe>`;
  }, [publicUrl]);

  const copySnippet = async () => {
    if (!embedSnippet) return;
    try {
      await navigator.clipboard.writeText(embedSnippet);
      setCopied(true);
      show({ title: 'Snippet copied', type: 'success' });
      setTimeout(() => setCopied(false), 1600);
    } catch {
      show({ title: 'Copy failed', type: 'error' });
    }
  };

  if (loading || !form) {
    return (
      <div className="max-w-6xl mx-auto">
        <PageHeader title="Edit form" backHref="/leads/forms" />
        {error ? <ErrorBanner message={error} /> : <p className="text-sm text-gray-500">Loading…</p>}
      </div>
    );
  }

  return (
    <div className="max-w-6xl mx-auto">
      <PageHeader
        title={form.name || 'Edit form'}
        subtitle={`${form.submissionCount} submission${form.submissionCount === 1 ? '' : 's'}`}
        backHref="/leads/forms"
        primaryAction={{ label: saving ? 'Saving…' : 'Save form', onClick: handleSave, disabled: saving }}
        secondaryActions={[
          { label: 'Delete', onClick: handleDelete },
        ]}
      />

      {error && (
        <div className="mb-4">
          <ErrorBanner message={error} />
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-5 gap-6">
        {/* ─── Settings + fields ────────────────────────────────── */}
        <div className="lg:col-span-3 space-y-6">
          <Card>
            <CardHeader>
              <h2 className="text-sm font-semibold text-gray-900 dark:text-gray-100">Settings</h2>
            </CardHeader>
            <CardBody>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <FormField label="Internal name" required>
                  <input
                    className={inputClass}
                    value={form.name}
                    onChange={(e) => updateField('name', e.target.value)}
                    placeholder="e.g. Quote request"
                  />
                </FormField>
                <FormField label="Slug (URL)" required hint="Lowercase, hyphens. Must be unique.">
                  <input
                    className={inputClass}
                    value={form.slug}
                    onChange={(e) => updateField('slug', slugify(e.target.value))}
                    placeholder="quote-request"
                  />
                </FormField>
                <FormField label="Public title" required>
                  <input
                    className={inputClass}
                    value={form.title}
                    onChange={(e) => updateField('title', e.target.value)}
                    placeholder="Request a quote"
                  />
                </FormField>
                <FormField label="Notify email" hint="Optional — sent on each submission">
                  <input
                    className={inputClass}
                    type="email"
                    value={form.notifyEmail ?? ''}
                    onChange={(e) => updateField('notifyEmail', e.target.value)}
                    placeholder="sales@yourcompany.com"
                  />
                </FormField>
                <FormField label="Description" className="md:col-span-2" hint="Shown above the form fields">
                  <textarea
                    className={inputClass}
                    rows={2}
                    value={form.description ?? ''}
                    onChange={(e) => updateField('description', e.target.value)}
                  />
                </FormField>
                <FormField label="Redirect URL" hint="Optional — users are redirected here after submitting">
                  <input
                    className={inputClass}
                    value={form.redirectUrl ?? ''}
                    onChange={(e) => updateField('redirectUrl', e.target.value)}
                    placeholder="https://example.com/thanks"
                  />
                </FormField>
                <FormField label="Assign to user ID" hint="Optional — default assignee for new leads">
                  <input
                    className={inputClass}
                    value={form.assignToUserId ?? ''}
                    onChange={(e) => updateField('assignToUserId', e.target.value)}
                    placeholder="UUID"
                  />
                </FormField>
                <div className="md:col-span-2 flex gap-6 pt-2">
                  <label className="inline-flex items-center gap-2 text-sm text-gray-700 dark:text-gray-300 cursor-pointer">
                    <input
                      type="checkbox"
                      className="rounded border-gray-300 text-primary focus:ring-primary/30"
                      checked={form.isActive}
                      onChange={(e) => updateField('isActive', e.target.checked)}
                    />
                    Active
                  </label>
                  <label className="inline-flex items-center gap-2 text-sm text-gray-700 dark:text-gray-300 cursor-pointer">
                    <input
                      type="checkbox"
                      className="rounded border-gray-300 text-primary focus:ring-primary/30"
                      checked={form.captchaEnabled}
                      onChange={(e) => updateField('captchaEnabled', e.target.checked)}
                    />
                    Spam protection (honeypot)
                  </label>
                </div>
              </div>
            </CardBody>
          </Card>

          {/* Fields */}
          <Card>
            <CardHeader>
              <div className="flex items-center justify-between">
                <h2 className="text-sm font-semibold text-gray-900 dark:text-gray-100">Fields</h2>
                <Button size="sm" variant="secondary" icon={<Plus className="w-4 h-4" />} onClick={addFieldRow}>
                  Add field
                </Button>
              </div>
            </CardHeader>
            <CardBody>
              {form.fields.length === 0 ? (
                <p className="text-sm text-gray-500 dark:text-gray-400 py-4 text-center">
                  No fields yet. Click “Add field” to get started.
                </p>
              ) : (
                <ul className="space-y-3">
                  {form.fields.map((f, idx) => (
                    <li
                      key={idx}
                      className="rounded-lg border border-gray-200 dark:border-gray-800 p-3 bg-gray-50/40 dark:bg-gray-900/40"
                    >
                      <div className="grid grid-cols-1 md:grid-cols-12 gap-2 items-start">
                        <div className="md:col-span-4">
                          <label className="text-[10px] uppercase tracking-wide text-gray-400">Label</label>
                          <input
                            className={inputClass}
                            value={f.label}
                            onChange={(e) => patchFieldRow(idx, { label: e.target.value })}
                          />
                        </div>
                        <div className="md:col-span-3">
                          <label className="text-[10px] uppercase tracking-wide text-gray-400">Key</label>
                          <input
                            className={inputClass}
                            value={f.key}
                            onChange={(e) => patchFieldRow(idx, { key: e.target.value })}
                          />
                        </div>
                        <div className="md:col-span-2">
                          <label className="text-[10px] uppercase tracking-wide text-gray-400">Type</label>
                          <select
                            className={inputClass}
                            value={f.type}
                            onChange={(e) =>
                              patchFieldRow(idx, { type: e.target.value as FieldType })
                            }
                          >
                            {FIELD_TYPES.map((t) => (
                              <option key={t.value} value={t.value}>
                                {t.label}
                              </option>
                            ))}
                          </select>
                        </div>
                        <div className="md:col-span-2 flex items-center gap-2 pt-5">
                          <label className="inline-flex items-center gap-1.5 text-xs text-gray-600 dark:text-gray-400 cursor-pointer">
                            <input
                              type="checkbox"
                              className="rounded border-gray-300 text-primary focus:ring-primary/30"
                              checked={f.required}
                              onChange={(e) => patchFieldRow(idx, { required: e.target.checked })}
                            />
                            Required
                          </label>
                        </div>
                        <div className="md:col-span-1 flex items-center justify-end gap-1 pt-5">
                          <button
                            onClick={() => moveFieldRow(idx, -1)}
                            title="Move up"
                            className="p-1 rounded hover:bg-gray-200 dark:hover:bg-gray-800 text-gray-500"
                          >
                            <ArrowUp className="w-3.5 h-3.5" />
                          </button>
                          <button
                            onClick={() => moveFieldRow(idx, 1)}
                            title="Move down"
                            className="p-1 rounded hover:bg-gray-200 dark:hover:bg-gray-800 text-gray-500"
                          >
                            <ArrowDown className="w-3.5 h-3.5" />
                          </button>
                          <button
                            onClick={() => removeFieldRow(idx)}
                            title="Remove"
                            className="p-1 rounded hover:bg-red-50 dark:hover:bg-red-500/10 text-gray-500 hover:text-red-600"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>

                        {f.type === 'select' && (
                          <div className="md:col-span-12">
                            <label className="text-[10px] uppercase tracking-wide text-gray-400">
                              Options (one per line)
                            </label>
                            <textarea
                              className={inputClass}
                              rows={3}
                              value={(f.options ?? []).join('\n')}
                              onChange={(e) =>
                                patchFieldRow(idx, {
                                  options: e.target.value.split('\n').map((s) => s.trim()).filter(Boolean),
                                })
                              }
                            />
                          </div>
                        )}
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </CardBody>
          </Card>

          {/* Embed */}
          <Card>
            <CardHeader>
              <h2 className="text-sm font-semibold text-gray-900 dark:text-gray-100">Embed</h2>
            </CardHeader>
            <CardBody>
              <div className="flex items-center gap-2 mb-3">
                <a
                  href={publicUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="text-xs text-primary hover:underline inline-flex items-center gap-1"
                >
                  <ExternalLink className="w-3.5 h-3.5" />
                  Open public form
                </a>
                {!form.isActive && (
                  <Badge variant="warning">Inactive — public page won’t render</Badge>
                )}
              </div>
              <pre className="text-xs bg-gray-50 dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-lg p-3 overflow-x-auto">
{embedSnippet}
              </pre>
              <div className="mt-2 flex justify-end">
                <Button
                  size="sm"
                  variant="secondary"
                  icon={copied ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
                  onClick={copySnippet}
                >
                  {copied ? 'Copied' : 'Copy snippet'}
                </Button>
              </div>
            </CardBody>
          </Card>
        </div>

        {/* ─── Live preview ─────────────────────────────────────── */}
        <div className="lg:col-span-2">
          <div className="lg:sticky lg:top-4">
            <Card>
              <CardHeader>
                <h2 className="text-sm font-semibold text-gray-900 dark:text-gray-100">Preview</h2>
              </CardHeader>
              <CardBody>
                <div className="rounded-lg border border-gray-200 dark:border-gray-800 p-4 bg-white dark:bg-gray-900">
                  <h3 className="text-base font-semibold text-gray-900 dark:text-gray-100">
                    {form.title || 'Untitled form'}
                  </h3>
                  {form.description && (
                    <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">{form.description}</p>
                  )}
                  <div className="mt-4 space-y-3">
                    {form.fields.map((f, idx) => (
                      <div key={idx}>
                        <label className="block text-xs font-medium text-gray-700 dark:text-gray-300 mb-1">
                          {f.label}
                          {f.required && <span className="text-red-500 ml-0.5">*</span>}
                        </label>
                        {f.type === 'textarea' ? (
                          <textarea className={inputClass} rows={3} disabled />
                        ) : f.type === 'select' ? (
                          <select className={inputClass} disabled>
                            <option>—</option>
                            {(f.options ?? []).map((o, i) => (
                              <option key={i}>{o}</option>
                            ))}
                          </select>
                        ) : (
                          <input className={inputClass} type={f.type === 'email' ? 'email' : 'text'} disabled />
                        )}
                      </div>
                    ))}
                    <Button className="w-full" disabled>
                      Submit
                    </Button>
                  </div>
                </div>
                <p className="text-[11px] text-gray-400 dark:text-gray-500 mt-2 text-center">
                  Preview is static — <Link href={publicUrl} target="_blank" className="underline">open the live form</Link> to try it.
                </p>
              </CardBody>
            </Card>
          </div>
        </div>
      </div>
    </div>
  );
}
