'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { ClipboardList, Copy, Check, ExternalLink, Trash2, Edit3 } from 'lucide-react';
import { ListPageLayout } from '@/components/layouts/list-page-layout';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { EmptyState } from '@/components/ui/empty-state';
import { ErrorBanner } from '@/components/ui/error-banner';
import { TableSkeleton } from '@/components/ui/table-skeleton';
import { apiFetch } from '@/lib/api';
import { useToast } from '@/components/toast-provider';

// ---------------------------------------------------------------------------

interface LeadForm {
  id: string;
  slug: string;
  name: string;
  title: string;
  description: string | null;
  isActive: boolean;
  submissionCount: number;
  createdAt: string;
}

interface OrgResponse {
  id: string;
  slug?: string | null;
}

// Origin for embed snippet / public page. In prod this is appoinlycrm.net; in
// dev it falls back to the current browser origin.
function publicOrigin(): string {
  if (typeof window === 'undefined') return '';
  const envOrigin = process.env.NEXT_PUBLIC_APP_URL;
  return envOrigin || window.location.origin;
}

export default function LeadFormsListPage() {
  const router = useRouter();
  const { show } = useToast();

  const [forms, setForms] = useState<LeadForm[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [orgSlug, setOrgSlug] = useState<string>('');
  const [copiedId, setCopiedId] = useState<string | null>(null);

  // Load org slug (fall back to id if slug isn't set on the org row).
  useEffect(() => {
    (async () => {
      try {
        const res = await apiFetch('/api/v1/organizations/current');
        if (!res.ok) return;
        const data: OrgResponse = await res.json();
        setOrgSlug(data.slug || data.id || '');
      } catch {
        /* ignore */
      }
    })();
  }, []);

  const fetchForms = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await apiFetch('/api/v1/lead-forms');
      if (!res.ok) throw new Error(`Server responded with ${res.status}`);
      const data = await res.json();
      setForms(Array.isArray(data) ? data : data.data ?? []);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load forms');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchForms();
  }, [fetchForms]);

  const handleDelete = async (form: LeadForm) => {
    if (!confirm(`Delete the form "${form.name}"? This cannot be undone.`)) return;
    try {
      const res = await apiFetch(`/api/v1/lead-forms/${form.id}`, { method: 'DELETE' });
      if (!res.ok && res.status !== 204) {
        throw new Error(`Failed: ${res.status}`);
      }
      show({ title: 'Form deleted', type: 'success' });
      setForms((prev) => prev.filter((f) => f.id !== form.id));
    } catch (err) {
      show({ title: err instanceof Error ? err.message : 'Delete failed', type: 'error' });
    }
  };

  const handleCopySnippet = async (form: LeadForm) => {
    const origin = publicOrigin();
    const snippet = `<iframe src="${origin}/forms/${orgSlug}/${form.slug}" width="100%" height="600" frameborder="0"></iframe>`;
    try {
      await navigator.clipboard.writeText(snippet);
      setCopiedId(form.id);
      show({ title: 'Embed snippet copied', type: 'success' });
      setTimeout(() => setCopiedId((c) => (c === form.id ? null : c)), 1800);
    } catch {
      show({ title: 'Copy failed — clipboard API unavailable', type: 'error' });
    }
  };

  const handleCreate = async () => {
    // Quick-create: pop a new form with sensible defaults and jump into the editor.
    const defaultSlug = `form-${Math.random().toString(36).slice(2, 7)}`;
    try {
      const res = await apiFetch('/api/v1/lead-forms', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          slug: defaultSlug,
          name: 'New form',
          title: 'Request a quote',
          description: null,
          fields: [
            { key: 'name', label: 'Your name', type: 'text', required: true },
            { key: 'email', label: 'Email', type: 'email', required: true },
            { key: 'message', label: 'How can we help?', type: 'textarea', required: false },
          ],
          captchaEnabled: true,
          isActive: true,
        }),
      });
      if (!res.ok) {
        const txt = await res.text();
        throw new Error(txt || `Create failed: ${res.status}`);
      }
      const created: LeadForm = await res.json();
      router.push(`/leads/forms/${created.id}`);
    } catch (err) {
      show({ title: err instanceof Error ? err.message : 'Create failed', type: 'error' });
    }
  };

  return (
    <ListPageLayout
      title="Web-to-lead forms"
      subtitle={
        !loading
          ? `${forms.length} form${forms.length === 1 ? '' : 's'} — submissions become leads in your CRM`
          : undefined
      }
      primaryAction={{ label: 'New form', onClick: handleCreate, icon: <span className="text-lg leading-none">+</span> }}
      secondaryActions={[{ label: 'Back to leads', href: '/leads' }]}
    >
      {error && (
        <div className="mb-4">
          <ErrorBanner message={error} />
        </div>
      )}

      {loading ? (
        <Card>
          <table className="min-w-full text-sm">
            <tbody>
              <TableSkeleton rows={4} columns={5} />
            </tbody>
          </table>
        </Card>
      ) : forms.length === 0 ? (
        <EmptyState
          icon={<ClipboardList className="w-10 h-10" />}
          title="No forms yet"
          description="Create a form, embed it on your website, and every submission becomes a Lead."
          action={{ label: 'Create your first form', onClick: handleCreate }}
        />
      ) : (
        <Card>
          <div className="overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead>
                <tr className="bg-gray-50 dark:bg-gray-900 border-b border-gray-100 dark:border-gray-800 text-left text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide">
                  <th className="px-4 py-3">Name</th>
                  <th className="px-4 py-3 hidden md:table-cell">Slug</th>
                  <th className="px-4 py-3">Submissions</th>
                  <th className="px-4 py-3">Status</th>
                  <th className="px-4 py-3 text-right">Actions</th>
                </tr>
              </thead>
              <tbody>
                {forms.map((f) => {
                  const origin = publicOrigin();
                  const url = `${origin}/forms/${orgSlug}/${f.slug}`;
                  return (
                    <tr
                      key={f.id}
                      className="border-b border-gray-100 dark:border-gray-800 last:border-0 hover:bg-gray-50/60 dark:hover:bg-gray-800/30 transition-colors"
                    >
                      <td className="px-4 py-3">
                        <Link
                          href={`/leads/forms/${f.id}`}
                          className="font-medium text-gray-900 dark:text-gray-100 hover:text-primary"
                        >
                          {f.name}
                        </Link>
                        <p className="text-xs text-gray-500 dark:text-gray-400 truncate max-w-[40ch]">
                          {f.title}
                        </p>
                      </td>
                      <td className="px-4 py-3 hidden md:table-cell text-gray-500 dark:text-gray-400">
                        <code className="text-xs bg-gray-100 dark:bg-gray-800 rounded px-1.5 py-0.5">
                          {f.slug}
                        </code>
                      </td>
                      <td className="px-4 py-3 font-semibold text-gray-700 dark:text-gray-300">
                        {f.submissionCount}
                      </td>
                      <td className="px-4 py-3">
                        {f.isActive ? (
                          <Badge variant="success">Active</Badge>
                        ) : (
                          <Badge variant="muted">Inactive</Badge>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex items-center justify-end gap-2">
                          <a
                            href={url}
                            target="_blank"
                            rel="noreferrer"
                            title="Open public form"
                            className="p-1.5 rounded hover:bg-gray-100 dark:hover:bg-gray-800 text-gray-500 dark:text-gray-400 hover:text-primary"
                          >
                            <ExternalLink className="w-4 h-4" />
                          </a>
                          <button
                            onClick={() => handleCopySnippet(f)}
                            title="Copy embed snippet"
                            className="p-1.5 rounded hover:bg-gray-100 dark:hover:bg-gray-800 text-gray-500 dark:text-gray-400 hover:text-primary"
                          >
                            {copiedId === f.id ? (
                              <Check className="w-4 h-4 text-green-500" />
                            ) : (
                              <Copy className="w-4 h-4" />
                            )}
                          </button>
                          <Link
                            href={`/leads/forms/${f.id}`}
                            title="Edit"
                            className="p-1.5 rounded hover:bg-gray-100 dark:hover:bg-gray-800 text-gray-500 dark:text-gray-400 hover:text-primary"
                          >
                            <Edit3 className="w-4 h-4" />
                          </Link>
                          <button
                            onClick={() => handleDelete(f)}
                            title="Delete"
                            className="p-1.5 rounded hover:bg-red-50 dark:hover:bg-red-500/10 text-gray-500 dark:text-gray-400 hover:text-red-600"
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </Card>
      )}
    </ListPageLayout>
  );
}
