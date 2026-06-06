'use client';

/**
 * /custom/[slug]/[recordId] — view + edit a single record (Wave D3).
 *
 * Uses the same <RecordForm/> component as /new but seeds it with the
 * existing record's `data` blob. Saving issues a PUT to
 * /custom-objects/:slug/records/:recordId. Delete is a confirm-then-
 * DELETE that navigates back to the list view.
 */

import { use, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { apiFetch } from '@/lib/api';
import { FormPageLayout } from '@/components/layouts/form-page-layout';
import { ErrorBanner } from '@/components/ui/error-banner';
import { RecordForm, RecordFormField } from '../_record-form';

interface CustomObject {
  id: string;
  name: string;
  slug: string;
  pluralName: string;
  fields: RecordFormField[];
}

interface RecordRow {
  id: string;
  data: Record<string, any>;
  createdAt: string;
  updatedAt: string;
}

export default function CustomRecordDetailPage({
  params,
}: {
  params: Promise<{ slug: string; recordId: string }> | { slug: string; recordId: string };
}) {
  const { slug, recordId } = 'then' in (params as any)
    ? use(params as Promise<{ slug: string; recordId: string }>)
    : (params as { slug: string; recordId: string });
  const router = useRouter();

  const [object, setObject] = useState<CustomObject | null>(null);
  const [record, setRecord] = useState<RecordRow | null>(null);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoading(true);
      setError(null);
      try {
        // Resolve the object first (we need the field defs) and the
        // record in parallel — both are scoped to the active org by the
        // API guard.
        const [objRes, recRes] = await Promise.all([
          apiFetch('/api/v1/custom-objects'),
          apiFetch(`/api/v1/custom-objects/${slug}/records/${recordId}`),
        ]);
        if (!objRes.ok) throw new Error(`Failed to load object (${objRes.status})`);
        if (!recRes.ok) throw new Error(`Failed to load record (${recRes.status})`);
        const all: CustomObject[] = await objRes.json();
        const match = all.find((o) => o.slug === slug);
        if (!match) throw new Error(`Custom object "${slug}" not found`);
        const r: RecordRow = await recRes.json();
        if (!cancelled) { setObject(match); setRecord(r); }
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Failed to load');
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    void load();
    return () => { cancelled = true; };
  }, [slug, recordId]);

  async function save(data: Record<string, any>) {
    setSubmitting(true);
    setError(null);
    try {
      const res = await apiFetch(`/api/v1/custom-objects/${slug}/records/${recordId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ data }),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        const firstError = j?.errors ? Object.values(j.errors)[0] : null;
        throw new Error(firstError || j.message || `Failed (${res.status})`);
      }
      router.push(`/custom/${slug}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save');
    } finally {
      setSubmitting(false);
    }
  }

  async function remove() {
    if (!confirm('Delete this record? This cannot be undone.')) return;
    try {
      const res = await apiFetch(`/api/v1/custom-objects/${slug}/records/${recordId}`, {
        method: 'DELETE',
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        throw new Error(j.message || `Failed (${res.status})`);
      }
      router.push(`/custom/${slug}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to delete');
    }
  }

  if (loading) {
    return <div className="p-6 text-sm text-gray-500 dark:text-gray-400">Loading…</div>;
  }
  if (!object || !record) {
    return <div className="p-6 text-sm text-red-600">{error || 'Not found'}</div>;
  }

  return (
    <FormPageLayout
      title={`Edit ${object.name}`}
      backHref={`/custom/${slug}`}
      backLabel={`Back to ${object.pluralName}`}
    >
      {error && (
        <div className="mb-4">
          <ErrorBanner message={error} />
        </div>
      )}

      <RecordForm
        fields={[...object.fields].sort((a, b) => a.order - b.order)}
        initial={record.data}
        submitting={submitting}
        submitLabel="Save changes"
        onSubmit={save}
        onCancel={() => router.push(`/custom/${slug}`)}
      />

      <div className="mt-6 pt-4 border-t border-gray-100 dark:border-gray-800 flex items-center justify-end">
        <button
          type="button"
          onClick={remove}
          className="text-xs text-red-600 hover:text-red-700 font-medium"
        >
          Delete this {object.name.toLowerCase()}
        </button>
      </div>
    </FormPageLayout>
  );
}
