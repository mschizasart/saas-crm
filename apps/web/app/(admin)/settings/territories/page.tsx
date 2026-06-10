'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { ErrorBanner } from '@/components/ui/error-banner';
import { apiFetch } from '@/lib/api';

// ─── Territories list page (Wave G2) ───────────────────────────
//
// Lists every territory in the tenant with the parent chain shown
// inline (e.g. "Americas > North America > USA > Northeast"). The
// "+ New Territory" modal lets admins create a territory, optionally
// nested under a parent. Detail/edit lives at /settings/territories/[id].

interface Territory {
  id: string;
  name: string;
  description: string | null;
  parentTerritoryId: string | null;
  managerId: string | null;
  _count?: { members: number; assignments: number; children: number };
}

interface TerritoryListResponse {
  data: Territory[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

interface User {
  id: string;
  firstName: string;
  lastName: string;
  email: string;
}

export default function TerritoriesPage() {
  const [territories, setTerritories] = useState<Territory[]>([]);
  const [users, setUsers] = useState<User[]>([]);
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [showCreate, setShowCreate] = useState(false);

  // Build a fast id -> territory map for parent-chain rendering.
  const byId = useMemo(() => {
    const m = new Map<string, Territory>();
    for (const t of territories) m.set(t.id, t);
    return m;
  }, [territories]);

  function parentChain(t: Territory): string {
    const names: string[] = [];
    let cur: Territory | undefined = t;
    let guard = 0;
    while (cur && guard++ < 20) {
      names.unshift(cur.name);
      if (!cur.parentTerritoryId) break;
      cur = byId.get(cur.parentTerritoryId);
    }
    return names.join(' > ');
  }

  async function load() {
    setLoading(true);
    setError(null);
    try {
      // limit=100 — territories rarely number in the thousands; one
      // page is plenty for the picker + chain rendering.
      const qs = new URLSearchParams({ limit: '100' });
      if (search) qs.set('search', search);
      const [tRes, uRes] = await Promise.all([
        apiFetch(`/api/v1/territories?${qs.toString()}`),
        apiFetch('/api/v1/users?limit=200'),
      ]);
      if (!tRes.ok) throw new Error(`Load failed: ${tRes.status}`);
      const body = (await tRes.json()) as TerritoryListResponse;
      setTerritories(body.data ?? []);
      if (uRes.ok) {
        const u = await uRes.json();
        setUsers(Array.isArray(u) ? u : (u.data ?? []));
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="max-w-5xl mx-auto p-6 space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold">Territories</h1>
          <p className="text-sm text-gray-500 mt-1">
            Partition your book of business by region, industry, or product
            line. Assign users and route Clients, Leads, and Opportunities
            to specific territories.
          </p>
        </div>
        <Button onClick={() => setShowCreate(true)}>+ New Territory</Button>
      </div>

      {error && <ErrorBanner message={error} />}

      <div className="flex items-center gap-2">
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') load();
          }}
          placeholder="Search territories..."
          className="flex-1 px-3 py-2 text-sm border border-gray-200 dark:border-gray-700 rounded-lg"
        />
        <Button variant="outline" onClick={load}>
          Search
        </Button>
      </div>

      <Card className="p-0 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead>
              <tr className="text-left text-xs font-semibold text-gray-500 uppercase tracking-wide border-b border-gray-100 dark:border-gray-800 bg-gray-50 dark:bg-gray-900">
                <th className="px-3 py-2">Territory</th>
                <th className="px-3 py-2 w-32">Children</th>
                <th className="px-3 py-2 w-32">Members</th>
                <th className="px-3 py-2 w-36">Assignments</th>
                <th className="px-3 py-2 text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan={5} className="px-4 py-8 text-center text-gray-400">
                    Loading…
                  </td>
                </tr>
              ) : territories.length === 0 ? (
                <tr>
                  <td colSpan={5} className="px-4 py-8 text-center text-gray-400">
                    No territories yet — click "+ New Territory" to add one.
                  </td>
                </tr>
              ) : (
                territories.map((t) => (
                  <tr
                    key={t.id}
                    className="border-b border-gray-100 dark:border-gray-800 last:border-0 hover:bg-gray-50 dark:hover:bg-gray-900/50"
                  >
                    <td className="px-3 py-2">
                      <Link
                        href={`/settings/territories/${t.id}`}
                        className="font-medium text-primary hover:underline"
                      >
                        {parentChain(t)}
                      </Link>
                      {t.description && (
                        <p className="text-xs text-gray-500 mt-0.5">
                          {t.description}
                        </p>
                      )}
                    </td>
                    <td className="px-3 py-2 text-gray-600 dark:text-gray-400">
                      {t._count?.children ?? 0}
                    </td>
                    <td className="px-3 py-2 text-gray-600 dark:text-gray-400">
                      {t._count?.members ?? 0}
                    </td>
                    <td className="px-3 py-2 text-gray-600 dark:text-gray-400">
                      {t._count?.assignments ?? 0}
                    </td>
                    <td className="px-3 py-2 text-right">
                      <Link
                        href={`/settings/territories/${t.id}`}
                        className="text-xs text-primary hover:underline"
                      >
                        Open
                      </Link>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </Card>

      {showCreate && (
        <CreateTerritoryModal
          territories={territories}
          users={users}
          onClose={() => setShowCreate(false)}
          onCreated={async () => {
            setShowCreate(false);
            await load();
          }}
        />
      )}
    </div>
  );
}

function CreateTerritoryModal({
  territories,
  users,
  onClose,
  onCreated,
}: {
  territories: Territory[];
  users: User[];
  onClose: () => void;
  onCreated: () => void | Promise<void>;
}) {
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [parentTerritoryId, setParentTerritoryId] = useState('');
  const [managerId, setManagerId] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      const body: Record<string, unknown> = { name };
      if (description.trim()) body.description = description.trim();
      if (parentTerritoryId) body.parentTerritoryId = parentTerritoryId;
      if (managerId) body.managerId = managerId;
      const res = await apiFetch('/api/v1/territories', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        let msg = `Create failed: ${res.status}`;
        try {
          const j = await res.json();
          msg = j?.message ?? msg;
        } catch {
          /* ignore */
        }
        throw new Error(msg);
      }
      await onCreated();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Create failed');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div
      className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4"
      onClick={onClose}
    >
      <div
        className="bg-white dark:bg-gray-900 rounded-lg shadow-xl w-full max-w-md"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="px-5 py-3 border-b border-gray-100 dark:border-gray-800 flex items-center justify-between">
          <h2 className="text-base font-semibold">New Territory</h2>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-gray-600 text-xl leading-none"
            aria-label="Close"
          >
            ×
          </button>
        </div>
        <form onSubmit={submit} className="p-5 space-y-3">
          {error && <ErrorBanner message={error} />}

          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">
              Name *
            </label>
            <input
              required
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="w-full px-3 py-2 text-sm border border-gray-200 dark:border-gray-700 rounded-lg"
            />
          </div>

          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">
              Description
            </label>
            <textarea
              rows={2}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              className="w-full px-3 py-2 text-sm border border-gray-200 dark:border-gray-700 rounded-lg"
            />
          </div>

          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">
              Parent Territory (optional)
            </label>
            <select
              value={parentTerritoryId}
              onChange={(e) => setParentTerritoryId(e.target.value)}
              className="w-full px-3 py-2 text-sm border border-gray-200 dark:border-gray-700 rounded-lg bg-white dark:bg-gray-900"
            >
              <option value="">— None (root) —</option>
              {territories.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">
              Manager (optional)
            </label>
            <select
              value={managerId}
              onChange={(e) => setManagerId(e.target.value)}
              className="w-full px-3 py-2 text-sm border border-gray-200 dark:border-gray-700 rounded-lg bg-white dark:bg-gray-900"
            >
              <option value="">— None —</option>
              {users.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.firstName} {u.lastName} ({u.email})
                </option>
              ))}
            </select>
          </div>

          <div className="flex justify-end gap-2 pt-2">
            <Button type="button" variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" disabled={saving || !name.trim()}>
              {saving ? 'Creating…' : 'Create'}
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}
