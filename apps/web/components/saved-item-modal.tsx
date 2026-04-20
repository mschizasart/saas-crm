'use client';

import { useState, useEffect, useRef } from 'react';
import { useModalA11y } from './ui/use-modal-a11y';

const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001';

function getToken(): string | null {
  if (typeof window === 'undefined') return null;
  return localStorage.getItem('access_token');
}

function authHeaders(): HeadersInit {
  return { Authorization: `Bearer ${getToken()}`, 'Content-Type': 'application/json' };
}

interface TaxOption {
  id: string;
  name: string;
  rate: number;
}

interface StaffOption {
  id: string;
  firstName?: string;
  lastName?: string;
  email?: string;
  name?: string;
}

export interface SavedItemModalProps {
  open: boolean;
  onClose: () => void;
  onSaved: (item: any) => void;
  initialData?: {
    description?: string;
    longDescription?: string;
    rate?: number;
    tax1?: string;
    tax2?: string;
    unit?: string;
    groupName?: string;
    assignedTo?: string;
    state?: string;
    zipCode?: string;
  };
  editId?: string;
}

interface FormState {
  description: string;
  longDescription: string;
  rate: string;
  tax1: string;
  tax2: string;
  unit: string;
  state: string;
  zipCode: string;
  groupName: string;
  assignedTo: string;
}

const EMPTY_FORM: FormState = {
  description: '',
  longDescription: '',
  rate: '0',
  tax1: '',
  tax2: '',
  unit: '',
  state: '',
  zipCode: '',
  groupName: '',
  assignedTo: '',
};

export default function SavedItemModal({
  open,
  onClose,
  onSaved,
  initialData,
  editId,
}: SavedItemModalProps) {
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Lookup data
  const [taxes, setTaxes] = useState<TaxOption[]>([]);
  const [staffMembers, setStaffMembers] = useState<StaffOption[]>([]);
  const [baseCurrency, setBaseCurrency] = useState('EUR');
  const [existingGroups, setExistingGroups] = useState<string[]>([]);
  const [showGroupDropdown, setShowGroupDropdown] = useState(false);

  const groupInputRef = useRef<HTMLInputElement>(null);
  const backdropRef = useRef<HTMLDivElement>(null);
  const containerRef = useModalA11y(open, onClose);

  // Load lookup data on mount
  useEffect(() => {
    if (!open) return;
    const headers = { Authorization: `Bearer ${getToken()}` };

    fetch(`${API_BASE}/api/v1/organizations/taxes`, { headers })
      .then((r) => r.json())
      .then((d) => setTaxes(Array.isArray(d) ? d : d.data ?? []))
      .catch(() => {});

    fetch(`${API_BASE}/api/v1/users?limit=100`, { headers })
      .then((r) => r.json())
      .then((d) => setStaffMembers(Array.isArray(d) ? d : d.data ?? []))
      .catch(() => {});

    // Fetch org settings for base currency
    fetch(`${API_BASE}/api/v1/organizations/current`, { headers })
      .then((r) => r.json())
      .then((d) => {
        const org = d.data ?? d;
        const settings = typeof org.settings === 'string' ? JSON.parse(org.settings) : (org.settings ?? {});
        setBaseCurrency(settings.baseCurrency ?? settings.currency ?? 'EUR');
      })
      .catch(() => {});

    // Fetch existing saved items to get group names
    fetch(`${API_BASE}/api/v1/saved-items`, { headers })
      .then((r) => r.json())
      .then((d) => {
        const items = Array.isArray(d) ? d : d.data ?? [];
        const groups = [...new Set(items.map((i: any) => i.groupName).filter(Boolean))] as string[];
        setExistingGroups(groups);
      })
      .catch(() => {});
  }, [open]);

  // Reset form when modal opens
  useEffect(() => {
    if (!open) return;
    if (editId && initialData) {
      setForm({
        description: initialData.description ?? '',
        longDescription: initialData.longDescription ?? '',
        rate: String(initialData.rate ?? 0),
        tax1: initialData.tax1 ?? '',
        tax2: initialData.tax2 ?? '',
        unit: initialData.unit ?? '',
        state: initialData.state ?? '',
        zipCode: initialData.zipCode ?? '',
        groupName: initialData.groupName ?? '',
        assignedTo: initialData.assignedTo ?? '',
      });
    } else if (initialData) {
      setForm({
        ...EMPTY_FORM,
        description: initialData.description ?? '',
        longDescription: initialData.longDescription ?? '',
        rate: String(initialData.rate ?? 0),
        tax1: initialData.tax1 ?? '',
        tax2: initialData.tax2 ?? '',
        unit: initialData.unit ?? '',
      });
    } else {
      setForm(EMPTY_FORM);
    }
    setError(null);
  }, [open, editId, initialData]);

  function handleBackdropClick(e: React.MouseEvent) {
    if (e.target === backdropRef.current) {
      onClose();
    }
  }

  function staffDisplayName(s: StaffOption): string {
    if (s.firstName && s.lastName) return `${s.firstName} ${s.lastName}`;
    return s.name ?? s.email ?? s.id;
  }

  const filteredGroups = existingGroups.filter(
    (g) => g.toLowerCase().includes(form.groupName.toLowerCase()) && g !== form.groupName,
  );

  async function handleSave() {
    if (!form.description.trim()) {
      setError('Description is required');
      return;
    }
    setSaving(true);
    setError(null);

    try {
      const payload: any = {
        description: form.description.trim(),
        longDescription: form.longDescription || undefined,
        rate: Number(form.rate) || 0,
        tax1: form.tax1 || undefined,
        tax2: form.tax2 || undefined,
        unit: form.unit || undefined,
        state: form.state || undefined,
        zipCode: form.zipCode || undefined,
        groupName: form.groupName || undefined,
        assignedTo: form.assignedTo || undefined,
        taxRate: 0,
      };

      const url = editId
        ? `${API_BASE}/api/v1/saved-items/${editId}`
        : `${API_BASE}/api/v1/saved-items`;
      const method = editId ? 'PATCH' : 'POST';

      const res = await fetch(url, {
        method,
        headers: authHeaders(),
        body: JSON.stringify(payload),
      });

      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        throw new Error(j.message || `Failed (${res.status})`);
      }

      const saved = await res.json();
      onSaved(saved);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save item');
    } finally {
      setSaving(false);
    }
  }

  if (!open) return null;

  const inputClass =
    'w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary bg-white';

  return (
    <div
      ref={backdropRef}
      onClick={handleBackdropClick}
      className="fixed inset-0 z-50 flex items-start justify-center bg-black/40 backdrop-blur-sm overflow-y-auto"
    >
      <div
        ref={containerRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="saved-item-modal-title"
        className="bg-white rounded-xl shadow-2xl max-w-2xl w-full mx-4 mt-20 mb-10"
      >
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
          <h2 id="saved-item-modal-title" className="text-lg font-semibold text-gray-900">
            {editId ? 'Edit Item' : 'Add New Item'}
          </h2>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-gray-600 text-xl leading-none p-1"
            aria-label="Close"
          >
            &times;
          </button>
        </div>

        {/* Body */}
        <div className="px-6 py-5 space-y-4">
          {error && (
            <div className="px-3 py-2 bg-red-50 border border-red-200 text-sm text-red-700 rounded-lg">
              {error}
            </div>
          )}

          {/* Row 1: Description + Assigned */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">
                Description <span className="text-red-500">*</span>
              </label>
              <input
                value={form.description}
                onChange={(e) => setForm({ ...form, description: e.target.value })}
                className={inputClass}
                placeholder="e.g. Web Design Service"
                autoFocus
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Assigned</label>
              <select
                value={form.assignedTo}
                onChange={(e) => setForm({ ...form, assignedTo: e.target.value })}
                className={inputClass}
              >
                <option value="">-- None --</option>
                {staffMembers.map((s) => (
                  <option key={s.id} value={s.id}>
                    {staffDisplayName(s)}
                  </option>
                ))}
              </select>
            </div>
          </div>

          {/* Row 2: Long Description (full width) */}
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Long Description</label>
            <textarea
              rows={3}
              value={form.longDescription}
              onChange={(e) => setForm({ ...form, longDescription: e.target.value })}
              className={inputClass}
              placeholder="Detailed description..."
            />
          </div>

          {/* Row 3: Rate */}
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">
              Rate <span className="text-red-500">*</span>
              <span className="ml-2 text-gray-400 font-normal">
                {baseCurrency} (Base Currency)
              </span>
            </label>
            <input
              type="number"
              step="0.01"
              value={form.rate}
              onChange={(e) => setForm({ ...form, rate: e.target.value })}
              className={inputClass}
            />
          </div>

          {/* Row 4: Tax 1 + Tax 2 */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Tax 1</label>
              <select
                value={form.tax1}
                onChange={(e) => setForm({ ...form, tax1: e.target.value })}
                className={inputClass}
              >
                <option value="">No Tax</option>
                {taxes.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name} ({Number(t.rate)}%)
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Tax 2</label>
              <select
                value={form.tax2}
                onChange={(e) => setForm({ ...form, tax2: e.target.value })}
                className={inputClass}
              >
                <option value="">No Tax</option>
                {taxes.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name} ({Number(t.rate)}%)
                  </option>
                ))}
              </select>
            </div>
          </div>

          {/* Row 5: Unit + State + Zip Code */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Unit</label>
              <input
                value={form.unit}
                onChange={(e) => setForm({ ...form, unit: e.target.value })}
                className={inputClass}
                placeholder="e.g. piece, hour, kg"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">State</label>
              <input
                value={form.state}
                onChange={(e) => setForm({ ...form, state: e.target.value })}
                className={inputClass}
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Zip Code</label>
              <input
                value={form.zipCode}
                onChange={(e) => setForm({ ...form, zipCode: e.target.value })}
                className={inputClass}
              />
            </div>
          </div>

          {/* Row 6: Item Group (combo select/input) */}
          <div className="relative">
            <label className="block text-xs font-medium text-gray-600 mb-1">Item Group</label>
            <input
              ref={groupInputRef}
              value={form.groupName}
              onChange={(e) => {
                setForm({ ...form, groupName: e.target.value });
                setShowGroupDropdown(true);
              }}
              onFocus={() => setShowGroupDropdown(true)}
              onBlur={() => setTimeout(() => setShowGroupDropdown(false), 200)}
              className={inputClass}
              placeholder="Select or type a new group..."
            />
            {showGroupDropdown && (existingGroups.length > 0 || form.groupName) && (
              <div className="absolute z-10 left-0 right-0 top-full mt-1 bg-white border border-gray-200 rounded-lg shadow-lg max-h-40 overflow-y-auto">
                {!form.groupName && (
                  <button
                    type="button"
                    className="w-full text-left px-3 py-2 text-sm text-gray-400 hover:bg-gray-50 border-b border-gray-50"
                    onMouseDown={(e) => {
                      e.preventDefault();
                      setForm({ ...form, groupName: '' });
                      setShowGroupDropdown(false);
                    }}
                  >
                    Nothing selected
                  </button>
                )}
                {(form.groupName ? filteredGroups : existingGroups).map((g) => (
                  <button
                    key={g}
                    type="button"
                    className="w-full text-left px-3 py-2 text-sm hover:bg-primary/5 border-b border-gray-50 last:border-0"
                    onMouseDown={(e) => {
                      e.preventDefault();
                      setForm({ ...form, groupName: g });
                      setShowGroupDropdown(false);
                    }}
                  >
                    {g}
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Footer */}
        <div className="flex justify-end gap-3 px-6 py-4 border-t border-gray-100">
          <button
            onClick={onClose}
            className="px-4 py-2 text-sm font-medium text-gray-600 border border-gray-200 rounded-lg hover:bg-gray-50"
          >
            Close
          </button>
          <button
            onClick={handleSave}
            disabled={saving || !form.description.trim()}
            className="px-5 py-2 bg-primary text-white text-sm font-medium rounded-lg hover:bg-primary/90 disabled:opacity-50 shadow-sm"
          >
            {saving ? 'Saving...' : 'Save'}
          </button>
        </div>
      </div>
    </div>
  );
}
