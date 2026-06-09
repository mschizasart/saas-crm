'use client';

/**
 * Product Bundles (CPQ catalog) — Wave F2.
 *
 * Admins curate "kits" of products with per-item quantities + discounts.
 * Sales reps pick a bundle when building a quote — it becomes one line
 * with a rolled-up unitPrice. The bundle itself never appears on the
 * client-facing PDF; only the lineItem with the bundle's display name.
 */

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { ListPageLayout } from '@/components/layouts/list-page-layout';
import { Button } from '@/components/ui/button';
import { ErrorBanner } from '@/components/ui/error-banner';
import { apiFetch } from '@/lib/api';

interface Bundle {
  id: string;
  name: string;
  description: string | null;
  active: boolean;
  createdAt: string;
  _count?: { items: number };
}

interface ProductLite {
  id: string;
  name: string;
  unitPrice: number | string;
}

interface BundleItemInput {
  productId: string;
  quantity: number;
  discountPercent: number;
}

function NewBundleModal({
  open,
  onClose,
  onCreated,
  products,
}: {
  open: boolean;
  onClose: () => void;
  onCreated: () => void;
  products: ProductLite[];
}) {
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [items, setItems] = useState<BundleItemInput[]>([
    { productId: '', quantity: 1, discountPercent: 0 },
  ]);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setName('');
    setDescription('');
    setItems([{ productId: '', quantity: 1, discountPercent: 0 }]);
    setError(null);
  }, [open]);

  if (!open) return null;

  const addRow = () =>
    setItems((rows) => [
      ...rows,
      { productId: '', quantity: 1, discountPercent: 0 },
    ]);
  const removeRow = (idx: number) =>
    setItems((rows) => rows.filter((_, i) => i !== idx));
  const updateRow = <K extends keyof BundleItemInput>(
    idx: number,
    key: K,
    value: BundleItemInput[K],
  ) =>
    setItems((rows) =>
      rows.map((r, i) => (i === idx ? { ...r, [key]: value } : r)),
    );

  const submit = async () => {
    setError(null);
    if (!name.trim()) {
      setError('Name is required');
      return;
    }
    const validItems = items.filter((i) => i.productId && i.quantity > 0);
    if (validItems.length === 0) {
      setError('Add at least one product');
      return;
    }
    setSubmitting(true);
    try {
      const res = await apiFetch('/api/v1/product-bundles', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: name.trim(),
          description: description.trim() || undefined,
          items: validItems.map((it, idx) => ({ ...it, order: idx })),
        }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.message || 'Failed to create bundle');
      }
      onCreated();
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Unknown error');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="w-full max-w-2xl bg-white dark:bg-gray-900 rounded-lg shadow-xl">
        <div className="px-5 py-4 border-b border-gray-100 dark:border-gray-800">
          <h2 className="text-base font-semibold">New product bundle</h2>
        </div>
        <div className="p-5 space-y-4">
          {error && <ErrorBanner message={error} />}
          <div>
            <label className="block text-xs font-medium mb-1">Name</label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="w-full rounded border px-3 py-2 text-sm bg-transparent"
              placeholder="e.g. Starter Pack"
            />
          </div>
          <div>
            <label className="block text-xs font-medium mb-1">
              Description (optional)
            </label>
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
                <div
                  key={idx}
                  className="grid grid-cols-12 gap-2 items-center"
                >
                  <select
                    value={it.productId}
                    onChange={(e) =>
                      updateRow(idx, 'productId', e.target.value)
                    }
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
                    placeholder="Qty"
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
        <div className="px-5 py-3 border-t border-gray-100 dark:border-gray-800 flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose} disabled={submitting}>
            Cancel
          </Button>
          <Button onClick={submit} disabled={submitting}>
            {submitting ? 'Creating…' : 'Create bundle'}
          </Button>
        </div>
      </div>
    </div>
  );
}

export default function ProductBundlesPage() {
  const [bundles, setBundles] = useState<Bundle[]>([]);
  const [products, setProducts] = useState<ProductLite[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [modalOpen, setModalOpen] = useState(false);

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      const [bRes, pRes] = await Promise.all([
        apiFetch('/api/v1/product-bundles?limit=100'),
        apiFetch('/api/v1/products?limit=200'),
      ]);
      if (!bRes.ok) throw new Error('Failed to load bundles');
      if (!pRes.ok) throw new Error('Failed to load products');
      const bData = await bRes.json();
      const pData = await pRes.json();
      setBundles(bData.data ?? []);
      setProducts(pData.data ?? []);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Unknown error');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, []);

  return (
    <>
      <ListPageLayout
        title="Product Bundles"
        subtitle="Pre-configured kits of products for use on quotes"
        primaryAction={{
          label: '+ New Bundle',
          onClick: () => setModalOpen(true),
        }}
      >
        {error && <ErrorBanner message={error} />}
        {loading ? (
          <p className="text-sm text-gray-500 p-4">Loading…</p>
        ) : bundles.length === 0 ? (
          <p className="text-sm text-gray-500 p-4">
            No bundles yet. Click "+ New Bundle" to create one.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead className="border-b">
                <tr className="text-left text-xs uppercase text-gray-500">
                  <th className="py-2 px-3">Name</th>
                  <th className="py-2 px-3">Items</th>
                  <th className="py-2 px-3">Active</th>
                  <th className="py-2 px-3">Created</th>
                  <th className="py-2 px-3"></th>
                </tr>
              </thead>
              <tbody>
                {bundles.map((b) => (
                  <tr
                    key={b.id}
                    className="border-b hover:bg-gray-50 dark:hover:bg-gray-900"
                  >
                    <td className="py-2 px-3">
                      <Link
                        href={`/settings/product-bundles/${b.id}`}
                        className="text-primary hover:underline"
                      >
                        {b.name}
                      </Link>
                      {b.description && (
                        <p className="text-xs text-gray-500">{b.description}</p>
                      )}
                    </td>
                    <td className="py-2 px-3">{b._count?.items ?? 0}</td>
                    <td className="py-2 px-3">
                      {b.active ? (
                        <span className="text-xs px-2 py-0.5 rounded bg-green-100 text-green-700">
                          Active
                        </span>
                      ) : (
                        <span className="text-xs px-2 py-0.5 rounded bg-gray-100 text-gray-700">
                          Inactive
                        </span>
                      )}
                    </td>
                    <td className="py-2 px-3 text-xs text-gray-500">
                      {new Date(b.createdAt).toLocaleDateString()}
                    </td>
                    <td className="py-2 px-3 text-right">
                      <Link
                        href={`/settings/product-bundles/${b.id}`}
                        className="text-xs text-primary hover:underline"
                      >
                        Edit
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </ListPageLayout>
      <NewBundleModal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        onCreated={load}
        products={products}
      />
    </>
  );
}
