'use client';

import { useState, useEffect, useMemo } from 'react';
import Link from 'next/link';
import { SettingsPageLayout, SettingsSection } from '@/components/layouts/settings-page-layout';
import { typography } from '@/lib/ui-tokens';

// ─── Team Hierarchy admin page (Wave G1) ────────────────────────
//
// Tree view of all staff users grouped by manager. Each node shows
// who the user reports to and the "+ Set manager" / "Detach" action.
// The server is the authoritative cycle / depth validator; this
// page only does a client-side hint so the picker doesn't show the
// user themselves or any of their known descendants as eligible
// managers.

const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001';

function getToken(): string | null {
  if (typeof window === 'undefined') return null;
  return localStorage.getItem('access_token');
}

function headers(): HeadersInit {
  return {
    Authorization: `Bearer ${getToken()}`,
    'Content-Type': 'application/json',
  };
}

interface StaffUser {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  jobTitle?: string | null;
  managerId?: string | null;
  active?: boolean;
}

interface ManagerPickerState {
  userId: string;
  search: string;
}

function displayName(u: Pick<StaffUser, 'firstName' | 'lastName' | 'email'>) {
  const name = `${u.firstName ?? ''} ${u.lastName ?? ''}`.trim();
  return name || u.email;
}

export default function TeamHierarchyPage() {
  const [users, setUsers] = useState<StaffUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState<string | null>(null);
  const [picker, setPicker] = useState<ManagerPickerState | null>(null);
  const [busyUserId, setBusyUserId] = useState<string | null>(null);

  async function loadUsers() {
    try {
      // Wave G1 endpoint — returns staff with managerId exposed (the
      // legacy /users endpoint doesn't select managerId today).
      const res = await fetch(`${API_BASE}/api/v1/users/with-managers`, {
        headers: headers(),
      });
      if (!res.ok) throw new Error(`Failed (${res.status})`);
      const data = await res.json();
      const list: StaffUser[] = Array.isArray(data)
        ? data
        : (data.data ?? data.users ?? []);
      setUsers(list);
    } catch (err) {
      setMessage(err instanceof Error ? err.message : 'Failed to load users');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadUsers();
  }, []);

  // Group children by their managerId so we can render the tree.
  // Roots = users with managerId == null/undefined OR whose
  // managerId points outside the loaded set (orphans surface here so
  // an admin can re-parent them rather than silently drop).
  const { roots, childrenByManager, byId } = useMemo(() => {
    const map = new Map<string, StaffUser>(users.map((u) => [u.id, u]));
    const children = new Map<string, StaffUser[]>();
    const rootList: StaffUser[] = [];

    for (const u of users) {
      if (u.managerId && map.has(u.managerId)) {
        const arr = children.get(u.managerId) ?? [];
        arr.push(u);
        children.set(u.managerId, arr);
      } else {
        rootList.push(u);
      }
    }
    // Stable sort: name within siblings.
    const cmp = (a: StaffUser, b: StaffUser) =>
      displayName(a).localeCompare(displayName(b));
    rootList.sort(cmp);
    for (const arr of children.values()) arr.sort(cmp);

    return { roots: rootList, childrenByManager: children, byId: map };
  }, [users]);

  // Collect a user's descendant ids so the manager-picker can hide
  // them client-side (server still validates cycles authoritatively).
  function descendantIds(userId: string): Set<string> {
    const out = new Set<string>();
    const walk = (id: string) => {
      const kids = childrenByManager.get(id) ?? [];
      for (const k of kids) {
        if (out.has(k.id)) continue;
        out.add(k.id);
        walk(k.id);
      }
    };
    walk(userId);
    return out;
  }

  async function setManager(userId: string, managerId: string) {
    setBusyUserId(userId);
    setMessage(null);
    try {
      const res = await fetch(
        `${API_BASE}/api/v1/users/${userId}/set-manager`,
        {
          method: 'POST',
          headers: headers(),
          body: JSON.stringify({ managerId }),
        },
      );
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.message || `Failed (${res.status})`);
      }
      setPicker(null);
      await loadUsers();
      setMessage('Manager updated');
    } catch (err) {
      setMessage(err instanceof Error ? err.message : 'Failed');
    } finally {
      setBusyUserId(null);
    }
  }

  async function unsetManager(userId: string) {
    if (!confirm('Detach this user from their manager?')) return;
    setBusyUserId(userId);
    setMessage(null);
    try {
      const res = await fetch(
        `${API_BASE}/api/v1/users/${userId}/unset-manager`,
        { method: 'POST', headers: headers() },
      );
      if (!res.ok) throw new Error(`Failed (${res.status})`);
      await loadUsers();
      setMessage('Manager removed');
    } catch (err) {
      setMessage(err instanceof Error ? err.message : 'Failed');
    } finally {
      setBusyUserId(null);
    }
  }

  if (loading)
    return (
      <div className="p-6 text-sm text-gray-500 dark:text-gray-400">
        Loading...
      </div>
    );

  return (
    <SettingsPageLayout
      title="Team Hierarchy"
      description="Org chart used by hierarchical record sharing. Salespeople see records owned by the people who report to them."
    >
      <div className="mb-[-0.5rem]">
        <Link
          href="/settings"
          className={`${typography.bodyMuted} hover:text-primary`}
        >
          &larr; Settings
        </Link>
      </div>

      {message && (
        <div className="px-3 py-2 bg-blue-50 border border-blue-100 text-sm text-blue-700 rounded">
          {message}
        </div>
      )}

      <SettingsSection
        title="Reporting tree"
        description="Top-level users have no manager. Click '+ Set manager' on any user to attach them under someone."
      >
        {users.length === 0 ? (
          <div className="p-8 text-center text-sm text-gray-400 dark:text-gray-500">
            No staff users yet.
          </div>
        ) : roots.length === users.length ? (
          // Flat list — nobody has a manager yet.
          <div className="space-y-1">
            {roots.map((u) => (
              <UserRow
                key={u.id}
                user={u}
                depth={0}
                byId={byId}
                childrenByManager={childrenByManager}
                descendantIds={descendantIds}
                onPick={(uid) => setPicker({ userId: uid, search: '' })}
                onUnset={unsetManager}
                busy={busyUserId === u.id}
              />
            ))}
          </div>
        ) : (
          <div className="space-y-1">
            {roots.map((u) => (
              <TreeNode
                key={u.id}
                user={u}
                depth={0}
                byId={byId}
                childrenByManager={childrenByManager}
                descendantIds={descendantIds}
                onPick={(uid) => setPicker({ userId: uid, search: '' })}
                onUnset={unsetManager}
                busyUserId={busyUserId}
              />
            ))}
          </div>
        )}
      </SettingsSection>

      {picker && (
        <ManagerPicker
          state={picker}
          users={users}
          byId={byId}
          descendantIds={descendantIds(picker.userId)}
          onClose={() => setPicker(null)}
          onSelect={(managerId) => setManager(picker.userId, managerId)}
          onSearch={(q) => setPicker({ ...picker, search: q })}
        />
      )}
    </SettingsPageLayout>
  );
}

// ─── Subcomponents ─────────────────────────────────────────────

function TreeNode(props: {
  user: StaffUser;
  depth: number;
  byId: Map<string, StaffUser>;
  childrenByManager: Map<string, StaffUser[]>;
  descendantIds: (id: string) => Set<string>;
  onPick: (userId: string) => void;
  onUnset: (userId: string) => void;
  busyUserId: string | null;
}) {
  const {
    user,
    depth,
    byId,
    childrenByManager,
    descendantIds,
    onPick,
    onUnset,
    busyUserId,
  } = props;
  const children = childrenByManager.get(user.id) ?? [];

  return (
    <div>
      <UserRow
        user={user}
        depth={depth}
        byId={byId}
        childrenByManager={childrenByManager}
        descendantIds={descendantIds}
        onPick={onPick}
        onUnset={onUnset}
        busy={busyUserId === user.id}
      />
      {children.length > 0 && (
        <div className="space-y-1">
          {children.map((c) => (
            <TreeNode
              key={c.id}
              user={c}
              depth={depth + 1}
              byId={byId}
              childrenByManager={childrenByManager}
              descendantIds={descendantIds}
              onPick={onPick}
              onUnset={onUnset}
              busyUserId={busyUserId}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function UserRow(props: {
  user: StaffUser;
  depth: number;
  byId: Map<string, StaffUser>;
  childrenByManager: Map<string, StaffUser[]>;
  descendantIds: (id: string) => Set<string>;
  onPick: (userId: string) => void;
  onUnset: (userId: string) => void;
  busy: boolean;
}) {
  const { user, depth, byId, onPick, onUnset, busy } = props;
  const manager = user.managerId ? byId.get(user.managerId) : null;

  return (
    <div
      className="flex items-center gap-3 px-3 py-2 rounded-lg border border-gray-100 dark:border-gray-800 bg-white dark:bg-gray-900/40"
      style={{ marginLeft: depth * 24 }}
    >
      <div className="w-8 h-8 rounded-full bg-primary/10 text-primary flex items-center justify-center text-xs font-semibold flex-shrink-0">
        {(user.firstName?.[0] ?? user.email[0] ?? '?').toUpperCase()}
      </div>
      <div className="flex-1 min-w-0">
        <div className="text-sm font-medium text-gray-900 dark:text-gray-100 truncate">
          {displayName(user)}
        </div>
        <div className="text-xs text-gray-500 dark:text-gray-400 truncate">
          {user.jobTitle ? `${user.jobTitle} • ` : ''}
          {manager ? `Reports to: ${displayName(manager)}` : 'No manager'}
        </div>
      </div>
      <div className="flex items-center gap-2">
        <button
          onClick={() => onPick(user.id)}
          disabled={busy}
          className="text-xs px-2 py-1 rounded-md border border-gray-200 dark:border-gray-700 text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-800 disabled:opacity-50"
        >
          {manager ? 'Change manager' : '+ Set manager'}
        </button>
        {manager && (
          <button
            onClick={() => onUnset(user.id)}
            disabled={busy}
            className="text-xs px-2 py-1 rounded-md text-red-600 hover:bg-red-50 disabled:opacity-50"
          >
            Detach
          </button>
        )}
      </div>
    </div>
  );
}

function ManagerPicker(props: {
  state: ManagerPickerState;
  users: StaffUser[];
  byId: Map<string, StaffUser>;
  descendantIds: Set<string>;
  onClose: () => void;
  onSelect: (managerId: string) => void;
  onSearch: (q: string) => void;
}) {
  const {
    state,
    users,
    byId,
    descendantIds: descIds,
    onClose,
    onSelect,
    onSearch,
  } = props;

  // Ineligible managers: the user themselves + any descendant
  // (would create a cycle). Server still validates.
  const subject = byId.get(state.userId);
  const ineligible = new Set<string>([state.userId, ...descIds]);

  const q = state.search.trim().toLowerCase();
  const candidates = users
    .filter((u) => !ineligible.has(u.id) && u.active !== false)
    .filter((u) => {
      if (!q) return true;
      return (
        displayName(u).toLowerCase().includes(q) ||
        u.email.toLowerCase().includes(q)
      );
    })
    .slice(0, 50);

  return (
    <div
      className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4"
      onClick={onClose}
    >
      <div
        className="bg-white dark:bg-gray-900 rounded-lg shadow-xl max-w-md w-full max-h-[80vh] flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="px-4 py-3 border-b border-gray-100 dark:border-gray-800">
          <h3 className="text-sm font-semibold text-gray-900 dark:text-gray-100">
            Set manager for {subject ? displayName(subject) : 'user'}
          </h3>
          <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
            Excludes the user themselves and their existing reports
            (cycles are rejected server-side too).
          </p>
        </div>
        <div className="px-4 py-2 border-b border-gray-100 dark:border-gray-800">
          <input
            autoFocus
            value={state.search}
            onChange={(e) => onSearch(e.target.value)}
            placeholder="Search by name or email..."
            className="w-full px-3 py-2 text-sm border border-gray-200 dark:border-gray-700 rounded-lg bg-transparent"
          />
        </div>
        <div className="overflow-y-auto flex-1">
          {candidates.length === 0 ? (
            <div className="p-6 text-center text-sm text-gray-400 dark:text-gray-500">
              No eligible candidates.
            </div>
          ) : (
            <ul>
              {candidates.map((u) => (
                <li key={u.id}>
                  <button
                    onClick={() => onSelect(u.id)}
                    className="w-full text-left px-4 py-2 hover:bg-gray-50 dark:hover:bg-gray-800/60 border-b border-gray-50 dark:border-gray-800/60"
                  >
                    <div className="text-sm text-gray-900 dark:text-gray-100">
                      {displayName(u)}
                    </div>
                    <div className="text-xs text-gray-500 dark:text-gray-400">
                      {u.email}
                      {u.jobTitle ? ` • ${u.jobTitle}` : ''}
                    </div>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
        <div className="px-4 py-2 border-t border-gray-100 dark:border-gray-800 flex justify-end">
          <button
            onClick={onClose}
            className="text-xs px-3 py-1.5 rounded-md text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800"
          >
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}
