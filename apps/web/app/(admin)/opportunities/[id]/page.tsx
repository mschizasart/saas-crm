'use client';

import { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { ErrorBanner } from '@/components/ui/error-banner';
import { apiFetch } from '@/lib/api';

interface Stage {
  id: string;
  name: string;
  probability: number | string;
  isWon: boolean;
  isLost: boolean;
  order: number;
}

interface StageHistoryRow {
  id: string;
  fromStageId: string | null;
  toStageId: string;
  changedAt: string;
  changedBy?: { id: string; firstName: string; lastName: string } | null;
}

interface Opportunity {
  id: string;
  name: string;
  amount: number | string;
  currency: string;
  closeDate: string;
  description: string | null;
  source: string | null;
  stageId: string;
  ownerId: string;
  clientId: string | null;
  leadId: string | null;
  stage: Stage;
  owner?: { id: string; firstName: string; lastName: string; email: string } | null;
  client?: { id: string; company: string } | null;
  lead?: { id: string; name: string } | null;
  stageHistory: StageHistoryRow[];
}

interface ClientLite { id: string; company: string }
interface UserLite { id: string; firstName: string; lastName: string }

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
      maximumFractionDigits: 2,
    }).format(n);
  } catch {
    return `${currency} ${n.toLocaleString()}`;
  }
}

function userName(u: { firstName?: string; lastName?: string } | null | undefined): string {
  if (!u) return '—';
  return `${u.firstName ?? ''} ${u.lastName ?? ''}`.trim() || '—';
}

export default function OpportunityDetailPage() {
  const params = useParams();
  const router = useRouter();
  const id = params?.id as string;

  const [opp, setOpp] = useState<Opportunity | null>(null);
  const [stages, setStages] = useState<Stage[]>([]);
  const [clients, setClients] = useState<ClientLite[]>([]);
  const [users, setUsers] = useState<UserLite[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Edit form state
  const [name, setName] = useState('');
  const [amount, setAmount] = useState('');
  const [currency, setCurrency] = useState('USD');
  const [closeDate, setCloseDate] = useState('');
  const [description, setDescription] = useState('');
  const [source, setSource] = useState('');
  const [ownerId, setOwnerId] = useState('');
  const [clientId, setClientId] = useState('');

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const [oppRes, stagesRes, clientsRes, usersRes] = await Promise.all([
        apiFetch(`/api/v1/opportunities/${id}`),
        apiFetch('/api/v1/pipelines/stages'),
        apiFetch('/api/v1/clients?limit=200'),
        apiFetch('/api/v1/users?limit=200'),
      ]);
      if (!oppRes.ok) throw new Error(`Load failed: ${oppRes.status}`);
      const data = (await oppRes.json()) as Opportunity;
      setOpp(data);
      setName(data.name);
      setAmount(String(toNum(data.amount)));
      setCurrency(data.currency);
      setCloseDate(data.closeDate.slice(0, 10));
      setDescription(data.description ?? '');
      setSource(data.source ?? '');
      setOwnerId(data.ownerId);
      setClientId(data.clientId ?? '');

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
    if (id) load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  async function save() {
    setSaving(true);
    setError(null);
    try {
      const res = await apiFetch(`/api/v1/opportunities/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name,
          amount: amount ? Number(amount) : 0,
          currency,
          closeDate,
          description,
          source,
          ownerId,
          clientId: clientId || null,
        }),
      });
      if (!res.ok) {
        const msg = await res.text();
        throw new Error(msg || `Save failed: ${res.status}`);
      }
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Save failed');
    } finally {
      setSaving(false);
    }
  }

  async function moveStage(newStageId: string) {
    if (!opp || newStageId === opp.stageId) return;
    setSaving(true);
    setError(null);
    try {
      const res = await apiFetch(`/api/v1/opportunities/${id}/move-stage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ stageId: newStageId }),
      });
      if (!res.ok) {
        const msg = await res.text();
        throw new Error(msg || `Stage move failed: ${res.status}`);
      }
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Stage move failed');
    } finally {
      setSaving(false);
    }
  }

  async function remove() {
    if (!confirm('Delete this opportunity? This cannot be undone.')) return;
    setSaving(true);
    setError(null);
    try {
      const res = await apiFetch(`/api/v1/opportunities/${id}`, { method: 'DELETE' });
      if (!res.ok && res.status !== 204) {
        const msg = await res.text();
        throw new Error(msg || `Delete failed: ${res.status}`);
      }
      router.push('/opportunities');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Delete failed');
    } finally {
      setSaving(false);
    }
  }

  const stageById = new Map(stages.map((s) => [s.id, s] as const));

  if (loading) {
    return <div className="p-6 text-sm text-gray-500">Loading…</div>;
  }
  if (!opp) {
    return <div className="p-6"><ErrorBanner message={error ?? 'Opportunity not found'} /></div>;
  }

  return (
    <div className="max-w-5xl mx-auto p-6 space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <Link href="/opportunities" className="text-xs text-gray-500 hover:text-primary">← Back to pipeline</Link>
          <h1 className="text-2xl font-semibold mt-1">{opp.name}</h1>
          <p className="text-sm text-gray-500 mt-1">
            {formatMoney(opp.amount, opp.currency)} · closes {new Date(opp.closeDate).toLocaleDateString()} · {opp.stage.name}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" onClick={remove} disabled={saving}>Delete</Button>
          <Button onClick={save} disabled={saving}>{saving ? 'Saving…' : 'Save changes'}</Button>
        </div>
      </div>

      {error && <ErrorBanner message={error} />}

      <Card className="p-5">
        <h2 className="text-sm font-semibold mb-3">Details</h2>
        <div className="grid md:grid-cols-2 gap-4">
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Name</label>
            <input
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
            <label className="block text-xs font-medium text-gray-600 mb-1">Currency</label>
            <input
              value={currency}
              onChange={(e) => setCurrency(e.target.value.toUpperCase())}
              maxLength={8}
              className="w-full px-3 py-2 text-sm border border-gray-200 dark:border-gray-700 rounded-lg"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Close date</label>
            <input
              type="date"
              value={closeDate}
              onChange={(e) => setCloseDate(e.target.value)}
              className="w-full px-3 py-2 text-sm border border-gray-200 dark:border-gray-700 rounded-lg"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Owner</label>
            <select
              value={ownerId}
              onChange={(e) => setOwnerId(e.target.value)}
              className="w-full px-3 py-2 text-sm border border-gray-200 dark:border-gray-700 rounded-lg"
            >
              {users.map((u) => (
                <option key={u.id} value={u.id}>{u.firstName} {u.lastName}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Source</label>
            <input
              value={source}
              onChange={(e) => setSource(e.target.value)}
              className="w-full px-3 py-2 text-sm border border-gray-200 dark:border-gray-700 rounded-lg"
            />
          </div>
          <div className="md:col-span-2">
            <label className="block text-xs font-medium text-gray-600 mb-1">Description</label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={3}
              className="w-full px-3 py-2 text-sm border border-gray-200 dark:border-gray-700 rounded-lg"
            />
          </div>
        </div>
      </Card>

      <Card className="p-5">
        <h2 className="text-sm font-semibold mb-3">Stage</h2>
        <div className="flex flex-wrap items-center gap-2">
          {stages
            .slice()
            .sort((a, b) => a.order - b.order)
            .map((s) => (
              <button
                key={s.id}
                onClick={() => moveStage(s.id)}
                disabled={saving || s.id === opp.stageId}
                className={[
                  'px-3 py-1.5 text-xs font-medium rounded-full border transition-colors',
                  s.id === opp.stageId
                    ? 'bg-primary text-white border-primary'
                    : 'bg-white text-gray-700 border-gray-200 hover:bg-gray-50 dark:bg-gray-900 dark:text-gray-300 dark:border-gray-700',
                ].join(' ')}
              >
                {s.name} <span className="opacity-60 ml-1">({toNum(s.probability)}%)</span>
              </button>
            ))}
        </div>
      </Card>

      <Card className="p-5">
        <h2 className="text-sm font-semibold mb-3">Stage History</h2>
        {opp.stageHistory.length === 0 ? (
          <p className="text-xs text-gray-400">No transitions yet.</p>
        ) : (
          <ol className="space-y-2">
            {opp.stageHistory.map((row) => {
              const from = row.fromStageId ? stageById.get(row.fromStageId)?.name ?? 'Unknown' : null;
              const to = stageById.get(row.toStageId)?.name ?? 'Unknown';
              return (
                <li
                  key={row.id}
                  className="flex items-center gap-3 text-xs text-gray-600 dark:text-gray-400 border-l-2 border-gray-100 dark:border-gray-800 pl-3"
                >
                  <span className="text-gray-400 dark:text-gray-500 tabular-nums">
                    {new Date(row.changedAt).toLocaleString()}
                  </span>
                  <span>
                    {from ? <><strong>{from}</strong> → <strong>{to}</strong></> : <>Created in <strong>{to}</strong></>}
                  </span>
                  <span className="text-gray-400 dark:text-gray-500">by {userName(row.changedBy)}</span>
                </li>
              );
            })}
          </ol>
        )}
      </Card>
    </div>
  );
}
