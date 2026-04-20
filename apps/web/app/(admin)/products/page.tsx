'use client';

import { useState, useEffect, useCallback } from 'react';
import { Search } from 'lucide-react';
import { ListPageLayout } from '@/components/layouts/list-page-layout';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { typography } from '@/lib/ui-tokens';
import { TableSkeleton } from '@/components/ui/table-skeleton';
import { ErrorBanner } from '@/components/ui/error-banner';
import { Button } from '@/components/ui/button';
import { inputClass } from '@/components/ui/form-field';

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

const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001';

function getToken(): string | null {
  if (typeof window === 'undefined') return null;
  return localStorage.getItem('access_token');
}

function useDebounce<T>(value: T, delay: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(timer);
  }, [value, delay]);
  return debounced;
}

export default function ProductsPage() {
  const [products, setProducts] = useState<Product[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [total, setTotal] = useState(0);
  const [showForm, setShowForm] = useState(false);
  const [editingProduct, setEditingProduct] = useState<Product | null>(null);
  const [saving, setSaving] = useState(false);
  const [formData, setFormData] = useState({
    name: '', description: '', sku: '', unitPrice: '0', costPrice: '', taxRate: '0',
    unit: '', stockQuantity: '0', lowStockAlert: '5', trackInventory: false, active: true,
  });

  const debouncedSearch = useDebounce(search, 350);

  useEffect(() => { setPage(1); }, [debouncedSearch]);

  const fetchProducts = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ page: String(page), limit: '20' });
      if (debouncedSearch) params.set('search', debouncedSearch);
      const res = await fetch(`${API_BASE}/api/v1/products?${params}`, {
        headers: { Authorization: `Bearer ${getToken()}` },
      });
      if (!res.ok) throw new Error(`Failed (${res.status})`);
      const json = await res.json();
      setProducts(json.data ?? []);
      setTotalPages(json.totalPages ?? 1);
      setTotal(json.total ?? 0);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed');
    } finally {
      setLoading(false);
    }
  }, [debouncedSearch, page]);

  useEffect(() => { fetchProducts(); }, [fetchProducts]);

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
        ? `${API_BASE}/api/v1/products/${editingProduct.id}`
        : `${API_BASE}/api/v1/products`;

      const res = await fetch(url, {
        method: editingProduct ? 'PATCH' : 'POST',
        headers: { Authorization: `Bearer ${getToken()}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (!res.ok) throw new Error('Failed');
      setShowForm(false);
      fetchProducts();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save');
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(id: string) {
    if (!confirm('Delete this product?')) return;
    try {
      await fetch(`${API_BASE}/api/v1/products/${id}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${getToken()}` },
      });
      fetchProducts();
    } catch { /* ignore */ }
  }

  const filtersNode = (
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
  );

  const paginationNode =
    !loading && total > 0 ? (
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
                  <td colSpan={7} className="px-4 py-12 text-center text-sm text-gray-400 dark:text-gray-500">No products found</td>
                </tr>
              ) : products.map((p) => {
                const isLowStock = p.trackInventory && p.stockQuantity <= p.lowStockAlert;
                return (
                  <tr key={p.id} className="border-b border-gray-100 dark:border-gray-800 hover:bg-gray-50/60">
                    <td className="px-4 py-3 font-medium text-gray-900 dark:text-gray-100">{p.name}</td>
                    <td className="px-4 py-3 text-gray-500 dark:text-gray-400 hidden md:table-cell">{p.sku || <span className="text-gray-300 dark:text-gray-600">--</span>}</td>
                    <td className="px-4 py-3 text-right tabular-nums">{Number(p.unitPrice).toFixed(2)}</td>
                    <td className="px-4 py-3 text-right tabular-nums hidden md:table-cell">{Number(p.taxRate)}%</td>
                    <td className="px-4 py-3 text-right">
                      {p.trackInventory ? (
                        <span className={`inline-flex items-center gap-1 ${isLowStock ? 'text-red-600 font-semibold' : 'text-gray-700'}`}>
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
    </ListPageLayout>
  );
}
