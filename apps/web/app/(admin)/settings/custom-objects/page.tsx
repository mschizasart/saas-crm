'use client';

/**
 * Settings → Custom Objects (Wave D3)
 *
 * Lists every custom-object definition the org has created and lets
 * admins spin up new ones via the "+ New Object" modal. The slug
 * auto-derives from the name (lower-snake-cased) but stays editable so
 * the user can override it — it's the public URL key under
 * `/custom/<slug>/records` so it must stay reserved-word-safe.
 */

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { Package, Plus, X } from 'lucide-react';
import { apiFetch } from '@/lib/api';
import { SettingsPageLayout, SettingsSection } from '@/components/layouts/settings-page-layout';
import { typography } from '@/lib/ui-tokens';

interface CustomObject {
  id: string;
  name: string;
  slug: string;
  pluralName: string;
  icon: string | null;
  _count?: { records: number };
}

// Reserved-word list MUST stay in sync with the API
// (apps/api/src/modules/custom-objects/validation.ts → RESERVED_SLUGS).
// Mirrored here so we can surface the rule pre-submit instead of round-tripping.
const RESERVED_SLUGS = [
  'admin','api','platform','public','settings','clients','leads','invoices','tickets',
  'users','organizations','staff','opportunities','reports','dashboards','custom',
  // Route-segment collisions inside the custom-objects slice itself
  // (mirror of the API list — see validation.ts for the full rationale).
  'records','new','fields',
];

function slugify(name: string): string {
  return name
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 41);
}

export default function CustomObjectsListPage() {
  const [objects, setObjects] = useState<CustomObject[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showModal, setShowModal] = useState(false);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const res = await apiFetch('/api/v1/custom-objects');
      if (!res.ok) throw new Error(`Server responded with ${res.status}`);
      setObjects(await res.json());
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { void load(); }, []);

  return (
    <SettingsPageLayout
      title="Custom Objects"
      description="Define your own entity types — like Vehicles, Inventory, Properties — and store records against them."
    >
      <div className="mb-[-0.5rem]">
        <Link href="/settings" className={`${typography.bodyMuted} hover:text-primary`}>← Settings</Link>
      </div>

      {error && (
        <div className="px-3 py-2 bg-red-50 border border-red-100 text-sm text-red-700 rounded">{error}</div>
      )}

      <SettingsSection title="Your custom objects">
        <div className="flex items-center justify-end mb-4">
          <button
            onClick={() => setShowModal(true)}
            className="inline-flex items-center gap-1.5 px-4 py-2 bg-primary text-white text-sm font-medium rounded-lg hover:bg-primary/90"
          >
            <Plus className="w-4 h-4" />
            New Object
          </button>
        </div>

        {loading ? (
          <p className="text-sm text-gray-500 dark:text-gray-400">Loading…</p>
        ) : objects.length === 0 ? (
          <div className="text-center py-12 border border-dashed border-gray-200 dark:border-gray-700 rounded-lg">
            <Package className="w-10 h-10 text-gray-300 dark:text-gray-600 mx-auto mb-2" />
            <p className="text-sm text-gray-500 dark:text-gray-400 mb-1">No custom objects yet.</p>
            <p className="text-xs text-gray-400 dark:text-gray-500">
              Create your first object to start modelling tenant-specific data.
            </p>
          </div>
        ) : (
          <ul className="divide-y divide-gray-100 dark:divide-gray-800 border border-gray-100 dark:border-gray-800 rounded-lg overflow-hidden">
            {objects.map((o) => (
              <li key={o.id} className="flex items-center justify-between px-4 py-3 bg-white dark:bg-gray-900 hover:bg-gray-50/60">
                <div>
                  <div className="flex items-center gap-2">
                    <Package className="w-4 h-4 text-gray-400 dark:text-gray-500" />
                    <span className="font-medium text-gray-900 dark:text-gray-100">{o.name}</span>
                    <code className="text-xs text-gray-400 dark:text-gray-500 bg-gray-50 dark:bg-gray-800 px-1.5 py-0.5 rounded">{o.slug}</code>
                  </div>
                  <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
                    {o._count?.records ?? 0} record{(o._count?.records ?? 0) === 1 ? '' : 's'}
                  </p>
                </div>
                <div className="flex items-center gap-3">
                  <Link
                    href={`/custom/${o.slug}`}
                    className="text-xs text-primary font-medium hover:underline"
                  >
                    View records
                  </Link>
                  <Link
                    href={`/settings/custom-objects/${o.id}`}
                    className="text-xs text-gray-600 dark:text-gray-400 font-medium hover:text-primary"
                  >
                    Manage fields
                  </Link>
                </div>
              </li>
            ))}
          </ul>
        )}
      </SettingsSection>

      {showModal && <NewObjectModal onClose={() => setShowModal(false)} onCreated={load} />}
    </SettingsPageLayout>
  );
}

function NewObjectModal({ onClose, onCreated }: { onClose: () => void; onCreated: () => void }) {
  const [name, setName] = useState('');
  const [pluralName, setPluralName] = useState('');
  // The slug is auto-suggested from `name` but the user can override it.
  // We track `slugTouched` so typing in the name field stops overwriting
  // a manually-edited slug.
  const [slug, setSlug] = useState('');
  const [slugTouched, setSlugTouched] = useState(false);
  const [icon, setIcon] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function onNameChange(v: string) {
    setName(v);
    if (!slugTouched) setSlug(slugify(v));
  }

  const reserved = RESERVED_SLUGS.includes(slug);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      const res = await apiFetch('/api/v1/custom-objects', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name,
          pluralName: pluralName || name,
          slug,
          icon: icon || null,
        }),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        throw new Error(j.message || `Failed (${res.status})`);
      }
      onCreated();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <form
        onClick={(e) => e.stopPropagation()}
        onSubmit={submit}
        className="bg-white dark:bg-gray-900 rounded-xl shadow-xl w-full max-w-md p-5"
      >
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100">New Custom Object</h2>
          <button type="button" onClick={onClose} className="p-1 hover:bg-gray-100 dark:hover:bg-gray-800 rounded">
            <X className="w-4 h-4 text-gray-500 dark:text-gray-400" />
          </button>
        </div>

        {error && (
          <div className="mb-3 px-3 py-2 bg-red-50 border border-red-100 text-xs text-red-700 rounded">{error}</div>
        )}

        <div className="space-y-3">
          <div>
            <label className={`${typography.caption} block mb-1`}>Name *</label>
            <input
              value={name}
              onChange={(e) => onNameChange(e.target.value)}
              required
              placeholder="Vehicle"
              className="w-full px-3 py-2 text-sm border border-gray-200 dark:border-gray-700 rounded-lg bg-white dark:bg-gray-900"
            />
          </div>
          <div>
            <label className={`${typography.caption} block mb-1`}>Plural name *</label>
            <input
              value={pluralName}
              onChange={(e) => setPluralName(e.target.value)}
              required
              placeholder="Vehicles"
              className="w-full px-3 py-2 text-sm border border-gray-200 dark:border-gray-700 rounded-lg bg-white dark:bg-gray-900"
            />
          </div>
          <div>
            <label className={`${typography.caption} block mb-1`}>Slug *</label>
            <input
              value={slug}
              onChange={(e) => { setSlugTouched(true); setSlug(e.target.value); }}
              required
              placeholder="vehicle"
              className="w-full px-3 py-2 text-sm border border-gray-200 dark:border-gray-700 rounded-lg bg-white dark:bg-gray-900 font-mono"
            />
            <p className="text-[11px] text-gray-400 dark:text-gray-500 mt-1">
              Used in the URL: <code>/custom/{slug || 'your-slug'}/records</code>
            </p>
            {reserved && (
              <p className="text-[11px] text-red-600 mt-1">
                "{slug}" is a reserved word — please pick a different slug.
              </p>
            )}
          </div>
          <div>
            <label className={`${typography.caption} block mb-1`}>Icon (lucide-react name)</label>
            <input
              value={icon}
              onChange={(e) => setIcon(e.target.value)}
              placeholder="Car"
              className="w-full px-3 py-2 text-sm border border-gray-200 dark:border-gray-700 rounded-lg bg-white dark:bg-gray-900"
            />
          </div>
        </div>

        <div className="flex justify-end gap-2 mt-5">
          <button type="button" onClick={onClose} className="px-4 py-2 text-sm border border-gray-200 dark:border-gray-700 rounded-lg hover:bg-gray-50">
            Cancel
          </button>
          <button
            type="submit"
            disabled={saving || reserved || !slug}
            className="px-4 py-2 text-sm bg-primary text-white rounded-lg hover:bg-primary/90 disabled:opacity-50"
          >
            {saving ? 'Creating…' : 'Create object'}
          </button>
        </div>
      </form>
    </div>
  );
}
