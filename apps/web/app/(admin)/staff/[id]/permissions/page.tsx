'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type OverrideState = 'inherit' | 'grant' | 'revoke';

interface PermissionCatalog {
  modules: Record<string, string[]>;
}

interface EffectivePermissions {
  rolePermissions: string[];
  overrides: Array<{ permission: string; grant: boolean }>;
  effective: string[];
}

interface StaffUser {
  id: string;
  firstName: string;
  lastName: string;
  email: string;
  role?: { id: string; name: string } | null;
}

const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001';

function getToken(): string | null {
  if (typeof window === 'undefined') return null;
  return localStorage.getItem('access_token');
}

function authHeaders(): HeadersInit {
  return {
    Authorization: `Bearer ${getToken()}`,
    'Content-Type': 'application/json',
  };
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default function StaffPermissionsPage() {
  const params = useParams();
  const router = useRouter();
  const userId = params.id as string;

  const [user, setUser] = useState<StaffUser | null>(null);
  const [catalog, setCatalog] = useState<PermissionCatalog | null>(null);
  const [rolePerms, setRolePerms] = useState<Set<string>>(new Set());
  const [overrides, setOverrides] = useState<Record<string, OverrideState>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveMsg, setSaveMsg] = useState<string | null>(null);
  const [notAvailable, setNotAvailable] = useState(false);

  const loadAll = useCallback(async () => {
    setLoading(true);
    setError(null);
    setNotAvailable(false);
    try {
      const [uRes, cRes, pRes] = await Promise.all([
        fetch(`${API_BASE}/api/v1/users/${userId}`, { headers: authHeaders() }),
        fetch(`${API_BASE}/api/v1/users/permissions/catalog`, {
          headers: authHeaders(),
        }),
        fetch(`${API_BASE}/api/v1/users/${userId}/permissions`, {
          headers: authHeaders(),
        }),
      ]);

      if (!uRes.ok) throw new Error(`Failed to load user (${uRes.status})`);
      if (!cRes.ok) throw new Error(`Failed to load catalog (${cRes.status})`);

      const uJson: StaffUser = await uRes.json();
      const cJson: PermissionCatalog = await cRes.json();
      setUser(uJson);
      setCatalog(cJson);

      if (pRes.status === 503) {
        setNotAvailable(true);
        setRolePerms(new Set());
        setOverrides({});
      } else if (!pRes.ok) {
        throw new Error(`Failed to load permissions (${pRes.status})`);
      } else {
        const pJson: EffectivePermissions = await pRes.json();
        setRolePerms(new Set(pJson.rolePermissions ?? []));
        const map: Record<string, OverrideState> = {};
        for (const o of pJson.overrides ?? []) {
          map[o.permission] = o.grant ? 'grant' : 'revoke';
        }
        setOverrides(map);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load');
    } finally {
      setLoading(false);
    }
  }, [userId]);

  useEffect(() => {
    loadAll();
  }, [loadAll]);

  function setPermissionState(permission: string, state: OverrideState) {
    setOverrides((prev) => {
      const next = { ...prev };
      if (state === 'inherit') delete next[permission];
      else next[permission] = state;
      return next;
    });
    setSaveMsg(null);
  }

  function effectiveFor(permission: string): boolean {
    const override = overrides[permission];
    if (override === 'grant') return true;
    if (override === 'revoke') return false;
    return rolePerms.has(permission);
  }

  const summary = useMemo(() => {
    const grants = Object.values(overrides).filter((v) => v === 'grant').length;
    const revokes = Object.values(overrides).filter((v) => v === 'revoke').length;
    return { grants, revokes };
  }, [overrides]);

  async function save() {
    if (notAvailable) {
      setError('Permission overrides are not enabled yet — database migration pending.');
      return;
    }
    setSaving(true);
    setSaveMsg(null);
    setError(null);
    try {
      const payload = {
        overrides: Object.entries(overrides).map(([permission, state]) => ({
          permission,
          grant: state === 'grant',
        })),
      };
      const res = await fetch(
        `${API_BASE}/api/v1/users/${userId}/permissions/overrides`,
        {
          method: 'PUT',
          headers: authHeaders(),
          body: JSON.stringify(payload),
        },
      );
      if (res.status === 503) {
        setNotAvailable(true);
        throw new Error(
          'Permission overrides not yet enabled — database migration required',
        );
      }
      if (!res.ok) throw new Error(`Save failed (${res.status})`);
      setSaveMsg('Permissions saved.');
      await loadAll();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Save failed');
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return (
      <div className="flex justify-center py-24">
        <div className="animate-pulse text-gray-400 dark:text-gray-500 text-sm">Loading…</div>
      </div>
    );
  }

  if (error && !user) {
    return (
      <div className="px-4 py-8 text-center">
        <p className="text-red-600 text-sm mb-3">{error}</p>
        <button onClick={loadAll} className="text-sm text-primary underline">
          Retry
        </button>
      </div>
    );
  }

  return (
    <div className="max-w-4xl mx-auto">
      <div className="flex items-center gap-2 mb-4 text-sm text-gray-500 dark:text-gray-400">
        <Link href="/staff" className="hover:text-primary">Staff</Link>
        <span>/</span>
        <Link href={`/staff/${userId}`} className="hover:text-primary">
          {user ? `${user.firstName} ${user.lastName}` : userId}
        </Link>
        <span>/</span>
        <span className="text-gray-900 dark:text-gray-100 font-medium">Permissions</span>
      </div>

      <div className="flex items-start justify-between gap-3 mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">Permissions</h1>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
            Role:{' '}
            <span className="font-medium text-gray-700 dark:text-gray-300">
              {user?.role?.name ?? '— None —'}
            </span>
            {' · '}
            <span>
              {summary.grants} grant{summary.grants !== 1 ? 's' : ''}
            </span>{' '}
            ·{' '}
            <span>
              {summary.revokes} revoke{summary.revokes !== 1 ? 's' : ''}
            </span>
          </p>
        </div>
        <div className="flex gap-2">
          <button
            onClick={() => router.push(`/staff/${userId}`)}
            className="px-4 py-2 text-sm font-medium border border-gray-200 dark:border-gray-700 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-800"
          >
            Cancel
          </button>
          <button
            onClick={save}
            disabled={saving || notAvailable}
            className="px-4 py-2 text-sm font-medium bg-primary text-white rounded-lg hover:bg-primary/90 disabled:opacity-50"
          >
            {saving ? 'Saving…' : 'Save'}
          </button>
        </div>
      </div>

      {notAvailable && (
        <div className="mb-4 px-4 py-3 bg-amber-50 border border-amber-100 text-amber-700 text-sm rounded-lg">
          Permission overrides are not enabled yet — a database migration is
          required. You can preview the UI, but saving will fail until the
          migration has been applied.
        </div>
      )}

      {error && (
        <div className="mb-4 px-4 py-3 bg-red-50 border border-red-100 text-red-600 text-sm rounded-lg">
          {error}
        </div>
      )}

      {saveMsg && (
        <div className="mb-4 px-4 py-3 bg-green-50 border border-green-100 text-green-700 text-sm rounded-lg">
          {saveMsg}
        </div>
      )}

      <div className="space-y-4">
        {catalog &&
          Object.entries(catalog.modules).map(([group, permissions]) => (
            <div
              key={group}
              className="bg-white dark:bg-gray-900 rounded-xl border border-gray-100 dark:border-gray-800 shadow-sm overflow-hidden"
            >
              <div className="px-4 py-2.5 bg-gray-50 dark:bg-gray-900 border-b border-gray-100 dark:border-gray-800">
                <h2 className="text-sm font-semibold text-gray-700 dark:text-gray-300 capitalize">
                  {group}
                </h2>
              </div>
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-xs text-gray-500 dark:text-gray-400 uppercase">
                    <th className="px-4 py-2 w-1/2">Permission</th>
                    <th className="px-4 py-2">State</th>
                    <th className="px-4 py-2 w-32 text-right">Effective</th>
                  </tr>
                </thead>
                <tbody>
                  {permissions.map((permission) => {
                    const state: OverrideState =
                      overrides[permission] ?? 'inherit';
                    const inRole = rolePerms.has(permission);
                    const effective = effectiveFor(permission);

                    return (
                      <tr
                        key={permission}
                        className="border-t border-gray-100 dark:border-gray-800"
                      >
                        <td className="px-4 py-2.5 font-mono text-xs text-gray-700 dark:text-gray-300">
                          {permission}
                          {inRole && (
                            <span className="ml-2 inline-block text-[10px] px-1.5 py-0.5 rounded bg-blue-50 text-blue-700 font-sans">
                              from role
                            </span>
                          )}
                        </td>
                        <td className="px-4 py-2">
                          <div className="inline-flex rounded-lg border border-gray-200 dark:border-gray-700 overflow-hidden text-xs">
                            <SegButton
                              active={state === 'inherit'}
                              onClick={() =>
                                setPermissionState(permission, 'inherit')
                              }
                              label="Inherited"
                            />
                            <SegButton
                              active={state === 'grant'}
                              onClick={() =>
                                setPermissionState(permission, 'grant')
                              }
                              label="Grant"
                              tone="green"
                            />
                            <SegButton
                              active={state === 'revoke'}
                              onClick={() =>
                                setPermissionState(permission, 'revoke')
                              }
                              label="Revoke"
                              tone="red"
                            />
                          </div>
                        </td>
                        <td className="px-4 py-2 text-right">
                          <span
                            className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${
                              effective
                                ? 'bg-green-100 text-green-700'
                                : 'bg-gray-100 text-gray-500'
                            }`}
                          >
                            {effective ? 'Allowed' : 'Denied'}
                          </span>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          ))}
      </div>

      <div className="flex justify-end mt-6 gap-2">
        <button
          onClick={() => router.push(`/staff/${userId}`)}
          className="px-4 py-2 text-sm font-medium border border-gray-200 dark:border-gray-700 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-800"
        >
          Cancel
        </button>
        <button
          onClick={save}
          disabled={saving || notAvailable}
          className="px-4 py-2 text-sm font-medium bg-primary text-white rounded-lg hover:bg-primary/90 disabled:opacity-50"
        >
          {saving ? 'Saving…' : 'Save'}
        </button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function SegButton({
  active,
  onClick,
  label,
  tone,
}: {
  active: boolean;
  onClick: () => void;
  label: string;
  tone?: 'green' | 'red';
}) {
  const activeClass =
    tone === 'green'
      ? 'bg-green-500 text-white'
      : tone === 'red'
        ? 'bg-red-500 text-white'
        : 'bg-gray-800 text-white';
  return (
    <button
      type="button"
      onClick={onClick}
      className={`px-3 py-1.5 transition-colors ${
        active ? activeClass : 'bg-white text-gray-600 hover:bg-gray-50'
      }`}
    >
      {label}
    </button>
  );
}
