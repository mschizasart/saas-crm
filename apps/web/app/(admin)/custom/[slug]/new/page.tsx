'use client';

/**
 * /custom/[slug]/new — create a record for a custom object (Wave D3).
 *
 * Resolves the slug to the object def via /custom-objects/list, then
 * renders the shared <RecordForm/> with that object's fields. On
 * submit, POSTs to /custom-objects/:slug/records and redirects to the
 * list view.
 */

import { use, useEffect, useState } from 'react';
import Link from 'next/link';
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

export default function NewCustomRecordPage({
  params,
}: {
  params: Promise<{ slug: string }> | { slug: string };
}) {
  const { slug } = 'then' in (params as any) ? use(params as Promise<{ slug: string }>) : (params as { slug: string });
  const router = useRouter();

  const [object, setObject] = useState<CustomObject | null>(null);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoading(true);
      try {
        const res = await apiFetch('/api/v1/custom-objects');
        if (!res.ok) throw new Error(`Failed to load object (${res.status})`);
        const all: CustomObject[] = await res.json();
        const match = all.find((o) => o.slug === slug);
        if (!match) throw new Error(`Custom object "${slug}" not found`);
        if (!cancelled) setObject(match);
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Failed to load');
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    void load();
    return () => { cancelled = true; };
  }, [slug]);

  async function submit(data: Record<string, any>) {
    setSubmitting(true);
    setError(null);
    try {
      const res = await apiFetch(`/api/v1/custom-objects/${slug}/records`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ data }),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        // The API returns { message, errors: { key: msg } } on validation
        // failures — surface the first one if available.
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

  if (loading) {
    return <div className="p-6 text-sm text-gray-500 dark:text-gray-400">Loading…</div>;
  }
  if (!object) {
    return <div className="p-6 text-sm text-red-600">{error || 'Not found'}</div>;
  }

  return (
    <FormPageLayout
      title={`New ${object.name}`}
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
        submitting={submitting}
        submitLabel={`Create ${object.name}`}
        onSubmit={submit}
        onCancel={() => router.push(`/custom/${slug}`)}
      />
    </FormPageLayout>
  );
}
