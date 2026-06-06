'use client';

import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { ErrorBanner } from '@/components/ui/error-banner';
import { apiFetch } from '@/lib/api';

interface Stage {
  id: string;
  name: string;
  order: number;
  probability: number | string;
  isWon: boolean;
  isLost: boolean;
  _count?: { opportunities: number };
}

function toNum(v: number | string): number {
  if (typeof v === 'number') return v;
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

export default function PipelinesSettingsPage() {
  const [stages, setStages] = useState<Stage[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);

  // New-stage form
  const [newName, setNewName] = useState('');
  const [newProbability, setNewProbability] = useState('20');
  const [newIsWon, setNewIsWon] = useState(false);
  const [newIsLost, setNewIsLost] = useState(false);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const res = await apiFetch('/api/v1/pipelines/stages');
      if (!res.ok) throw new Error(`Load failed: ${res.status}`);
      const data = (await res.json()) as Stage[];
      data.sort((a, b) => a.order - b.order);
      setStages(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); }, []);

  async function addStage(e: React.FormEvent) {
    e.preventDefault();
    setAdding(true);
    setError(null);
    try {
      const res = await apiFetch('/api/v1/pipelines/stages', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: newName,
          probability: Number(newProbability),
          isWon: newIsWon,
          isLost: newIsLost,
        }),
      });
      if (!res.ok) {
        const msg = await res.text();
        throw new Error(msg || `Create failed: ${res.status}`);
      }
      setNewName('');
      setNewProbability('20');
      setNewIsWon(false);
      setNewIsLost(false);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Create failed');
    } finally {
      setAdding(false);
    }
  }

  async function updateStage(id: string, patch: Partial<Stage>) {
    setError(null);
    // Optimistic
    setStages((prev) => prev.map((s) => (s.id === id ? { ...s, ...patch } : s)));
    const body: Record<string, unknown> = {};
    if (patch.name !== undefined) body.name = patch.name;
    if (patch.probability !== undefined) body.probability = toNum(patch.probability);
    if (patch.isWon !== undefined) body.isWon = patch.isWon;
    if (patch.isLost !== undefined) body.isLost = patch.isLost;
    const res = await apiFetch(`/api/v1/pipelines/stages/${id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const msg = await res.text();
      setError(msg || `Update failed: ${res.status}`);
      await load();
    }
  }

  async function deleteStage(id: string) {
    if (!confirm('Delete this stage?')) return;
    setError(null);
    const res = await apiFetch(`/api/v1/pipelines/stages/${id}`, { method: 'DELETE' });
    if (!res.ok && res.status !== 204) {
      // Try to surface the friendly "n deals still use this" message.
      try {
        const body = await res.json();
        setError(body?.message || `Delete failed: ${res.status}`);
      } catch {
        setError(`Delete failed: ${res.status}`);
      }
      return;
    }
    await load();
  }

  async function move(id: string, delta: -1 | 1) {
    const idx = stages.findIndex((s) => s.id === id);
    if (idx < 0) return;
    const swapIdx = idx + delta;
    if (swapIdx < 0 || swapIdx >= stages.length) return;

    const reordered = [...stages];
    [reordered[idx], reordered[swapIdx]] = [reordered[swapIdx], reordered[idx]];
    const items = reordered.map((s, i) => ({ id: s.id, order: i + 1 }));

    // Optimistic
    setStages(reordered.map((s, i) => ({ ...s, order: i + 1 })));

    const res = await apiFetch('/api/v1/pipelines/stages/reorder', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(items),
    });
    if (!res.ok) {
      setError(`Reorder failed: ${res.status}`);
      await load();
    }
  }

  return (
    <div className="max-w-4xl mx-auto p-6 space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Pipeline Stages</h1>
        <p className="text-sm text-gray-500 mt-1">
          Configure the columns of your opportunity Kanban. The probability is used to compute the weighted forecast.
        </p>
      </div>

      {error && <ErrorBanner message={error} />}

      <Card className="p-5">
        <h2 className="text-sm font-semibold mb-3">Add a stage</h2>
        <form onSubmit={addStage} className="grid grid-cols-1 md:grid-cols-6 gap-3 items-end">
          <div className="md:col-span-2">
            <label className="block text-xs font-medium text-gray-600 mb-1">Name</label>
            <input
              required
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              className="w-full px-3 py-2 text-sm border border-gray-200 dark:border-gray-700 rounded-lg"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Probability %</label>
            <input
              required
              type="number"
              min={0}
              max={100}
              step="1"
              value={newProbability}
              onChange={(e) => setNewProbability(e.target.value)}
              className="w-full px-3 py-2 text-sm border border-gray-200 dark:border-gray-700 rounded-lg"
            />
          </div>
          <label className="flex items-center gap-2 text-xs font-medium text-gray-600">
            <input type="checkbox" checked={newIsWon} onChange={(e) => setNewIsWon(e.target.checked)} />
            isWon
          </label>
          <label className="flex items-center gap-2 text-xs font-medium text-gray-600">
            <input type="checkbox" checked={newIsLost} onChange={(e) => setNewIsLost(e.target.checked)} />
            isLost
          </label>
          <div>
            <Button type="submit" disabled={adding || !newName}>
              {adding ? 'Adding…' : 'Add stage'}
            </Button>
          </div>
        </form>
      </Card>

      <Card className="p-0 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead>
              <tr className="text-left text-xs font-semibold text-gray-500 uppercase tracking-wide border-b border-gray-100 dark:border-gray-800 bg-gray-50 dark:bg-gray-900">
                <th className="px-3 py-2 w-20">Order</th>
                <th className="px-3 py-2">Name</th>
                <th className="px-3 py-2 w-32">Probability</th>
                <th className="px-3 py-2 w-24">Won</th>
                <th className="px-3 py-2 w-24">Lost</th>
                <th className="px-3 py-2 w-24">Deals</th>
                <th className="px-3 py-2 text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={7} className="px-4 py-8 text-center text-gray-400">Loading…</td></tr>
              ) : stages.length === 0 ? (
                <tr><td colSpan={7} className="px-4 py-8 text-center text-gray-400">No stages — add one above.</td></tr>
              ) : (
                stages.map((s, idx) => (
                  <tr key={s.id} className="border-b border-gray-100 dark:border-gray-800 last:border-0">
                    <td className="px-3 py-2">
                      <div className="flex flex-col gap-1">
                        <button
                          disabled={idx === 0}
                          onClick={() => move(s.id, -1)}
                          className="text-xs text-gray-500 hover:text-primary disabled:opacity-30"
                          aria-label="Move up"
                        >▲</button>
                        <button
                          disabled={idx === stages.length - 1}
                          onClick={() => move(s.id, 1)}
                          className="text-xs text-gray-500 hover:text-primary disabled:opacity-30"
                          aria-label="Move down"
                        >▼</button>
                      </div>
                    </td>
                    <td className="px-3 py-2">
                      <input
                        defaultValue={s.name}
                        onBlur={(e) => {
                          const v = e.target.value.trim();
                          if (v && v !== s.name) updateStage(s.id, { name: v });
                        }}
                        className="w-full px-2 py-1 text-sm border border-transparent hover:border-gray-200 dark:hover:border-gray-700 focus:border-primary rounded"
                      />
                    </td>
                    <td className="px-3 py-2">
                      <input
                        type="number"
                        min={0}
                        max={100}
                        step="1"
                        defaultValue={toNum(s.probability)}
                        onBlur={(e) => {
                          const v = Number(e.target.value);
                          if (Number.isFinite(v) && v !== toNum(s.probability)) {
                            updateStage(s.id, { probability: v });
                          }
                        }}
                        className="w-24 px-2 py-1 text-sm border border-transparent hover:border-gray-200 dark:hover:border-gray-700 focus:border-primary rounded"
                      />
                      <span className="ml-1 text-xs text-gray-400">%</span>
                    </td>
                    <td className="px-3 py-2">
                      <input
                        type="checkbox"
                        checked={s.isWon}
                        onChange={(e) => updateStage(s.id, { isWon: e.target.checked })}
                      />
                    </td>
                    <td className="px-3 py-2">
                      <input
                        type="checkbox"
                        checked={s.isLost}
                        onChange={(e) => updateStage(s.id, { isLost: e.target.checked })}
                      />
                    </td>
                    <td className="px-3 py-2 text-gray-500 dark:text-gray-400">
                      {s._count?.opportunities ?? 0}
                    </td>
                    <td className="px-3 py-2 text-right">
                      <button
                        onClick={() => deleteStage(s.id)}
                        className="text-xs text-red-600 hover:underline"
                      >
                        Delete
                      </button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}
