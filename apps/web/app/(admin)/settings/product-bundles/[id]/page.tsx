'use client';

/**
 * Bundle detail / edit — Wave F2.
 *
 * Replace-items semantics: PUT /product-bundles/:id with a fresh `items[]`
 * deletes existing items + inserts the new set inside one tx (matches the
 * service). Same delete-confirm flow as Pipelines.
 */

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { ErrorBanner } from '@/components/ui/error-banner';
import { apiFetch } from '@/lib/api';

interface BundleItem {
  id: string;
  productId: string;
  quantity: number;
  discountPercent: number | string;
  order: number;
  product?: { id: string; name: string; sku: string | null; unitPrice: number | string };
}

interface Bundle {
  id: string;
  name: string;
  description: string | null;
  active: boolean;
  items: BundleItem[];
}

interface ProductLite {
  id: string;
  name: string;
  unitPrice: number | string;
}

interface RowInput {
  productId: string;
  quantity: number;
  discountPercent: number;
}

export default function BundleDetailPage({
  params,
}: {
  params: { id: string };
}) {
  const id = params.id;

  const router = useRouter();
  const [bundle, setBundle] = useState<Bundle | null>(null);
  const [products, setProducts] = useState<ProductLite[]>([]);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [items, setItems] = useState<RowInput[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      const [bRes, pRes] = await Promise.all([
        apiFetch(`/api/v1/product-bundles/${id}`),
        apiFetch('/api/v1/products?limit=200'),
      ]);
      if (!bRes.ok) throw new Error('Failed to load bundle');
      if (!pRes.ok) throw new Error('Failed to load products');
      const b: Bundle = await bRes.json();
      const p = await pRes.json();
      setBundle(b);
      setName(b.name);
      setDescription(b.description ?? '');
      setItems(
        b.items.map((it) => ({
          productId: it.productId,
          quantity: it.quantity,
          discountPercent: Number(it.discountPercent) || 0,
        })),
      );
      setProducts(p.data ?? []);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Unknown error');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  const addRow = () =>
    setItems((rows) => [
      ...rows,
      { productId: '', quantity: 1, discountPercent: 0 },
    ]);
  const removeRow = (idx: number) =>
    setItems((rows) => rows.filter((_, i) => i !== idx));
  const updateRow = <K extends keyof RowInput>(
    idx: number,
    key: K,
    value: RowInput[K],
  ) =>
    setItems((rows) =>
      rows.map((r, i) => (i === idx ? { ...r, [key]: value } : r)),
    );

  const save = async () => {
    setError(null);
    if (!name.trim()) {
      setError('Name is required');
      return;
    }
    const valid = items.filter((it) => it.productId && it.quantity > 0);
    if (valid.length === 0) {
      setError('Bundle must contain at least one item');
      return;
    }
    setSaving(true);
    try {
      const res = await apiFetch(`/api/v1/product-bundles/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: name.trim(),
          description: description.trim() || null,
          items: valid.map((it, idx) => ({ ...it, order: idx })),
        }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.message || 'Failed to save');
      }
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Unknown error');
    } finally {
      setSaving(false);
    }
  };

  const del = async () => {
    if (!confirm('Delete this bundle? This cannot be undone.')) return;
    setDeleting(true);
    try {
      const res = await apiFetch(`/api/v1/product-bundles/${id}`, {
        method: 'DELETE',
      });
      if (!res.ok && res.status !== 204) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.message || 'Failed to delete');
      }
      router.push('/settings/product-bundles');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Unknown error');
      setDeleting(false);
    }
  };

  if (loading) {
    return <div className="p-6 text-sm text-gray-500">Loading…</div>;
  }
  if (!bundle) {
    return <ErrorBanner message={error ?? 'Bundle not found'} />;
  }

  return (
    <div className="max-w-4xl mx-auto p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold">Edit bundle</h1>
          <p className="text-xs text-gray-500">{bundle.id}</p>
        </div>
        <div className="flex gap-2">
          <Button variant="secondary" onClick={() => router.back()}>
            Back
          </Button>
          <Button variant="secondary" onClick={del} disabled={deleting}>
            {deleting ? 'Deleting…' : 'Delete'}
          </Button>
          <Button onClick={save} disabled={saving}>
            {saving ? 'Saving…' : 'Save'}
          </Button>
        </div>
      </div>

      {error && <ErrorBanner message={error} />}

      <div className="space-y-4">
        <div>
          <label className="block text-xs font-medium mb-1">Name</label>
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="w-full rounded border px-3 py-2 text-sm bg-transparent"
          />
        </div>
        <div>
          <label className="block text-xs font-medium mb-1">Description</label>
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            rows={2}
            className="w-full rounded border px-3 py-2 text-sm bg-transparent"
          />
        </div>
        <div>
          <div className="flex items-center justify-between mb-2">
            <label className="text-xs font-medium">Items</label>
            <Button variant="secondary" onClick={addRow} type="button">
              + Add item
            </Button>
          </div>
          <div className="space-y-2">
            {items.map((it, idx) => (
              <div key={idx} className="grid grid-cols-12 gap-2 items-center">
                <select
                  value={it.productId}
                  onChange={(e) => updateRow(idx, 'productId', e.target.value)}
                  className="col-span-6 rounded border px-2 py-1.5 text-sm bg-transparent"
                >
                  <option value="">Select product…</option>
                  {products.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
                </select>
                <input
                  type="number"
                  min={1}
                  value={it.quantity}
                  onChange={(e) =>
                    updateRow(
                      idx,
                      'quantity',
                      Math.max(1, Number(e.target.value) || 1),
                    )
                  }
                  className="col-span-2 rounded border px-2 py-1.5 text-sm bg-transparent"
                />
                <input
                  type="number"
                  min={0}
                  max={100}
                  step={0.01}
                  value={it.discountPercent}
                  onChange={(e) =>
                    updateRow(
                      idx,
                      'discountPercent',
                      Math.min(100, Math.max(0, Number(e.target.value) || 0)),
                    )
                  }
                  className="col-span-3 rounded border px-2 py-1.5 text-sm bg-transparent"
                  placeholder="Disc %"
                />
                <button
                  type="button"
                  onClick={() => removeRow(idx)}
                  disabled={items.length === 1}
                  className="col-span-1 text-xs text-red-600 disabled:opacity-40"
                >
                  ×
                </button>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
