'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { ErrorBanner } from '@/components/ui/error-banner';
import { apiFetch } from '@/lib/api';

// ─── Territory detail page (Wave G2) ───────────────────────────
//
// Tabs / sections:
//   1. Info card        — name + description + parent + manager.
//                          Edit-in-place, save button at the bottom.
//   2. Ancestors strip  — parent chain (root > ... > parent).
//   3. Children list    — territories whose parentTerritoryId == this.
//   4. Members table    — add / change role / remove. Picks from org
//                          users.
//   5. Assignments table — filter by entityType. Add via picker that
//                          calls the appropriate entity list endpoint.

interface Territory {
  id: string;
  name: string;
  description: string | null;
  parentTerritoryId: string | null;
  managerId: string | null;
  members: TerritoryMember[];
  _count?: { assignments: number; children: number };
}

interface TerritoryMember {
  id: string;
  territoryId: string;
  userId: string;
  role: 'member' | 'manager';
  user?: {
    id: string;
    firstName: string;
    lastName: string;
    email: string;
  } | null;
}

interface TerritoryAssignment {
  id: string;
  territoryId: string;
  entityType: 'client' | 'lead' | 'opportunity';
  entityId: string;
  createdAt: string;
  entity?:
    | { id: string; company: string }
    | { id: string; name: string; company: string | null }
    | { id: string; name: string; amount: number; currency: string }
    | null;
}

interface User {
  id: string;
  firstName: string;
  lastName: string;
  email: string;
}

interface HierarchyNode {
  id: string;
  name: string;
  parentTerritoryId: string | null;
  depth: number;
}

type EntityType = 'client' | 'lead' | 'opportunity';

export default function TerritoryDetailPage() {
  const params = useParams<{ id: string }>();
  const id = params?.id as string;
  const router = useRouter();

  const [territory, setTerritory] = useState<Territory | null>(null);
  const [ancestors, setAncestors] = useState<HierarchyNode[]>([]);
  const [children, setChildren] = useState<HierarchyNode[]>([]);
  const [users, setUsers] = useState<User[]>([]);
  const [allTerritories, setAllTerritories] = useState<
    { id: string; name: string }[]
  >([]);

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Editable fields
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [parentTerritoryId, setParentTerritoryId] = useState('');
  const [managerId, setManagerId] = useState('');
  const [saving, setSaving] = useState(false);

  // Members panel state
  const [newMemberId, setNewMemberId] = useState('');
  const [newMemberRole, setNewMemberRole] = useState<'member' | 'manager'>(
    'member',
  );

  // Assignments panel state
  const [assignments, setAssignments] = useState<TerritoryAssignment[]>([]);
  const [assignmentFilter, setAssignmentFilter] = useState<EntityType | ''>('');
  const [newAssignEntityType, setNewAssignEntityType] =
    useState<EntityType>('client');
  const [newAssignEntityId, setNewAssignEntityId] = useState('');

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const [tRes, aRes, hRes, uRes, allRes] = await Promise.all([
        apiFetch(`/api/v1/territories/${id}`),
        apiFetch(`/api/v1/territories/${id}/ancestors`),
        apiFetch(`/api/v1/territories/hierarchy?rootId=${id}`),
        apiFetch('/api/v1/users?limit=200'),
        apiFetch('/api/v1/territories?limit=100'),
      ]);
      if (!tRes.ok) throw new Error(`Load failed: ${tRes.status}`);
      const t = (await tRes.json()) as Territory;
      setTerritory(t);
      setName(t.name);
      setDescription(t.description ?? '');
      setParentTerritoryId(t.parentTerritoryId ?? '');
      setManagerId(t.managerId ?? '');
      if (aRes.ok) setAncestors(await aRes.json());
      if (hRes.ok) {
        const all = (await hRes.json()) as HierarchyNode[];
        // depth 1 == direct children
        setChildren(all.filter((n) => n.depth === 1));
      }
      if (uRes.ok) {
        const u = await uRes.json();
        setUsers(Array.isArray(u) ? u : (u.data ?? []));
      }
      if (allRes.ok) {
        const a = await allRes.json();
        setAllTerritories(a.data ?? []);
      }
      await loadAssignments(assignmentFilter);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load');
    } finally {
      setLoading(false);
    }
  }

  async function loadAssignments(filter: EntityType | '') {
    try {
      const qs = new URLSearchParams({ limit: '100' });
      if (filter) qs.set('entityType', filter);
      const r = await apiFetch(
        `/api/v1/territories/${id}/assignments?${qs.toString()}`,
      );
      if (r.ok) {
        const body = await r.json();
        setAssignments(body.data ?? []);
      }
    } catch {
      /* ignore */
    }
  }

  useEffect(() => {
    if (id) load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  useEffect(() => {
    loadAssignments(assignmentFilter);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [assignmentFilter]);

  // Candidate parents: any territory except self (cycle prevention is
  // server-side, this just trims the picker so the obvious self-parent
  // case doesn't even appear).
  const parentCandidates = useMemo(
    () => allTerritories.filter((t) => t.id !== id),
    [allTerritories, id],
  );

  async function saveInfo() {
    setSaving(true);
    setError(null);
    try {
      const body: Record<string, unknown> = {};
      body.name = name;
      body.description = description || null;
      body.parentTerritoryId = parentTerritoryId || null;
      body.managerId = managerId || null;
      const res = await apiFetch(`/api/v1/territories/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        let msg = `Save failed: ${res.status}`;
        try {
          const j = await res.json();
          msg = j?.message ?? msg;
        } catch {
          /* ignore */
        }
        throw new Error(msg);
      }
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Save failed');
    } finally {
      setSaving(false);
    }
  }

  async function deleteTerritory() {
    if (
      !confirm(
        'Delete this territory? Children and assignments must be removed first.',
      )
    )
      return;
    setError(null);
    const res = await apiFetch(`/api/v1/territories/${id}`, {
      method: 'DELETE',
    });
    if (!res.ok && res.status !== 204) {
      try {
        const j = await res.json();
        setError(j?.message ?? `Delete failed: ${res.status}`);
      } catch {
        setError(`Delete failed: ${res.status}`);
      }
      return;
    }
    router.push('/settings/territories');
  }

  async function addMember() {
    if (!newMemberId) return;
    setError(null);
    const res = await apiFetch(`/api/v1/territories/${id}/members`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId: newMemberId, role: newMemberRole }),
    });
    if (!res.ok) {
      try {
        const j = await res.json();
        setError(j?.message ?? `Add member failed: ${res.status}`);
      } catch {
        setError(`Add member failed: ${res.status}`);
      }
      return;
    }
    setNewMemberId('');
    setNewMemberRole('member');
    await load();
  }

  async function changeMemberRole(
    userId: string,
    role: 'member' | 'manager',
  ) {
    setError(null);
    const res = await apiFetch(
      `/api/v1/territories/${id}/members/${userId}`,
      {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ role }),
      },
    );
    if (!res.ok) {
      setError(`Role update failed: ${res.status}`);
      return;
    }
    await load();
  }

  async function removeMember(userId: string) {
    if (!confirm('Remove this member?')) return;
    setError(null);
    const res = await apiFetch(
      `/api/v1/territories/${id}/members/${userId}`,
      { method: 'DELETE' },
    );
    if (!res.ok && res.status !== 204) {
      setError(`Remove failed: ${res.status}`);
      return;
    }
    await load();
  }

  async function addAssignment() {
    if (!newAssignEntityId) return;
    setError(null);
    const res = await apiFetch(`/api/v1/territories/${id}/assignments`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        entityType: newAssignEntityType,
        entityId: newAssignEntityId.trim(),
      }),
    });
    if (!res.ok) {
      try {
        const j = await res.json();
        setError(j?.message ?? `Assign failed: ${res.status}`);
      } catch {
        setError(`Assign failed: ${res.status}`);
      }
      return;
    }
    setNewAssignEntityId('');
    await loadAssignments(assignmentFilter);
  }

  async function removeAssignment(assignmentId: string) {
    if (!confirm('Unassign this entity from the territory?')) return;
    setError(null);
    const res = await apiFetch(
      `/api/v1/territories/${id}/assignments/${assignmentId}`,
      { method: 'DELETE' },
    );
    if (!res.ok && res.status !== 204) {
      setError(`Unassign failed: ${res.status}`);
      return;
    }
    await loadAssignments(assignmentFilter);
  }

  if (loading && !territory) {
    return (
      <div className="max-w-5xl mx-auto p-6">
        <p className="text-sm text-gray-400">Loading…</p>
      </div>
    );
  }
  if (!territory) {
    return (
      <div className="max-w-5xl mx-auto p-6">
        {error && <ErrorBanner message={error} />}
      </div>
    );
  }

  return (
    <div className="max-w-5xl mx-auto p-6 space-y-6">
      <div>
        <Link
          href="/settings/territories"
          className="text-xs text-gray-500 hover:text-primary"
        >
          ← All territories
        </Link>
      </div>

      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold">{territory.name}</h1>
          {ancestors.length > 0 && (
            <p className="text-xs text-gray-500 mt-1">
              {ancestors.map((a) => a.name).join(' > ')} {' > '}
              <span className="font-medium">{territory.name}</span>
            </p>
          )}
        </div>
        <Button variant="outline" onClick={deleteTerritory}>
          Delete
        </Button>
      </div>

      {error && <ErrorBanner message={error} />}

      {/* ─── Info card ───────────────────────────────────────── */}
      <Card className="p-5 space-y-3">
        <h2 className="text-sm font-semibold">Info</h2>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">
              Name
            </label>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="w-full px-3 py-2 text-sm border border-gray-200 dark:border-gray-700 rounded-lg"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">
              Parent Territory
            </label>
            <select
              value={parentTerritoryId}
              onChange={(e) => setParentTerritoryId(e.target.value)}
              className="w-full px-3 py-2 text-sm border border-gray-200 dark:border-gray-700 rounded-lg bg-white dark:bg-gray-900"
            >
              <option value="">— None (root) —</option>
              {parentCandidates.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
            </select>
          </div>
          <div className="md:col-span-2">
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
              Manager
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
        </div>
        <div className="flex justify-end">
          <Button onClick={saveInfo} disabled={saving || !name.trim()}>
            {saving ? 'Saving…' : 'Save'}
          </Button>
        </div>
      </Card>

      {/* ─── Children list ───────────────────────────────────── */}
      <Card className="p-5">
        <h2 className="text-sm font-semibold mb-3">
          Child territories ({children.length})
        </h2>
        {children.length === 0 ? (
          <p className="text-xs text-gray-400">No child territories.</p>
        ) : (
          <ul className="space-y-1">
            {children.map((c) => (
              <li key={c.id}>
                <Link
                  href={`/settings/territories/${c.id}`}
                  className="text-sm text-primary hover:underline"
                >
                  {c.name}
                </Link>
              </li>
            ))}
          </ul>
        )}
      </Card>

      {/* ─── Members ────────────────────────────────────────── */}
      <Card className="p-5">
        <h2 className="text-sm font-semibold mb-3">
          Members ({territory.members.length})
        </h2>

        <div className="grid grid-cols-1 md:grid-cols-6 gap-2 items-end mb-4">
          <div className="md:col-span-3">
            <label className="block text-xs font-medium text-gray-600 mb-1">
              Add user
            </label>
            <select
              value={newMemberId}
              onChange={(e) => setNewMemberId(e.target.value)}
              className="w-full px-3 py-2 text-sm border border-gray-200 dark:border-gray-700 rounded-lg bg-white dark:bg-gray-900"
            >
              <option value="">— Select user —</option>
              {users.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.firstName} {u.lastName} ({u.email})
                </option>
              ))}
            </select>
          </div>
          <div className="md:col-span-2">
            <label className="block text-xs font-medium text-gray-600 mb-1">
              Role
            </label>
            <select
              value={newMemberRole}
              onChange={(e) =>
                setNewMemberRole(e.target.value as 'member' | 'manager')
              }
              className="w-full px-3 py-2 text-sm border border-gray-200 dark:border-gray-700 rounded-lg bg-white dark:bg-gray-900"
            >
              <option value="member">Member</option>
              <option value="manager">Manager</option>
            </select>
          </div>
          <div>
            <Button onClick={addMember} disabled={!newMemberId}>
              Add
            </Button>
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead>
              <tr className="text-left text-xs font-semibold text-gray-500 uppercase tracking-wide border-b border-gray-100 dark:border-gray-800 bg-gray-50 dark:bg-gray-900">
                <th className="px-3 py-2">User</th>
                <th className="px-3 py-2 w-32">Role</th>
                <th className="px-3 py-2 text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {territory.members.length === 0 ? (
                <tr>
                  <td colSpan={3} className="px-3 py-6 text-center text-gray-400">
                    No members yet.
                  </td>
                </tr>
              ) : (
                territory.members.map((m) => (
                  <tr
                    key={m.id}
                    className="border-b border-gray-100 dark:border-gray-800 last:border-0"
                  >
                    <td className="px-3 py-2">
                      {m.user ? (
                        <>
                          {m.user.firstName} {m.user.lastName}
                          <span className="text-xs text-gray-400 ml-1">
                            ({m.user.email})
                          </span>
                        </>
                      ) : (
                        <span className="text-gray-400">[deleted]</span>
                      )}
                    </td>
                    <td className="px-3 py-2">
                      <select
                        value={m.role}
                        onChange={(e) =>
                          changeMemberRole(
                            m.userId,
                            e.target.value as 'member' | 'manager',
                          )
                        }
                        className="px-2 py-1 text-xs border border-gray-200 dark:border-gray-700 rounded bg-white dark:bg-gray-900"
                      >
                        <option value="member">Member</option>
                        <option value="manager">Manager</option>
                      </select>
                    </td>
                    <td className="px-3 py-2 text-right">
                      <button
                        onClick={() => removeMember(m.userId)}
                        className="text-xs text-red-600 hover:underline"
                      >
                        Remove
                      </button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </Card>

      {/* ─── Assignments ────────────────────────────────────── */}
      <Card className="p-5">
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-sm font-semibold">
            Assignments ({assignments.length})
          </h2>
          <select
            value={assignmentFilter}
            onChange={(e) =>
              setAssignmentFilter(e.target.value as EntityType | '')
            }
            className="px-2 py-1 text-xs border border-gray-200 dark:border-gray-700 rounded bg-white dark:bg-gray-900"
          >
            <option value="">All types</option>
            <option value="client">Clients</option>
            <option value="lead">Leads</option>
            <option value="opportunity">Opportunities</option>
          </select>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-6 gap-2 items-end mb-4">
          <div className="md:col-span-2">
            <label className="block text-xs font-medium text-gray-600 mb-1">
              Entity type
            </label>
            <select
              value={newAssignEntityType}
              onChange={(e) =>
                setNewAssignEntityType(e.target.value as EntityType)
              }
              className="w-full px-3 py-2 text-sm border border-gray-200 dark:border-gray-700 rounded-lg bg-white dark:bg-gray-900"
            >
              <option value="client">Client</option>
              <option value="lead">Lead</option>
              <option value="opportunity">Opportunity</option>
            </select>
          </div>
          <div className="md:col-span-3">
            <label className="block text-xs font-medium text-gray-600 mb-1">
              Entity ID
            </label>
            <input
              value={newAssignEntityId}
              onChange={(e) => setNewAssignEntityId(e.target.value)}
              placeholder="Paste the entity UUID"
              className="w-full px-3 py-2 text-sm border border-gray-200 dark:border-gray-700 rounded-lg font-mono"
            />
          </div>
          <div>
            <Button onClick={addAssignment} disabled={!newAssignEntityId.trim()}>
              Assign
            </Button>
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead>
              <tr className="text-left text-xs font-semibold text-gray-500 uppercase tracking-wide border-b border-gray-100 dark:border-gray-800 bg-gray-50 dark:bg-gray-900">
                <th className="px-3 py-2 w-32">Type</th>
                <th className="px-3 py-2">Entity</th>
                <th className="px-3 py-2 text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {assignments.length === 0 ? (
                <tr>
                  <td colSpan={3} className="px-3 py-6 text-center text-gray-400">
                    No assignments.
                  </td>
                </tr>
              ) : (
                assignments.map((a) => (
                  <tr
                    key={a.id}
                    className="border-b border-gray-100 dark:border-gray-800 last:border-0"
                  >
                    <td className="px-3 py-2 capitalize">{a.entityType}</td>
                    <td className="px-3 py-2">
                      <AssignmentEntityLabel a={a} />
                    </td>
                    <td className="px-3 py-2 text-right">
                      <button
                        onClick={() => removeAssignment(a.id)}
                        className="text-xs text-red-600 hover:underline"
                      >
                        Unassign
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

function AssignmentEntityLabel({ a }: { a: TerritoryAssignment }) {
  const e = a.entity as any;
  if (!e) {
    return (
      <span className="font-mono text-xs text-gray-400">
        {a.entityId} <span className="italic">(not found)</span>
      </span>
    );
  }
  if (a.entityType === 'client') {
    return (
      <Link
        href={`/clients/${e.id}`}
        className="text-primary hover:underline"
      >
        {e.company ?? e.id}
      </Link>
    );
  }
  if (a.entityType === 'lead') {
    return (
      <Link href={`/leads/${e.id}`} className="text-primary hover:underline">
        {e.name ?? e.id}
        {e.company && (
          <span className="text-xs text-gray-400 ml-1">— {e.company}</span>
        )}
      </Link>
    );
  }
  if (a.entityType === 'opportunity') {
    return (
      <Link
        href={`/opportunities/${e.id}`}
        className="text-primary hover:underline"
      >
        {e.name ?? e.id}
        {e.amount != null && (
          <span className="text-xs text-gray-400 ml-1">
            ({e.currency} {Number(e.amount).toLocaleString()})
          </span>
        )}
      </Link>
    );
  }
  return <span>{a.entityId}</span>;
}
