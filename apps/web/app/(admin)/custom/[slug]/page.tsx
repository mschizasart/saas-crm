'use client';

/**
 * /custom/[slug] — dynamic record list for a custom object (Wave D3).
 *
 * Columns show the first 4 fields (in `order` order). Search hits any
 * `text` field on the server; the API filters with jsonb path lookups.
 * Style matches /leads list view.
 */

import { use, useEffect, useState } from 'react';
import Link from 'next/link';
import { Package } from 'lucide-react';
import { apiFetch } from '@/lib/api';
import { ListPageLayout } from '@/components/layouts/list-page-layout';
import { Card } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/empty-state';
import { ErrorBanner } from '@/components/ui/error-banner';

type FieldType = 'text' | 'number' | 'date' | 'boolean' | 'select' | 'relation';

interface Field {
  id: string;
  label: string;
  key: string;
  fieldType: FieldType;
  options: Record<string, any>;
  required: boolean;
  order: number;
}

interface CustomObject {
  id: string;
  name: string;
  slug: string;
  pluralName: string;
  fields: Field[];
}

interface Record {
  id: string;
  data: Record<string, any>;
  createdAt: string;
}

interface ListResponse {
  data: Record[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

function formatCell(field: Field, value: any): string {
  if (value == null || value === '') return '—';
  switch (field.fieldType) {
    case 'boolean':
      return value ? 'Yes' : 'No';
    case 'date':
      try { return new Date(value).toLocaleDateString(); } catch { return String(value); }
    default:
      return String(value);
  }
}

export default function CustomRecordsListPage({
  params,
}: {
  params: Promise<{ slug: string }> | { slug: string };
}) {
  const { slug } = 'then' in (params as any) ? use(params as Promise<{ slug: string }>) : (params as { slug: string });

  const [object, setObject] = useState<CustomObject | null>(null);
  const [records, setRecords] = useState<Record[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState('');

  // Load the object definition once via the /custom-objects list so we
  // don't need a slug-specific definition endpoint on the API side.
  async function loadObject() {
    const res = await apiFetch('/api/v1/custom-objects');
    if (!res.ok) throw new Error(`Failed to load object (${res.status})`);
    const all: CustomObject[] = await res.json();
    const match = all.find((o) => o.slug === slug);
    if (!match) throw new Error(`Custom object "${slug}" not found`);
    setObject(match);
  }

  async function loadRecords() {
    setLoading(true);
    setError(null);
    try {
      if (!object) await loadObject();
      const qs = new URLSearchParams();
      if (search) qs.set('search', search);
      const res = await apiFetch(`/api/v1/custom-objects/${slug}/records?${qs.toString()}`);
      if (!res.ok) throw new Error(`Server responded with ${res.status}`);
      const json: ListResponse = await res.json();
      setRecords(json.data);
      setTotal(json.total);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load records');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadRecords();
    // We re-load when slug changes (different object) OR when search
    // changes (server-side filter).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [slug, search]);

  // The "first 4 fields" rule keeps the table at a sane width — the
  // detail page shows the rest.
  const visibleFields = (object?.fields ?? []).slice(0, 4);

  const filters = (
    <input
      type="text"
      value={search}
      onChange={(e) => setSearch(e.target.value)}
      placeholder="Search…"
      className="px-3 py-2 text-xs font-medium border border-gray-200 dark:border-gray-700 rounded-lg bg-white text-gray-700 dark:text-gray-300 focus:outline-none focus:ring-2 focus:ring-primary/30"
    />
  );

  return (
    <ListPageLayout
      title={object?.pluralName ?? slug}
      subtitle={!loading ? `${total} record${total !== 1 ? 's' : ''}` : undefined}
      primaryAction={{
        label: `New ${object?.name ?? 'Record'}`,
        href: `/custom/${slug}/new`,
        icon: <span className="text-lg leading-none">+</span>,
      }}
      filters={filters}
    >
      {error && (
        <div className="mb-4">
          <ErrorBanner message={error} />
        </div>
      )}

      <Card>
        <div className="overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead>
              <tr className="bg-gray-50 dark:bg-gray-900 border-b border-gray-100 dark:border-gray-800 text-left text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide">
                {visibleFields.map((f) => (
                  <th key={f.id} className="px-4 py-3">{f.label}</th>
                ))}
                <th className="px-4 py-3 text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan={visibleFields.length + 1} className="px-4 py-10 text-center text-gray-400">
                    Loading…
                  </td>
                </tr>
              ) : records.length === 0 ? (
                <tr>
                  <td colSpan={Math.max(visibleFields.length + 1, 1)} className="px-4 py-8">
                    <EmptyState
                      icon={<Package className="w-10 h-10" />}
                      title={`No ${object?.pluralName?.toLowerCase() ?? 'records'} yet`}
                      action={{ label: `Add your first ${object?.name?.toLowerCase() ?? 'record'}`, href: `/custom/${slug}/new` }}
                    />
                  </td>
                </tr>
              ) : (
                records.map((r) => (
                  <tr
                    key={r.id}
                    className="border-b border-gray-100 dark:border-gray-800 last:border-0 hover:bg-gray-50/60 transition-colors"
                  >
                    {visibleFields.map((f) => (
                      <td key={f.id} className="px-4 py-3 text-gray-700 dark:text-gray-300">
                        {formatCell(f, r.data?.[f.key])}
                      </td>
                    ))}
                    <td className="px-4 py-3 text-right">
                      <Link
                        href={`/custom/${slug}/${r.id}`}
                        className="text-xs text-gray-500 dark:text-gray-400 hover:text-primary font-medium"
                      >
                        View
                      </Link>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </Card>
    </ListPageLayout>
  );
}
