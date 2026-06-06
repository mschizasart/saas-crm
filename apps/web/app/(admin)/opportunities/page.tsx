'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { ListPageLayout } from '@/components/layouts/list-page-layout';
import { Button } from '@/components/ui/button';
import { ErrorBanner } from '@/components/ui/error-banner';
import { apiFetch } from '@/lib/api';

// ─── Types ──────────────────────────────────────────────────────

interface Stage {
  id: string;
  name: string;
  order: number;
  probability: number | string;
  isWon: boolean;
  isLost: boolean;
}

interface Opportunity {
  id: string;
  name: string;
  amount: number | string;
  currency: string;
  closeDate: string;
  stageId: string;
  ownerId: string;
  owner?: { id: string; firstName: string; lastName: string } | null;
  client?: { id: string; company: string } | null;
  lead?: { id: string; name: string } | null;
}

interface KanbanColumn {
  stage: Stage;
  opportunities: Opportunity[];
}

interface ClientLite { id: string; company: string }
interface UserLite { id: string; firstName: string; lastName: string }

// ─── Helpers ────────────────────────────────────────────────────

function toNum(v: number | string): number {
  if (typeof v === 'number') return v;
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

function formatMoney(amount: number | string, currency: string): string {
  const n = toNum(amount);
  try {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: currency || 'USD',
      maximumFractionDigits: 0,
    }).format(n);
  } catch {
    return `${currency} ${n.toLocaleString()}`;
  }
}

function ownerName(owner: Opportunity['owner']): string {
  if (!owner) return '—';
  return `${owner.firstName ?? ''} ${owner.lastName ?? ''}`.trim() || '—';
}

// ─── New Opportunity modal ──────────────────────────────────────

function NewOpportunityModal({
  open,
  onClose,
  onCreated,
  stages,
  clients,
  users,
}: {
  open: boolean;
  onClose: () => void;
  onCreated: () => void;
  stages: Stage[];
  clients: ClientLite[];
  users: UserLite[];
}) {
  const [name, setName] = useState('');
  const [clientId, setClientId] = useState('');
  const [amount, setAmount] = useState('');
  const [closeDate, setCloseDate] = useState(
    new Date(Date.now() + 30 * 86400_000).toISOString().slice(0, 10),
  );
  const [stageId, setStageId] = useState('');
  const [ownerId, setOwnerId] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setError(null);
    setStageId((s) => s || stages[0]?.id || '');
    setOwnerId((o) => o || users[0]?.id || '');
  }, [open, stages, users]);

  if (!open) return null;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      const res = await apiFetch('/api/v1/opportunities', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name,
          clientId: clientId || undefined,
          amount: amount ? Number(amount) : 0,
          closeDate,
          stageId,
          ownerId,
        }),
      });
      if (!res.ok) {
        const msg = await res.text();
        throw new Error(msg || `Server responded with ${res.status}`);
      }
      onCreated();
      onClose();
      // Reset for next open
      setName('');
      setClientId('');
      setAmount('');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="bg-white dark:bg-gray-900 rounded-xl shadow-xl w-full max-w-md p-5">
        <h2 className="text-lg font-semibold mb-4">New Opportunity</h2>
        {error && <div className="mb-3"><ErrorBanner message={error} /></div>}
        <form onSubmit={submit} className="space-y-3">
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Name *</label>
            <input
              required
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="w-full px-3 py-2 text-sm border border-gray-200 dark:border-gray-700 rounded-lg"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Client</label>
            <select
              value={clientId}
              onChange={(e) => setClientId(e.target.value)}
              className="w-full px-3 py-2 text-sm border border-gray-200 dark:border-gray-700 rounded-lg"
            >
              <option value="">— None —</option>
              {clients.map((c) => (
                <option key={c.id} value={c.id}>{c.company}</option>
              ))}
            </select>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Amount</label>
              <input
                type="number"
                min={0}
                step="0.01"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                className="w-full px-3 py-2 text-sm border border-gray-200 dark:border-gray-700 rounded-lg"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Close date *</label>
              <input
                required
                type="date"
                value={closeDate}
                onChange={(e) => setCloseDate(e.target.value)}
                className="w-full px-3 py-2 text-sm border border-gray-200 dark:border-gray-700 rounded-lg"
              />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Stage *</label>
              <select
                required
                value={stageId}
                onChange={(e) => setStageId(e.target.value)}
                className="w-full px-3 py-2 text-sm border border-gray-200 dark:border-gray-700 rounded-lg"
              >
                {stages.map((s) => (
                  <option key={s.id} value={s.id}>{s.name}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Owner *</label>
              <select
                required
                value={ownerId}
                onChange={(e) => setOwnerId(e.target.value)}
                className="w-full px-3 py-2 text-sm border border-gray-200 dark:border-gray-700 rounded-lg"
              >
                {users.map((u) => (
                  <option key={u.id} value={u.id}>{u.firstName} {u.lastName}</option>
                ))}
              </select>
            </div>
          </div>
          <div className="flex items-center justify-end gap-2 pt-2">
            <Button type="button" variant="outline" onClick={onClose} disabled={submitting}>Cancel</Button>
            <Button type="submit" disabled={submitting || !name || !stageId || !ownerId}>
              {submitting ? 'Creating…' : 'Create'}
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ─── Page ───────────────────────────────────────────────────────

export default function OpportunitiesPage() {
  const [columns, setColumns] = useState<KanbanColumn[]>([]);
  const [stages, setStages] = useState<Stage[]>([]);
  const [clients, setClients] = useState<ClientLite[]>([]);
  const [users, setUsers] = useState<UserLite[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [modalOpen, setModalOpen] = useState(false);

  async function loadAll() {
    setLoading(true);
    setError(null);
    try {
      const [kanbanRes, stagesRes, clientsRes, usersRes] = await Promise.all([
        apiFetch('/api/v1/opportunities/kanban'),
        apiFetch('/api/v1/pipelines/stages'),
        apiFetch('/api/v1/clients?limit=200'),
        apiFetch('/api/v1/users?limit=200'),
      ]);
      if (!kanbanRes.ok) throw new Error(`Kanban load failed: ${kanbanRes.status}`);
      const kanban = (await kanbanRes.json()) as KanbanColumn[];
      setColumns(kanban);

      if (stagesRes.ok) {
        const s = await stagesRes.json();
        setStages(Array.isArray(s) ? s : []);
      }
      if (clientsRes.ok) {
        const c = await clientsRes.json();
        setClients(Array.isArray(c?.data) ? c.data : []);
      }
      if (usersRes.ok) {
        const u = await usersRes.json();
        setUsers(Array.isArray(u?.data) ? u.data : []);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadAll();
  }, []);

  // Compute neighbour stages so the Prev/Next buttons know what to send.
  const stagesById = new Map(stages.map((s) => [s.id, s] as const));
  const orderedIds = [...stages].sort((a, b) => a.order - b.order).map((s) => s.id);

  function neighbour(stageId: string, delta: -1 | 1): string | null {
    const idx = orderedIds.indexOf(stageId);
    if (idx < 0) return null;
    const nextIdx = idx + delta;
    if (nextIdx < 0 || nextIdx >= orderedIds.length) return null;
    return orderedIds[nextIdx];
  }

  async function moveStage(oppId: string, newStageId: string) {
    // Optimistic move
    setColumns((prev) => {
      let moved: Opportunity | null = null;
      const stripped = prev.map((col) => {
        const idx = col.opportunities.findIndex((o) => o.id === oppId);
        if (idx >= 0) {
          moved = col.opportunities[idx];
          return { ...col, opportunities: col.opportunities.filter((_, i) => i !== idx) };
        }
        return col;
      });
      if (!moved) return prev;
      return stripped.map((col) =>
        col.stage.id === newStageId
          ? { ...col, opportunities: [{ ...moved!, stageId: newStageId }, ...col.opportunities] }
          : col,
      );
    });

    const res = await apiFetch(`/api/v1/opportunities/${oppId}/move-stage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ stageId: newStageId }),
    });
    if (!res.ok) {
      // Roll back by re-fetching.
      loadAll();
    }
  }

  const totalDeals = columns.reduce((acc, c) => acc + c.opportunities.length, 0);

  return (
    <ListPageLayout
      title="Opportunities"
      subtitle={!loading ? `${totalDeals} deal${totalDeals === 1 ? '' : 's'} in pipeline` : undefined}
      primaryAction={{
        label: 'New Opportunity',
        onClick: () => setModalOpen(true),
        icon: <span className="text-lg leading-none">+</span>,
      }}
      fullHeight
    >
      {error && (
        <div className="mb-4 flex-shrink-0">
          <ErrorBanner message={error} />
        </div>
      )}

      <div className="flex-1 overflow-x-auto pb-4">
        <div className="flex gap-3 h-full min-w-max">
          {loading ? (
            Array.from({ length: 5 }).map((_, i) => (
              <div key={i} className="flex flex-col min-w-[260px] w-[260px] flex-shrink-0">
                <div className="bg-white dark:bg-gray-900 rounded-xl border border-gray-100 dark:border-gray-800 border-t-4 border-t-gray-200 shadow-sm mb-2 px-3 py-2.5 animate-pulse">
                  <div className="h-3.5 bg-gray-100 dark:bg-gray-800 rounded w-1/2" />
                </div>
              </div>
            ))
          ) : (
            columns.map((col) => {
              const colTotal = col.opportunities.reduce(
                (acc, o) => acc + toNum(o.amount),
                0,
              );
              const wonClass = col.stage.isWon
                ? 'border-t-green-500'
                : col.stage.isLost
                ? 'border-t-red-500'
                : 'border-t-blue-400';
              return (
                <div
                  key={col.stage.id}
                  className="flex flex-col min-w-[260px] w-[260px] flex-shrink-0"
                >
                  <div
                    className={[
                      'bg-white dark:bg-gray-900 rounded-xl border border-gray-100 dark:border-gray-800 border-t-4 shadow-sm mb-2',
                      wonClass,
                    ].join(' ')}
                  >
                    <div className="px-3 py-2.5">
                      <div className="flex items-center justify-between">
                        <span className="text-sm font-semibold text-gray-700 dark:text-gray-300">
                          {col.stage.name}
                        </span>
                        <span className="text-xs text-gray-400 dark:text-gray-500 bg-gray-100 dark:bg-gray-800 rounded-full px-2 py-0.5 font-medium">
                          {col.opportunities.length}
                        </span>
                      </div>
                      <div className="flex items-center justify-between mt-1 text-[11px] text-gray-500 dark:text-gray-400">
                        <span>{toNum(col.stage.probability)}%</span>
                        <span className="font-medium text-gray-700 dark:text-gray-300">
                          {formatMoney(colTotal, 'USD')}
                        </span>
                      </div>
                    </div>
                  </div>

                  <div className="flex flex-col gap-2 flex-1 min-h-[120px] rounded-xl p-1.5">
                    {col.opportunities.length === 0 && (
                      <div className="flex items-center justify-center h-20 text-xs text-gray-300 dark:text-gray-600 border-2 border-dashed border-gray-100 dark:border-gray-800 rounded-lg">
                        No deals
                      </div>
                    )}
                    {col.opportunities.map((opp) => {
                      const prevId = neighbour(opp.stageId, -1);
                      const nextId = neighbour(opp.stageId, 1);
                      return (
                        <div
                          key={opp.id}
                          className="bg-white dark:bg-gray-900 border border-gray-100 dark:border-gray-800 rounded-lg p-3 shadow-sm hover:border-gray-200 transition-colors"
                        >
                          <div className="flex items-start justify-between gap-2 mb-1">
                            <Link
                              href={`/opportunities/${opp.id}`}
                              className="text-sm font-medium text-gray-900 dark:text-gray-100 hover:text-primary leading-snug line-clamp-2 flex-1"
                            >
                              {opp.name}
                            </Link>
                          </div>
                          {opp.client && (
                            <p className="text-xs text-gray-500 dark:text-gray-400 truncate">
                              {opp.client.company}
                            </p>
                          )}
                          {!opp.client && opp.lead && (
                            <p className="text-xs text-gray-500 dark:text-gray-400 truncate">
                              Lead: {opp.lead.name}
                            </p>
                          )}
                          <div className="flex items-center justify-between mt-2">
                            <span className="text-xs font-semibold text-gray-700 dark:text-gray-300">
                              {formatMoney(opp.amount, opp.currency)}
                            </span>
                            <span className="text-[11px] text-gray-400 dark:text-gray-500">
                              {ownerName(opp.owner)}
                            </span>
                          </div>
                          <div className="flex items-center gap-1 mt-2">
                            <button
                              disabled={!prevId}
                              onClick={() => prevId && moveStage(opp.id, prevId)}
                              className="flex-1 text-[11px] px-2 py-1 rounded border border-gray-200 dark:border-gray-700 text-gray-600 hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed"
                              title="Move to previous stage"
                            >
                              ← Prev
                            </button>
                            <button
                              disabled={!nextId}
                              onClick={() => nextId && moveStage(opp.id, nextId)}
                              className="flex-1 text-[11px] px-2 py-1 rounded border border-gray-200 dark:border-gray-700 text-gray-600 hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed"
                              title="Move to next stage"
                            >
                              Next →
                            </button>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              );
            })
          )}
        </div>
      </div>

      <NewOpportunityModal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        onCreated={loadAll}
        stages={stages}
        clients={clients}
        users={users}
      />
    </ListPageLayout>
  );
}
