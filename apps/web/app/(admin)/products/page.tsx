'use client';

import { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { Search, AlertTriangle, Boxes } from 'lucide-react';
import { ListPageLayout } from '@/components/layouts/list-page-layout';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { typography } from '@/lib/ui-tokens';
import { TableSkeleton } from '@/components/ui/table-skeleton';
import { ErrorBanner } from '@/components/ui/error-banner';
import { Button } from '@/components/ui/button';
import { inputClass } from '@/components/ui/form-field';
import { useModalA11y } from '@/components/ui/use-modal-a11y';
import { apiFetch } from '@/lib/api';
import { exportCsv } from '@/lib/export-csv';

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
}

function useDebounce<T>(value: T, delay: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(timer);
  }, [value, delay]);
  return debounced;
}

type StockModalState =
  | { open: false }
  | { open: true; product: Product };

export default function ProductsPage() {
  const [products, setProducts] = useState<Product[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const searchParams = useSearchParams();
  const initialTab =
    searchParams?.get('tab') === 'low-stock' ? 'low-stock' : 'all';
  const [tab, setTab] = useState<'all' | 'low-stock'>(initialTab);

  useEffect(() => {
    const urlTab = searchParams?.get('tab');
    setTab(urlTab === 'low-stock' ? 'low-stock' : 'all');
  }, [searchParams]);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [total, setTotal] = useState(0);
  const [lowStockCount, setLowStockCount] = useState(0);
  const [showForm, setShowForm] = useState(false);
  const [editingProduct, setEditingProduct] = useState<Product | null>(null);
  const [saving, setSaving] = useState(false);
  const [formData, setFormData] = useState({
    name: '', description: '', sku: '', unitPrice: '0', costPrice: '', taxRate: '0',
    unit: '', stockQuantity: '0', lowStockAlert: '5', trackInventory: false, active: true,
  });
  const [stockModal, setStockModal] = useState<StockModalState>({ open: false });

  const debouncedSearch = useDebounce(search, 350);

  useEffect(() => { setPage(1); }, [debouncedSearch, tab]);

  const fetchProducts = useCallback(async () => {
    setLoading(true);
    try {
      if (tab === 'low-stock') {
        const res = await apiFetch(`/api/v1/products/low-stock`);
        if (!res.ok) throw new Error(`Failed (${res.status})`);
        const rows: Product[] = await res.json();
        setProducts(rows);
        setTotal(rows.length);
        setTotalPages(1);
        setLowStockCount(rows.length);
      } else {
        const params = new URLSearchParams({ page: String(page), limit: '20' });
        if (debouncedSearch) params.set('search', debouncedSearch);
        const res = await apiFetch(`/api/v1/products?${params}`);
        if (!res.ok) throw new Error(`Failed (${res.status})`);
        const json = await res.json();
        setProducts(json.data ?? []);
        setTotalPages(json.totalPages ?? 1);
        setTotal(json.total ?? 0);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed');
    } finally {
      setLoading(false);
    }
  }, [debouncedSearch, page, tab]);

  useEffect(() => { fetchProducts(); }, [fetchProducts]);

  // Refresh low-stock count badge whenever anything changes
  const refreshLowStockCount = useCallback(async () => {
    try {
      const res = await apiFetch('/api/v1/products/low-stock');
      if (!res.ok) return;
      const rows: Product[] = await res.json();
      setLowStockCount(rows.length);
    } catch {
      /* ignore */
    }
  }, []);

  useEffect(() => {
    refreshLowStockCount();
  }, [refreshLowStockCount]);

  function openNewForm() {
    setEditingProduct(null);
    setFormData({ name: '', description: '', sku: '', unitPrice: '0', costPrice: '', taxRate: '0', unit: '', stockQuantity: '0', lowStockAlert: '5', trackInventory: false, active: true });
    setShowForm(true);
  }

  function openEditForm(p: Product) {
    setEditingProduct(p);
    setFormData({
      name: p.name, description: p.description ?? '', sku: p.sku ?? '',
      unitPrice: String(p.unitPrice), costPrice: p.costPrice ? String(p.costPrice) : '',
      taxRate: String(p.taxRate), unit: p.unit ?? '', stockQuantity: String(p.stockQuantity),
      lowStockAlert: String(p.lowStockAlert), trackInventory: p.trackInventory, active: p.active,
    });
    setShowForm(true);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    try {
      const payload = {
        name: formData.name,
        description: formData.description || null,
        sku: formData.sku || null,
        unitPrice: Number(formData.unitPrice) || 0,
        costPrice: formData.costPrice ? Number(formData.costPrice) : null,
        taxRate: Number(formData.taxRate) || 0,
        unit: formData.unit || null,
        stockQuantity: Number(formData.stockQuantity) || 0,
        lowStockAlert: Number(formData.lowStockAlert) || 5,
        trackInventory: formData.trackInventory,
        active: formData.active,
      };

      const url = editingProduct
        ? `/api/v1/products/${editingProduct.id}`
        : `/api/v1/products`;

      const res = await apiFetch(url, {
        method: editingProduct ? 'PATCH' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (!res.ok) throw new Error('Failed');
      setShowForm(false);
      fetchProducts();
      refreshLowStockCount();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save');
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(id: string) {
    if (!confirm('Delete this product?')) return;
    try {
      await apiFetch(`/api/v1/products/${id}`, { method: 'DELETE' });
      fetchProducts();
      refreshLowStockCount();
    } catch { /* ignore */ }
  }

  const filtersNode = (
    <div className="flex flex-col sm:flex-row gap-3">
      <div className="inline-flex rounded-lg border border-gray-200 dark:border-gray-700 p-0.5 bg-white dark:bg-gray-900">
        <button
          type="button"
          onClick={() => setTab('all')}
          className={`inline-flex items-center gap-1 px-3 py-1.5 text-xs rounded-md font-medium transition-colors ${
            tab === 'all'
              ? 'bg-primary text-white'
              : 'text-gray-500 dark:text-gray-400 hover:text-gray-900 dark:hover:text-gray-100'
          }`}
        >
          <Boxes className="w-3.5 h-3.5" /> All products
        </button>
        <button
          type="button"
          onClick={() => setTab('low-stock')}
          className={`inline-flex items-center gap-1 px-3 py-1.5 text-xs rounded-md font-medium transition-colors ${
            tab === 'low-stock'
              ? 'bg-primary text-white'
              : 'text-gray-500 dark:text-gray-400 hover:text-gray-900 dark:hover:text-gray-100'
          }`}
        >
          <AlertTriangle className="w-3.5 h-3.5" /> Low stock
          {lowStockCount > 0 && (
            <span className={`ml-1 inline-flex items-center justify-center rounded-full text-[10px] font-bold px-1.5 min-w-[18px] ${
              tab === 'low-stock'
                ? 'bg-white/25 text-white'
                : 'bg-red-100 text-red-700 dark:bg-red-500/20 dark:text-red-300'
            }`}>
              {lowStockCount}
            </span>
          )}
        </button>
      </div>
      {tab === 'all' && (
        <div className="relative max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400 dark:text-gray-500 pointer-events-none" />
          <input
            aria-label="Search products"
            type="text"
            placeholder="Search products..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className={`${inputClass} pl-9`}
          />
        </div>
      )}
    </div>
  );

  const paginationNode =
    tab === 'all' && !loading && total > 0 ? (
      <div className="flex items-center justify-between px-4 py-3 border border-gray-100 dark:border-gray-800 rounded-xl bg-gray-50/50 dark:bg-gray-800/50">
        <p className="text-xs text-gray-500 dark:text-gray-400">{total} product{total !== 1 ? 's' : ''} total</p>
        <div className="flex items-center gap-2">
          <Button variant="secondary" size="sm" onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={page <= 1}>Previous</Button>
          <span className="text-xs text-gray-600 dark:text-gray-400">Page {page} of {totalPages}</span>
          <Button variant="secondary" size="sm" onClick={() => setPage((p) => Math.min(totalPages, p + 1))} disabled={page >= totalPages}>Next</Button>
        </div>
      </div>
    ) : null;

  return (
    <ListPageLayout
      title="Products"
      secondaryActions={[
        {
          label: 'Export CSV',
          onClick: () => {
            const params = new URLSearchParams();
            if (debouncedSearch) params.set('search', debouncedSearch);
            const qs = params.toString();
            void exportCsv(
              `/api/v1/products/export${qs ? `?${qs}` : ''}`,
              `products-${new Date().toISOString().slice(0, 10)}.csv`,
              { entityLabel: 'products' },
            );
          },
        },
      ]}
      primaryAction={{ label: 'New Product', onClick: openNewForm }}
      filters={filtersNode}
      pagination={paginationNode}
    >
      {error && (
        <div className="mb-4">
          <ErrorBanner message={error} onRetry={fetchProducts} onDismiss={() => setError(null)} />
        </div>
      )}

      {/* Table */}
      <Card>
        <div className="overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead>
              <tr className="bg-gray-50 dark:bg-gray-900 border-b border-gray-100 dark:border-gray-800 text-left text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide">
                <th className="px-4 py-3">Name</th>
                <th className="px-4 py-3 hidden md:table-cell">SKU</th>
                <th className="px-4 py-3 text-right">Price</th>
                <th className="px-4 py-3 text-right hidden md:table-cell">Tax %</th>
                <th className="px-4 py-3 text-right">Stock</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3 text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <TableSkeleton rows={6} columns={7} />
              ) : products.length === 0 ? (
                <tr>
                  <td colSpan={7} className="px-4 py-12 text-center text-sm text-gray-400 dark:text-gray-500">
                    {tab === 'low-stock' ? 'No low-stock products' : 'No products found'}
                  </td>
                </tr>
              ) : products.map((p) => {
                const isLowStock = p.trackInventory && p.stockQuantity <= p.lowStockAlert;
                return (
                  <tr key={p.id} className="border-b border-gray-100 dark:border-gray-800 hover:bg-gray-50/60">
                    <td className="px-4 py-3 font-medium text-gray-900 dark:text-gray-100">
                      <Link href={`/products/${p.id}`} className="hover:text-primary hover:underline">
                        {p.name}
                      </Link>
                    </td>
                    <td className="px-4 py-3 text-gray-500 dark:text-gray-400 hidden md:table-cell">{p.sku || <span className="text-gray-300 dark:text-gray-600">--</span>}</td>
                    <td className="px-4 py-3 text-right tabular-nums">{Number(p.unitPrice).toFixed(2)}</td>
                    <td className="px-4 py-3 text-right tabular-nums hidden md:table-cell">{Number(p.taxRate)}%</td>
                    <td className="px-4 py-3 text-right">
                      {p.trackInventory ? (
                        <span className={`inline-flex items-center gap-1 ${isLowStock ? 'text-red-600 font-semibold' : 'text-gray-700 dark:text-gray-300'}`}>
                          {p.stockQuantity}
                          {isLowStock && (
                            <Badge variant="error" className="text-[10px]">LOW</Badge>
                          )}
                        </span>
                      ) : (
                        <span className="text-gray-300 dark:text-gray-600">--</span>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <Badge variant={p.active ? 'success' : 'muted'}>
                        {p.active ? 'Active' : 'Inactive'}
                      </Badge>
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center justify-end gap-3">
                        {p.trackInventory && (
                          <button
                            onClick={() => setStockModal({ open: true, product: p })}
                            className="text-xs text-gray-500 dark:text-gray-400 hover:text-primary font-medium"
                          >
                            Adjust stock
                          </button>
                        )}
                        <button onClick={() => openEditForm(p)} className="text-xs text-gray-500 dark:text-gray-400 hover:text-primary font-medium">Edit</button>
                        <button onClick={() => handleDelete(p.id)} className="text-xs text-gray-500 dark:text-gray-400 hover:text-red-600 font-medium">Delete</button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Card>

      {/* Create/Edit Modal */}
      {showForm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30" onClick={() => setShowForm(false)}>
          <div className="bg-white dark:bg-gray-900 rounded-xl shadow-xl w-full max-w-lg p-6 mx-4 max-h-[90vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
            <h2 className={`${typography.h3} mb-4`}>{editingProduct ? 'Edit Product' : 'New Product'}</h2>
            <form onSubmit={handleSubmit} className="space-y-3">
              <div>
                <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">Name *</label>
                <input required value={formData.name} onChange={(e) => setFormData({ ...formData, name: e.target.value })} className={inputClass} />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">Description</label>
                <textarea rows={2} value={formData.description} onChange={(e) => setFormData({ ...formData, description: e.target.value })} className={inputClass} />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">SKU</label>
                  <input value={formData.sku} onChange={(e) => setFormData({ ...formData, sku: e.target.value })} className={inputClass} />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">Unit</label>
                  <input placeholder="piece, hour, kg..." value={formData.unit} onChange={(e) => setFormData({ ...formData, unit: e.target.value })} className={inputClass} />
                </div>
              </div>
              <div className="grid grid-cols-3 gap-3">
                <div>
                  <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">Unit Price *</label>
                  <input required type="number" step="0.01" value={formData.unitPrice} onChange={(e) => setFormData({ ...formData, unitPrice: e.target.value })} className={inputClass} />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">Cost Price</label>
                  <input type="number" step="0.01" value={formData.costPrice} onChange={(e) => setFormData({ ...formData, costPrice: e.target.value })} className={inputClass} />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">Tax %</label>
                  <input type="number" step="0.01" value={formData.taxRate} onChange={(e) => setFormData({ ...formData, taxRate: e.target.value })} className={inputClass} />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">Stock Qty</label>
                  <input type="number" value={formData.stockQuantity} onChange={(e) => setFormData({ ...formData, stockQuantity: e.target.value })} className={inputClass} />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">Low Stock Alert</label>
                  <input type="number" value={formData.lowStockAlert} onChange={(e) => setFormData({ ...formData, lowStockAlert: e.target.value })} className={inputClass} />
                </div>
              </div>
              <div className="flex items-center gap-4">
                <label className="flex items-center gap-2 text-sm text-gray-700 dark:text-gray-300">
                  <input type="checkbox" checked={formData.trackInventory} onChange={(e) => setFormData({ ...formData, trackInventory: e.target.checked })} className="rounded border-gray-300" />
                  Track Inventory
                </label>
                <label className="flex items-center gap-2 text-sm text-gray-700 dark:text-gray-300">
                  <input type="checkbox" checked={formData.active} onChange={(e) => setFormData({ ...formData, active: e.target.checked })} className="rounded border-gray-300" />
                  Active
                </label>
              </div>
              <div className="flex justify-end gap-2 pt-2">
                <Button type="button" variant="ghost" onClick={() => setShowForm(false)}>Cancel</Button>
                <Button type="submit" variant="primary" loading={saving} disabled={saving}>
                  {saving ? 'Saving...' : editingProduct ? 'Update' : 'Create'}
                </Button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Adjust Stock Modal */}
      {stockModal.open && (
        <AdjustStockModal
          product={stockModal.product}
          onClose={() => setStockModal({ open: false })}
          onSuccess={() => {
            setStockModal({ open: false });
            fetchProducts();
            refreshLowStockCount();
          }}
        />
      )}
    </ListPageLayout>
  );
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
            <input
              type="number"
              step="1"
              required
              value={delta}
              onChange={(e) => setDelta(e.target.value)}
              className={inputClass}
            />
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
            <input
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="Optional note for the audit log"
              className={inputClass}
            />
          </div>
          {error && (
            <p className="text-xs text-red-600 dark:text-red-400">{error}</p>
          )}
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
