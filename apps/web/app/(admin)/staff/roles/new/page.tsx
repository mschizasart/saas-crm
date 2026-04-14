'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';

type PermissionsMatrix = Record<string, string[]>;

const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001';

function authHeaders(): HeadersInit {
  const token = typeof window === 'undefined' ? null : localStorage.getItem('access_token');
  return { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
}

function permKey(module: string, action: string): string {
  return `${module}.${action}`;
}

export default function NewRolePage() {
  const router = useRouter();
  const [name, setName] = useState('');
  const [matrix, setMatrix] = useState<PermissionsMatrix>({});
  const [permissions, setPermissions] = useState<Record<string, boolean>>({});
  const [loadingPerms, setLoadingPerms] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch(`${API_BASE}/api/v1/roles/permissions`, { headers: authHeaders() })
      .then((r) => r.json())
      .then((data: PermissionsMatrix) => setMatrix(data ?? {}))
      .catch(() => setMatrix({}))
      .finally(() => setLoadingPerms(false));
  }, []);

  function toggle(key: string) {
    setPermissions((p) => ({ ...p, [key]: !p[key] }));
  }

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      const flat: Record<string, boolean> = {};
      Object.entries(matrix).forEach(([mod, actions]) => {
        actions.forEach((a) => {
          const k = permKey(mod, a);
          flat[k] = !!permissions[k];
        });
      });
      const res = await fetch(`${API_BASE}/api/v1/roles`, {
        method: 'POST',
        headers: authHeaders(),
        body: JSON.stringify({ name, permissions: flat }),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        throw new Error(j.message || `Failed with status ${res.status}`);
      }
      router.push('/staff/roles');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="max-w-4xl mx-auto">
      <div className="flex items-center gap-2 mb-6 text-sm text-gray-500">
        <Link href="/staff/roles" className="hover:text-primary">Roles</Link>
        <span>/</span>
        <span className="text-gray-900 font-medium">New</span>
      </div>
      <h1 className="text-2xl font-bold text-gray-900 mb-6">New Role</h1>

      <form onSubmit={save} className="bg-white rounded-xl border border-gray-100 shadow-sm p-6">
        {error && (
          <div className="mb-4 px-3 py-2 bg-red-50 border border-red-100 text-red-600 text-sm rounded-lg">{error}</div>
        )}
        <div className="mb-6">
          <label className="block text-xs font-medium text-gray-500 mb-1">Name *</label>
          <input
            type="text"
            required
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="w-full max-w-md px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary"
          />
        </div>

        <h2 className="text-sm font-semibold text-gray-700 mb-3">Permissions</h2>
        {loadingPerms ? (
          <p className="text-sm text-gray-400">Loading permissions…</p>
        ) : Object.keys(matrix).length === 0 ? (
          <p className="text-sm text-gray-400">No permissions available</p>
        ) : (
          <div className="space-y-4">
            {Object.entries(matrix).map(([mod, actions]) => (
              <div key={mod} className="border border-gray-100 rounded-lg p-4">
                <p className="text-sm font-medium text-gray-700 mb-2 capitalize">{mod}</p>
                <div className="flex flex-wrap gap-4">
                  {actions.map((a) => {
                    const k = permKey(mod, a);
                    return (
                      <label key={a} className="inline-flex items-center gap-2 text-sm text-gray-700">
                        <input
                          type="checkbox"
                          checked={!!permissions[k]}
                          onChange={() => toggle(k)}
                          className="w-4 h-4 rounded border-gray-300 text-primary focus:ring-primary/30"
                        />
                        <span className="capitalize">{a}</span>
                      </label>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        )}

        <div className="flex gap-3 mt-6">
          <button
            type="submit"
            disabled={saving}
            className="px-4 py-2 text-sm font-medium bg-primary text-white rounded-lg hover:bg-primary/90 disabled:opacity-50"
          >
            {saving ? 'Saving…' : 'Save Role'}
          </button>
          <Link href="/staff/roles" className="px-4 py-2 text-sm font-medium border border-gray-200 rounded-lg hover:bg-gray-50">
            Cancel
          </Link>
        </div>
      </form>
    </div>
  );
}
