'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Plus, Pencil, Trash2, X } from 'lucide-react';

const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001';

interface Plan {
  id: string;
  name: string;
  slug: string;
  description?: string | null;
  monthlyPrice: string | number;
  yearlyPrice: string | number;
  currency: string;
  maxStaff: number;
  maxClients: number;
  maxActiveProjects: number;
  maxStorageMB: number;
  features?: string[] | null;
  active: boolean;
  public: boolean;
  order: number;
}

interface FormState {
  name: string;
  slug: string;
  description: string;
  monthlyPrice: number;
  yearlyPrice: number;
  currency: string;
  maxStaff: number;
  maxClients: number;
  maxActiveProjects: number;
  maxStorageMB: number;
  features: string;
  active: boolean;
  public: boolean;
  order: number;
}

const EMPTY_FORM: FormState = {
  name: '',
  slug: '',
  description: '',
  monthlyPrice: 0,
  yearlyPrice: 0,
  currency: 'USD',
  maxStaff: 5,
  maxClients: 50,
  maxActiveProjects: 10,
  maxStorageMB: 1000,
  features: '',
  active: true,
  public: true,
  order: 0,
};

export default function PlatformPlansPage() {
  const router = useRouter();
  const [plans, setPlans] = useState<Plan[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [editing, setEditing] = useState<Plan | null>(null);
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const token = () =>
    typeof window === 'undefined' ? null : localStorage.getItem('platform_token');

  const fetchPlans = async () => {
    const t = token();
    if (!t) {
      router.replace('/platform/login');
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`${API_BASE}/api/v1/platform/plans`, {
        headers: { Authorization: `Bearer ${t}` },
      });
      if (res.status === 401) {
        router.replace('/platform/login');
        return;
      }
      if (!res.ok) {
        setError('Failed to load plans');
        return;
      }
      setPlans(await res.json());
    } catch {
      setError('Network error');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchPlans();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const openNew = () => {
    setEditing(null);
    setForm(EMPTY_FORM);
    setFormError(null);
    setDrawerOpen(true);
  };

  const openEdit = (plan: Plan) => {
    setEditing(plan);
    setForm({
      name: plan.name,
      slug: plan.slug,
      description: plan.description ?? '',
      monthlyPrice: Number(plan.monthlyPrice),
      yearlyPrice: Number(plan.yearlyPrice),
      currency: plan.currency,
      maxStaff: plan.maxStaff,
      maxClients: plan.maxClients,
      maxActiveProjects: plan.maxActiveProjects,
      maxStorageMB: plan.maxStorageMB,
      features: (plan.features ?? []).join('\n'),
      active: plan.active,
      public: plan.public,
      order: plan.order,
    });
    setFormError(null);
    setDrawerOpen(true);
  };

  const save = async () => {
    const t = token();
    if (!t) return;
    setBusy(true);
    setFormError(null);
    try {
      const body = {
        ...form,
        features: form.features
          .split('\n')
          .map((s) => s.trim())
          .filter(Boolean),
      };
      const url = editing
        ? `${API_BASE}/api/v1/platform/plans/${editing.id}`
        : `${API_BASE}/api/v1/platform/plans`;
      const res = await fetch(url, {
        method: editing ? 'PATCH' : 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${t}`,
        },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setFormError(data.message || 'Save failed');
        return;
      }
      setDrawerOpen(false);
      fetchPlans();
    } catch {
      setFormError('Network error');
    } finally {
      setBusy(false);
    }
  };

  const remove = async (plan: Plan) => {
    if (!confirm(`Delete plan "${plan.name}"?`)) return;
    const t = token();
    if (!t) return;
    const res = await fetch(`${API_BASE}/api/v1/platform/plans/${plan.id}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${t}` },
    });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      alert(data.message || 'Delete failed');
      return;
    }
    fetchPlans();
  };

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Subscription Plans</h1>
          <p className="text-sm text-gray-500 mt-1">
            Manage platform pricing tiers and feature limits.
          </p>
        </div>
        <button
          onClick={openNew}
          className="inline-flex items-center gap-2 px-4 py-2 bg-indigo-600 text-white rounded-lg text-sm font-medium hover:bg-indigo-700"
        >
          <Plus className="w-4 h-4" /> New Plan
        </button>
      </div>

      {error && (
        <div className="mb-4 p-3 rounded-lg bg-red-50 border border-red-100 text-sm text-red-700">
          {error}
        </div>
      )}

      <div className="bg-white rounded-xl border border-gray-100 shadow-sm overflow-hidden">
        <div className="overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead>
              <tr className="bg-gray-50 border-b border-gray-100 text-left text-xs font-semibold text-gray-400 uppercase tracking-wide">
                <th className="px-4 py-2.5">Name</th>
                <th className="px-4 py-2.5">Slug</th>
                <th className="px-4 py-2.5">Monthly</th>
                <th className="px-4 py-2.5">Yearly</th>
                <th className="px-4 py-2.5">Staff</th>
                <th className="px-4 py-2.5">Clients</th>
                <th className="px-4 py-2.5">Active</th>
                <th className="px-4 py-2.5">Public</th>
                <th className="px-4 py-2.5">Order</th>
                <th className="px-4 py-2.5 text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan={10} className="px-4 py-8 text-center text-sm text-gray-400">
                    Loading…
                  </td>
                </tr>
              ) : plans.length === 0 ? (
                <tr>
                  <td colSpan={10} className="px-4 py-8 text-center text-sm text-gray-400">
                    No plans yet. Create your first plan.
                  </td>
                </tr>
              ) : (
                plans.map((p) => (
                  <tr
                    key={p.id}
                    className="border-b border-gray-100 last:border-0 hover:bg-gray-50/60 transition-colors"
                  >
                    <td className="px-4 py-3 font-medium text-gray-900">{p.name}</td>
                    <td className="px-4 py-3 font-mono text-xs text-gray-500">{p.slug}</td>
                    <td className="px-4 py-3 text-gray-700">
                      {p.currency} {Number(p.monthlyPrice).toFixed(2)}
                    </td>
                    <td className="px-4 py-3 text-gray-700">
                      {p.currency} {Number(p.yearlyPrice).toFixed(2)}
                    </td>
                    <td className="px-4 py-3 text-gray-700">{p.maxStaff}</td>
                    <td className="px-4 py-3 text-gray-700">{p.maxClients}</td>
                    <td className="px-4 py-3">
                      <span
                        className={`inline-flex px-2 py-1 rounded-full text-xs font-medium ${
                          p.active ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-500'
                        }`}
                      >
                        {p.active ? 'Yes' : 'No'}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <span
                        className={`inline-flex px-2 py-1 rounded-full text-xs font-medium ${
                          p.public ? 'bg-blue-100 text-blue-700' : 'bg-gray-100 text-gray-500'
                        }`}
                      >
                        {p.public ? 'Yes' : 'No'}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-gray-700">{p.order}</td>
                    <td className="px-4 py-3">
                      <div className="flex items-center justify-end gap-2">
                        <button
                          onClick={() => openEdit(p)}
                          className="p-1.5 rounded hover:bg-gray-100 text-gray-500 hover:text-indigo-600"
                          title="Edit"
                        >
                          <Pencil className="w-4 h-4" />
                        </button>
                        <button
                          onClick={() => remove(p)}
                          className="p-1.5 rounded hover:bg-gray-100 text-gray-500 hover:text-red-600"
                          title="Delete"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Drawer */}
      {drawerOpen && (
        <div className="fixed inset-0 z-50 flex">
          <div
            className="flex-1 bg-black/40"
            onClick={() => !busy && setDrawerOpen(false)}
          />
          <div className="w-full max-w-xl bg-white h-full overflow-y-auto shadow-2xl">
            <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
              <h2 className="text-lg font-semibold text-gray-900">
                {editing ? 'Edit Plan' : 'New Plan'}
              </h2>
              <button
                onClick={() => !busy && setDrawerOpen(false)}
                className="p-1 rounded hover:bg-gray-100 text-gray-500"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="p-6 space-y-4">
              {formError && (
                <div className="p-3 rounded-lg bg-red-50 border border-red-100 text-sm text-red-700">
                  {formError}
                </div>
              )}

              <div className="grid grid-cols-2 gap-3">
                <Field label="Name">
                  <input
                    value={form.name}
                    onChange={(e) => setForm({ ...form, name: e.target.value })}
                    className={inputCls}
                  />
                </Field>
                <Field label="Slug">
                  <input
                    value={form.slug}
                    onChange={(e) => setForm({ ...form, slug: e.target.value })}
                    className={inputCls}
                  />
                </Field>
              </div>

              <Field label="Description">
                <textarea
                  value={form.description}
                  onChange={(e) => setForm({ ...form, description: e.target.value })}
                  rows={2}
                  className={inputCls}
                />
              </Field>

              <div className="grid grid-cols-3 gap-3">
                <Field label="Monthly Price">
                  <input
                    type="number"
                    step="0.01"
                    value={form.monthlyPrice}
                    onChange={(e) =>
                      setForm({ ...form, monthlyPrice: parseFloat(e.target.value) || 0 })
                    }
                    className={inputCls}
                  />
                </Field>
                <Field label="Yearly Price">
                  <input
                    type="number"
                    step="0.01"
                    value={form.yearlyPrice}
                    onChange={(e) =>
                      setForm({ ...form, yearlyPrice: parseFloat(e.target.value) || 0 })
                    }
                    className={inputCls}
                  />
                </Field>
                <Field label="Currency">
                  <input
                    value={form.currency}
                    onChange={(e) => setForm({ ...form, currency: e.target.value })}
                    className={inputCls}
                  />
                </Field>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <Field label="Max Staff">
                  <input
                    type="number"
                    value={form.maxStaff}
                    onChange={(e) =>
                      setForm({ ...form, maxStaff: parseInt(e.target.value, 10) || 0 })
                    }
                    className={inputCls}
                  />
                </Field>
                <Field label="Max Clients">
                  <input
                    type="number"
                    value={form.maxClients}
                    onChange={(e) =>
                      setForm({ ...form, maxClients: parseInt(e.target.value, 10) || 0 })
                    }
                    className={inputCls}
                  />
                </Field>
                <Field label="Max Active Projects">
                  <input
                    type="number"
                    value={form.maxActiveProjects}
                    onChange={(e) =>
                      setForm({ ...form, maxActiveProjects: parseInt(e.target.value, 10) || 0 })
                    }
                    className={inputCls}
                  />
                </Field>
                <Field label="Max Storage (MB)">
                  <input
                    type="number"
                    value={form.maxStorageMB}
                    onChange={(e) =>
                      setForm({ ...form, maxStorageMB: parseInt(e.target.value, 10) || 0 })
                    }
                    className={inputCls}
                  />
                </Field>
              </div>

              <Field label="Features (one per line)">
                <textarea
                  value={form.features}
                  onChange={(e) => setForm({ ...form, features: e.target.value })}
                  rows={4}
                  className={inputCls}
                  placeholder={'invoicing\nprojects\nsupport'}
                />
              </Field>

              <div className="grid grid-cols-3 gap-3 items-end">
                <Field label="Order">
                  <input
                    type="number"
                    value={form.order}
                    onChange={(e) =>
                      setForm({ ...form, order: parseInt(e.target.value, 10) || 0 })
                    }
                    className={inputCls}
                  />
                </Field>
                <label className="flex items-center gap-2 text-sm text-gray-700">
                  <input
                    type="checkbox"
                    checked={form.active}
                    onChange={(e) => setForm({ ...form, active: e.target.checked })}
                  />
                  Active
                </label>
                <label className="flex items-center gap-2 text-sm text-gray-700">
                  <input
                    type="checkbox"
                    checked={form.public}
                    onChange={(e) => setForm({ ...form, public: e.target.checked })}
                  />
                  Public
                </label>
              </div>
            </div>

            <div className="px-6 py-4 border-t border-gray-100 flex justify-end gap-2">
              <button
                onClick={() => !busy && setDrawerOpen(false)}
                className="px-4 py-2 text-sm font-medium text-gray-700 rounded-lg hover:bg-gray-100"
              >
                Cancel
              </button>
              <button
                onClick={save}
                disabled={busy || !form.name || !form.slug}
                className="px-4 py-2 bg-indigo-600 text-white rounded-lg text-sm font-medium hover:bg-indigo-700 disabled:opacity-60"
              >
                {busy ? 'Saving…' : editing ? 'Save Changes' : 'Create Plan'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

const inputCls =
  'w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500';

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1">
        {label}
      </span>
      {children}
    </label>
  );
}
