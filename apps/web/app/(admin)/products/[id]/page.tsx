'use client';

import { useCallback, useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { DetailPageLayout } from '@/components/layouts/detail-page-layout';
import { Card, CardBody, CardHeader } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { ErrorBanner } from '@/components/ui/error-banner';
import { EmptyState } from '@/components/ui/empty-state';
import { typography } from '@/lib/ui-tokens';
import { inputClass } from '@/components/ui/form-field';
import { useModalA11y } from '@/components/ui/use-modal-a11y';
import { apiFetch } from '@/lib/api';

interface Product {
  id: string;
  name: string;
  description?: string | null;
  sku?: string | null;
  unitPrice: number;
  costPrice?: number | null;
  taxRate: number;
  unit?: string | null;
  stockQuantity: number;
  lowStockAlert: number;
  trackInventory: boolean;
  active: boolean;
  createdAt: string;
  updatedAt: string;
}

interface StockMovement {
  id: string;
  delta: number;
  balanceAfter: number;
  reason: string;
  invoiceId?: string | null;
  creditNoteId?: string | null;
  note?: string | null;
  createdAt: string;
}

export default function ProductDetailPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const id = params?.id;

  const [product, setProduct] = useState<Product | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [movements, setMovements] = useState<StockMovement[]>([]);
  const [movLoading, setMovLoading] = useState(true);
  const [movPage, setMovPage] = useState(1);
  const [movTotalPages, setMovTotalPages] = useState(1);
  const [movTotal, setMovTotal] = useState(0);

  const [showAdjust, setShowAdjust] = useState(false);

  const fetchProduct = useCallback(async () => {
    if (!id) return;
    setLoading(true);
    setError(null);
    try {
      const res = await apiFetch(`/api/v1/products/${id}`);
      if (!res.ok) throw new Error(`Failed to load product (${res.status})`);
      setProduct(await res.json());
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed');
    } finally {
      setLoading(false);
    }
  }, [id]);

  const fetchMovements = useCallback(async () => {
    if (!id) return;
    setMovLoading(true);
    try {
      const res = await apiFetch(`/api/v1/products/${id}/stock/movements?page=${movPage}&limit=20`);
      if (!res.ok) throw new Error('Failed to load movements');
      const json = await res.json();
      setMovements(json.data ?? []);
      setMovTotalPages(json.totalPages ?? 1);
      setMovTotal(json.total ?? 0);
    } catch {
      // swallow — movements table will just be empty
    } finally {
      setMovLoading(false);
    }
  }, [id, movPage]);

  useEffect(() => {
    fetchProduct();
  }, [fetchProduct]);

  useEffect(() => {
    fetchMovements();
  }, [fetchMovements]);

  if (!id) return null;

  if (loading) {
    return (
      <div className="space-y-4">
        <div className="h-8 w-64 bg-gray-100 dark:bg-gray-800 rounded animate-pulse" />
        <div className="h-4 w-40 bg-gray-100 dark:bg-gray-800 rounded animate-pulse" />
        <Card>
          <div className="p-4 space-y-2">
            <div className="h-4 w-1/3 bg-gray-100 dark:bg-gray-800 rounded animate-pulse" />
            <div className="h-4 w-1/2 bg-gray-100 dark:bg-gray-800 rounded animate-pulse" />
            <div className="h-4 w-1/4 bg-gray-100 dark:bg-gray-800 rounded animate-pulse" />
          </div>
        </Card>
      </div>
    );
  }

  if (error) {
    return <ErrorBanner message={error} onRetry={fetchProduct} />;
  }

  if (!product) return null;

  const isLowStock = product.trackInventory && product.stockQuantity <= product.lowStockAlert;

  const badgeNode = product.active ? (
    <Badge variant="success">Active</Badge>
  ) : (
    <Badge variant="muted">Inactive</Badge>
  );

  return (
    <DetailPageLayout
        title={product.name}
        subtitle={product.sku ? `SKU: ${product.sku}` : undefined}
        breadcrumbs={[
          { label: 'Products', href: '/products' },
          { label: product.name },
        ]}
        badge={badgeNode}
        actions={
          product.trackInventory
            ? [
                {
                  label: 'Adjust stock',
                  onClick: () => setShowAdjust(true),
                  variant: 'primary',
                },
                {
                  label: 'Edit',
                  onClick: () => router.push('/products'),
                  variant: 'secondary',
                },
              ]
            : [
                {
                  label: 'Edit',
                  onClick: () => router.push('/products'),
                  variant: 'secondary',
                },
              ]
        }
        sidebar={
          <div className="space-y-4">
            <Card>
              <CardHeader>
                <h3 className={typography.h3}>Inventory</h3>
              </CardHeader>
              <CardBody>
                {product.trackInventory ? (
                  <dl className="space-y-2 text-sm">
                    <div className="flex justify-between">
                      <dt className="text-gray-500 dark:text-gray-400">Current stock</dt>
                      <dd className={`font-semibold tabular-nums ${isLowStock ? 'text-red-600' : 'text-gray-900 dark:text-gray-100'}`}>
                        {product.stockQuantity}
                        {isLowStock && (
                          <Badge variant="error" className="ml-2 text-[10px]">LOW</Badge>
                        )}
                      </dd>
                    </div>
                    <div className="flex justify-between">
                      <dt className="text-gray-500 dark:text-gray-400">Low-stock alert</dt>
                      <dd className="tabular-nums">{product.lowStockAlert}</dd>
                    </div>
                    <div className="flex justify-between">
                      <dt className="text-gray-500 dark:text-gray-400">Unit</dt>
                      <dd>{product.unit ?? '-'}</dd>
                    </div>
                  </dl>
                ) : (
                  <p className="text-sm text-gray-500 dark:text-gray-400">
                    Inventory tracking is disabled for this product.
                  </p>
                )}
              </CardBody>
            </Card>

            <Card>
              <CardHeader>
                <h3 className={typography.h3}>Pricing</h3>
              </CardHeader>
              <CardBody>
                <dl className="space-y-2 text-sm">
                  <div className="flex justify-between">
                    <dt className="text-gray-500 dark:text-gray-400">Unit price</dt>
                    <dd className="tabular-nums">{Number(product.unitPrice).toFixed(2)}</dd>
                  </div>
                  {product.costPrice != null && (
                    <div className="flex justify-between">
                      <dt className="text-gray-500 dark:text-gray-400">Cost</dt>
                      <dd className="tabular-nums">{Number(product.costPrice).toFixed(2)}</dd>
                    </div>
                  )}
                  <div className="flex justify-between">
                    <dt className="text-gray-500 dark:text-gray-400">Tax %</dt>
                    <dd className="tabular-nums">{Number(product.taxRate)}%</dd>
                  </div>
                </dl>
              </CardBody>
            </Card>
          </div>
        }
      >
        {product.description && (
          <Card className="mb-4">
            <CardBody>
              <p className="text-sm text-gray-600 dark:text-gray-400 whitespace-pre-wrap">
                {product.description}
              </p>
            </CardBody>
          </Card>
        )}

        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <h3 className={typography.h3}>Stock movements</h3>
              {product.trackInventory && (
                <Button size="sm" variant="secondary" onClick={() => setShowAdjust(true)}>
                  Adjust stock
                </Button>
              )}
            </div>
          </CardHeader>
          {movLoading ? (
            <div className="p-4 space-y-2">
              <div className="h-4 w-full bg-gray-100 dark:bg-gray-800 rounded animate-pulse" />
              <div className="h-4 w-5/6 bg-gray-100 dark:bg-gray-800 rounded animate-pulse" />
              <div className="h-4 w-2/3 bg-gray-100 dark:bg-gray-800 rounded animate-pulse" />
            </div>
          ) : movements.length === 0 ? (
            <EmptyState
              title="No movements yet"
              description={
                product.trackInventory
                  ? 'Adjust stock or send an invoice to record the first movement.'
                  : 'Enable inventory tracking to start recording movements.'
              }
            />
          ) : (
            <div className="overflow-x-auto">
              <table className="min-w-full text-sm">
                <thead>
                  <tr className="bg-gray-50 dark:bg-gray-900 border-b border-gray-100 dark:border-gray-800 text-left text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide">
                    <th className="px-4 py-3">Date</th>
                    <th className="px-4 py-3">Reason</th>
                    <th className="px-4 py-3 text-right">Delta</th>
                    <th className="px-4 py-3 text-right">Balance after</th>
                    <th className="px-4 py-3">Note</th>
                  </tr>
                </thead>
                <tbody>
                  {movements.map((m) => (
                    <tr key={m.id} className="border-b border-gray-100 dark:border-gray-800">
                      <td className="px-4 py-3 text-gray-600 dark:text-gray-400 text-xs whitespace-nowrap">
                        {new Date(m.createdAt).toLocaleString()}
                      </td>
                      <td className="px-4 py-3">
                        <Badge variant={reasonVariant(m.reason)}>{prettyReason(m.reason)}</Badge>
                        {m.invoiceId && (
                          <span className="ml-2 text-[11px] text-gray-400">
                            inv #{m.invoiceId.slice(0, 8)}
                          </span>
                        )}
                      </td>
                      <td
                        className={`px-4 py-3 text-right tabular-nums font-semibold ${
                          m.delta > 0 ? 'text-green-600' : 'text-red-600'
                        }`}
                      >
                        {m.delta > 0 ? '+' : ''}
                        {m.delta}
                      </td>
                      <td className="px-4 py-3 text-right tabular-nums">{m.balanceAfter}</td>
                      <td className="px-4 py-3 text-xs text-gray-500 dark:text-gray-400">
                        {m.note ?? '-'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {movTotalPages > 1 && (
            <div className="flex items-center justify-between px-4 py-3 border-t border-gray-100 dark:border-gray-800 bg-gray-50/50 dark:bg-gray-900/50">
              <p className="text-xs text-gray-500 dark:text-gray-400">{movTotal} movement{movTotal === 1 ? '' : 's'} total</p>
              <div className="flex items-center gap-2">
                <Button size="sm" variant="secondary" onClick={() => setMovPage((p) => Math.max(1, p - 1))} disabled={movPage <= 1}>
                  Previous
                </Button>
                <span className="text-xs text-gray-500">Page {movPage} of {movTotalPages}</span>
                <Button size="sm" variant="secondary" onClick={() => setMovPage((p) => Math.min(movTotalPages, p + 1))} disabled={movPage >= movTotalPages}>
                  Next
                </Button>
              </div>
            </div>
          )}
        </Card>

        {showAdjust && (
          <AdjustStockModal
            product={product}
            onClose={() => setShowAdjust(false)}
            onSuccess={() => {
              setShowAdjust(false);
              fetchProduct();
              fetchMovements();
            }}
          />
        )}
    </DetailPageLayout>
  );
}

function reasonVariant(reason: string): 'default' | 'success' | 'warning' | 'error' | 'info' | 'muted' {
  switch (reason) {
    case 'invoice_sent':
      return 'info';
    case 'purchase':
    case 'return':
      return 'success';
    case 'correction':
      return 'warning';
    case 'manual_adjustment':
    default:
      return 'default';
  }
}

function prettyReason(reason: string): string {
  return reason.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

function AdjustStockModal({
  product,
  onClose,
  onSuccess,
}: {
  product: Product;
  onClose: () => void;
  onSuccess: () => void;
}) {
  const containerRef = useModalA11y(true, onClose);
  const [delta, setDelta] = useState('0');
  const [reason, setReason] = useState('manual_adjustment');
  const [note, setNote] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const delt = Number(delta);
    if (!Number.isFinite(delt) || delt === 0) {
      setError('Delta must be non-zero');
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const res = await apiFetch(`/api/v1/products/${product.id}/stock/adjust`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ delta: delt, reason, note: note || undefined }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body?.message ?? 'Failed to adjust stock');
      }
      onSuccess();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30" onClick={onClose}>
      <div
        ref={containerRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="adjust-stock-title"
        className="bg-white dark:bg-gray-900 rounded-xl shadow-xl w-full max-w-md p-6 mx-4"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 id="adjust-stock-title" className={`${typography.h3} mb-1`}>Adjust stock</h2>
        <p className="text-xs text-gray-500 dark:text-gray-400 mb-4">
          {product.name} — current: <span className="font-semibold">{product.stockQuantity}</span>
        </p>

        <form onSubmit={submit} className="space-y-3">
          <div>
            <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">
              Delta (positive to add, negative to subtract) *
            </label>
            <input type="number" step="1" required value={delta} onChange={(e) => setDelta(e.target.value)} className={inputClass} />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">Reason *</label>
            <select value={reason} onChange={(e) => setReason(e.target.value)} className={inputClass}>
              <option value="manual_adjustment">Manual adjustment</option>
              <option value="purchase">Purchase / restock</option>
              <option value="return">Return</option>
              <option value="correction">Correction (allows negative)</option>
            </select>
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">Note</label>
            <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Optional note for the audit log" className={inputClass} />
          </div>
          {error && <p className="text-xs text-red-600 dark:text-red-400">{error}</p>}
          <div className="flex justify-end gap-2 pt-2">
            <Button type="button" variant="ghost" onClick={onClose}>Cancel</Button>
            <Button type="submit" variant="primary" loading={saving} disabled={saving}>
              {saving ? 'Saving...' : 'Adjust stock'}
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}
