'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import SavedItemModal from '../../../../components/saved-item-modal';

const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001';

function getToken(): string | null {
  if (typeof window === 'undefined') return null;
  return localStorage.getItem('access_token');
}

function headers(): HeadersInit {
  return { Authorization: `Bearer ${getToken()}`, 'Content-Type': 'application/json' };
}

interface SavedItem {
  id: string;
  description: string;
  longDescription?: string;
  rate: number;
  taxRate: number;
  tax1?: string;
  tax2?: string;
  unit?: string;
  groupName?: string;
  assignedTo?: string;
  state?: string;
  zipCode?: string;
}

export default function SavedItemsPage() {
  const [items, setItems] = useState<SavedItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState<{ text: string; type: 'success' | 'error' } | null>(null);

  // Modal state
  const [modalOpen, setModalOpen] = useState(false);
  const [editItem, setEditItem] = useState<SavedItem | null>(null);

  async function loadItems() {
    try {
      const res = await fetch(`${API_BASE}/api/v1/saved-items`, { headers: headers() });
      if (res.ok) {
        const data = await res.json();
        setItems(Array.isArray(data) ? data : (data.data ?? []));
      }
    } catch { /* ignore */ }
    setLoading(false);
  }

  useEffect(() => { loadItems(); }, []);

  function showMessage(text: string, type: 'success' | 'error') {
    setMessage({ text, type });
    setTimeout(() => setMessage(null), 4000);
  }

  function handleNew() {
    setEditItem(null);
    setModalOpen(true);
  }

  function handleEdit(item: SavedItem) {
    setEditItem(item);
    setModalOpen(true);
  }

  async function handleDelete(id: string) {
    if (!confirm('Delete this saved item?')) return;
    try {
      const res = await fetch(`${API_BASE}/api/v1/saved-items/${id}`, { method: 'DELETE', headers: headers() });
      if (res.ok || res.status === 204) {
        showMessage('Item deleted', 'success');
        await loadItems();
      } else {
        showMessage('Failed to delete item', 'error');
      }
    } catch {
      showMessage('Failed to delete item', 'error');
    }
  }

  function handleSaved() {
    showMessage(editItem ? 'Item updated successfully' : 'Item created successfully', 'success');
    loadItems();
  }

  if (loading) return <div className="p-6 text-sm text-gray-500">Loading...</div>;

  return (
    <div className="max-w-5xl">
      <div className="mb-4">
        <Link href="/settings" className="text-sm text-gray-500 hover:text-primary">&larr; Settings</Link>
      </div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Saved Items</h1>
          <p className="text-sm text-gray-500 mt-1">Predefined line items for invoices, estimates, and credit notes</p>
        </div>
        <button
          onClick={handleNew}
          className="px-4 py-2 bg-primary text-white text-sm font-medium rounded-lg hover:bg-primary/90 shadow-sm"
        >
          + Add New Item
        </button>
      </div>

      {message && (
        <div className={`mb-4 px-3 py-2 text-sm rounded-lg border ${
          message.type === 'success'
            ? 'bg-green-50 border-green-200 text-green-700'
            : 'bg-red-50 border-red-200 text-red-700'
        }`}>
          {message.text}
        </div>
      )}

      <div className="bg-white rounded-xl border border-gray-100 shadow-sm">
        {items.length === 0 ? (
          <div className="p-8 text-center text-sm text-gray-400">
            No saved items yet. Click &quot;+ Add New Item&quot; to create one.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs text-gray-500 uppercase border-b border-gray-100">
                  <th className="px-4 py-3">Description</th>
                  <th className="px-4 py-3 w-28">Rate</th>
                  <th className="px-4 py-3 w-32">Tax</th>
                  <th className="px-4 py-3 w-24">Unit</th>
                  <th className="px-4 py-3 w-28">Group</th>
                  <th className="px-4 py-3 w-24">Actions</th>
                </tr>
              </thead>
              <tbody>
                {items.map((item) => (
                  <tr key={item.id} className="border-b border-gray-50 hover:bg-gray-50/50">
                    <td className="px-4 py-3">
                      <div className="font-medium text-gray-900">{item.description}</div>
                      {item.longDescription && (
                        <div className="text-xs text-gray-500 mt-0.5 line-clamp-1">{item.longDescription}</div>
                      )}
                    </td>
                    <td className="px-4 py-3 tabular-nums">{Number(item.rate).toFixed(2)}</td>
                    <td className="px-4 py-3 text-gray-500 text-xs">
                      {item.tax1 || item.tax2 ? (
                        <span>{[item.tax1, item.tax2].filter(Boolean).length} tax(es)</span>
                      ) : (
                        <span>{Number(item.taxRate) > 0 ? `${Number(item.taxRate)}%` : 'No Tax'}</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-gray-500">{item.unit || '-'}</td>
                    <td className="px-4 py-3 text-gray-500">{item.groupName || '-'}</td>
                    <td className="px-4 py-3">
                      <div className="flex gap-2">
                        <button
                          onClick={() => handleEdit(item)}
                          className="text-xs text-primary hover:underline font-medium"
                        >
                          Edit
                        </button>
                        <button
                          onClick={() => handleDelete(item.id)}
                          className="text-xs text-red-500 hover:underline font-medium"
                        >
                          Delete
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <SavedItemModal
        open={modalOpen}
        onClose={() => { setModalOpen(false); setEditItem(null); }}
        onSaved={handleSaved}
        editId={editItem?.id}
        initialData={editItem ? {
          description: editItem.description,
          longDescription: editItem.longDescription,
          rate: Number(editItem.rate),
          tax1: editItem.tax1,
          tax2: editItem.tax2,
          unit: editItem.unit,
          groupName: editItem.groupName,
          assignedTo: editItem.assignedTo,
          state: editItem.state,
          zipCode: editItem.zipCode,
        } : undefined}
      />
    </div>
  );
}
