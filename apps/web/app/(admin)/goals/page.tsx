'use client';

import { useState, useEffect, useCallback } from 'react';

interface Goal {
  id: string;
  name: string;
  description: string | null;
  type: string | null;
  target: number | string | null;
  current: number | string | null;
  startDate: string | null;
  endDate: string | null;
  status: string;
  achievedAt: string | null;
}

const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001';

function getToken() {
  if (typeof window === 'undefined') return null;
  return localStorage.getItem('access_token');
}

const GOAL_TYPES = [
  { value: 'total_income', label: 'Total Income' },
  { value: 'leads_converted', label: 'Leads Converted' },
  { value: 'invoices_sent', label: 'Invoices Sent' },
  { value: 'clients_added', label: 'Clients Added' },
  { value: 'tickets_closed', label: 'Tickets Closed' },
];

function StatusBadge({ status }: { status: string }) {
  const colors: Record<string, string> = {
    active: 'bg-blue-100 text-blue-700',
    achieved: 'bg-green-100 text-green-700',
    failed: 'bg-red-100 text-red-700',
    not_started: 'bg-gray-100 text-gray-600',
  };
  return (
    <span
      className={`text-xs font-medium px-2 py-0.5 rounded-full ${colors[status] ?? 'bg-gray-100 text-gray-600'}`}
    >
      {status.replace(/_/g, ' ')}
    </span>
  );
}

function GoalCard({
  goal,
  onClick,
}: {
  goal: Goal;
  onClick: () => void;
}) {
  const target = Number(goal.target ?? 0);
  const current = Number(goal.current ?? 0);
  const pct =
    target > 0 ? Math.min(100, Math.round((current / target) * 100)) : 0;

  return (
    <div
      onClick={onClick}
      className="bg-white rounded-xl border border-gray-100 shadow-sm p-5 cursor-pointer hover:shadow-md transition-shadow"
    >
      <div className="flex items-start justify-between mb-3">
        <h3 className="font-semibold text-gray-900">{goal.name}</h3>
        <StatusBadge status={goal.status} />
      </div>
      {goal.description && (
        <p className="text-sm text-gray-500 mb-3 line-clamp-2">
          {goal.description}
        </p>
      )}
      <div className="mb-2">
        <div className="flex items-center justify-between text-xs text-gray-600 mb-1">
          <span>
            {current.toLocaleString()} / {target.toLocaleString()}
          </span>
          <span className="font-medium">{pct}%</span>
        </div>
        <div className="h-2 bg-gray-100 rounded-full overflow-hidden">
          <div
            className="h-full bg-primary rounded-full transition-all"
            style={{ width: `${pct}%` }}
          />
        </div>
      </div>
      <p className="text-xs text-gray-400">
        {goal.startDate && new Date(goal.startDate).toLocaleDateString()} —{' '}
        {goal.endDate && new Date(goal.endDate).toLocaleDateString()}
      </p>
    </div>
  );
}

export default function GoalsPage() {
  const [goals, setGoals] = useState<Goal[]>([]);
  const [loading, setLoading] = useState(true);
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<Goal | null>(null);
  const [form, setForm] = useState({
    title: '',
    description: '',
    type: 'total_income',
    target: '',
    startDate: '',
    endDate: '',
    achieved: '',
  });

  const fetchGoals = useCallback(async () => {
    setLoading(true);
    const token = getToken();
    const res = await fetch(`${API_BASE}/api/v1/goals`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (res.ok) {
      const json = await res.json();
      setGoals(json.data ?? []);
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    fetchGoals();
  }, [fetchGoals]);

  function openNew() {
    setEditing(null);
    setForm({
      title: '',
      description: '',
      type: 'total_income',
      target: '',
      startDate: '',
      endDate: '',
      achieved: '',
    });
    setModalOpen(true);
  }

  function openEdit(g: Goal) {
    setEditing(g);
    setForm({
      title: g.name,
      description: g.description ?? '',
      type: g.type ?? 'total_income',
      target: String(g.target ?? ''),
      startDate: g.startDate ? g.startDate.slice(0, 10) : '',
      endDate: g.endDate ? g.endDate.slice(0, 10) : '',
      achieved: String(g.current ?? ''),
    });
    setModalOpen(true);
  }

  async function save() {
    const token = getToken();
    const body = {
      title: form.title,
      description: form.description || undefined,
      type: form.type,
      target: Number(form.target),
      startDate: form.startDate,
      endDate: form.endDate,
    };
    const url = editing
      ? `${API_BASE}/api/v1/goals/${editing.id}`
      : `${API_BASE}/api/v1/goals`;
    const method = editing ? 'PATCH' : 'POST';
    const res = await fetch(url, {
      method,
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify(body),
    });
    if (res.ok && editing && form.achieved !== '') {
      await fetch(`${API_BASE}/api/v1/goals/${editing.id}/progress`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ achieved: Number(form.achieved) }),
      });
    }
    setModalOpen(false);
    fetchGoals();
  }

  async function remove() {
    if (!editing) return;
    if (!confirm('Delete this goal?')) return;
    const token = getToken();
    await fetch(`${API_BASE}/api/v1/goals/${editing.id}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${token}` },
    });
    setModalOpen(false);
    fetchGoals();
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold text-gray-900">Goals</h1>
        <button
          onClick={openNew}
          className="inline-flex items-center gap-1.5 bg-primary text-white text-sm font-medium px-4 py-2 rounded-lg hover:bg-primary/90"
        >
          <span className="text-lg leading-none">+</span>New Goal
        </button>
      </div>

      {loading ? (
        <p className="text-gray-400">Loading...</p>
      ) : goals.length === 0 ? (
        <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-10 text-center text-gray-400">
          No goals yet — create your first one.
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {goals.map((g) => (
            <GoalCard key={g.id} goal={g} onClick={() => openEdit(g)} />
          ))}
        </div>
      )}

      {modalOpen && (
        <div
          className="fixed inset-0 bg-black/40 flex items-center justify-center z-50"
          onClick={() => setModalOpen(false)}
        >
          <div
            className="bg-white rounded-xl shadow-xl p-6 w-full max-w-md"
            onClick={(e) => e.stopPropagation()}
          >
            <h2 className="text-lg font-semibold mb-4">
              {editing ? 'Edit Goal' : 'New Goal'}
            </h2>
            <div className="space-y-3">
              <div>
                <label className="text-xs font-medium text-gray-600">Title</label>
                <input
                  value={form.title}
                  onChange={(e) => setForm({ ...form, title: e.target.value })}
                  className="w-full border border-gray-200 rounded px-3 py-2 text-sm"
                />
              </div>
              <div>
                <label className="text-xs font-medium text-gray-600">Description</label>
                <textarea
                  value={form.description}
                  onChange={(e) => setForm({ ...form, description: e.target.value })}
                  rows={2}
                  className="w-full border border-gray-200 rounded px-3 py-2 text-sm"
                />
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="text-xs font-medium text-gray-600">Type</label>
                  <select
                    value={form.type}
                    onChange={(e) => setForm({ ...form, type: e.target.value })}
                    className="w-full border border-gray-200 rounded px-2 py-2 text-sm bg-white"
                  >
                    {GOAL_TYPES.map((t) => (
                      <option key={t.value} value={t.value}>
                        {t.label}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="text-xs font-medium text-gray-600">Target</label>
                  <input
                    type="number"
                    value={form.target}
                    onChange={(e) => setForm({ ...form, target: e.target.value })}
                    className="w-full border border-gray-200 rounded px-3 py-2 text-sm"
                  />
                </div>
                <div>
                  <label className="text-xs font-medium text-gray-600">Start</label>
                  <input
                    type="date"
                    value={form.startDate}
                    onChange={(e) => setForm({ ...form, startDate: e.target.value })}
                    className="w-full border border-gray-200 rounded px-2 py-2 text-sm"
                  />
                </div>
                <div>
                  <label className="text-xs font-medium text-gray-600">End</label>
                  <input
                    type="date"
                    value={form.endDate}
                    onChange={(e) => setForm({ ...form, endDate: e.target.value })}
                    className="w-full border border-gray-200 rounded px-2 py-2 text-sm"
                  />
                </div>
              </div>
              {editing && (
                <div>
                  <label className="text-xs font-medium text-gray-600">
                    Achieved (progress)
                  </label>
                  <input
                    type="number"
                    value={form.achieved}
                    onChange={(e) => setForm({ ...form, achieved: e.target.value })}
                    className="w-full border border-gray-200 rounded px-3 py-2 text-sm"
                  />
                </div>
              )}
            </div>
            <div className="flex items-center justify-between mt-6">
              {editing ? (
                <button
                  onClick={remove}
                  className="text-sm text-red-600 hover:text-red-700"
                >
                  Delete
                </button>
              ) : (
                <span />
              )}
              <div className="flex items-center gap-2">
                <button
                  onClick={() => setModalOpen(false)}
                  className="px-4 py-2 text-sm border border-gray-200 rounded-md hover:bg-gray-50"
                >
                  Cancel
                </button>
                <button
                  onClick={save}
                  disabled={!form.title || !form.target || !form.startDate || !form.endDate}
                  className="px-4 py-2 text-sm bg-primary text-white rounded-md hover:bg-primary/90 disabled:opacity-50"
                >
                  Save
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
