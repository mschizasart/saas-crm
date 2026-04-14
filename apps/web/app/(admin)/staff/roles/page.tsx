'use client';

import { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';

interface Role {
  id: string;
  name: string;
  _count?: { users: number };
  usersCount?: number;
}

const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001';

function authHeaders(): HeadersInit {
  const token = typeof window === 'undefined' ? null : localStorage.getItem('access_token');
  return { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
}

export default function RolesPage() {
  const [roles, setRoles] = useState<Role[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchRoles = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`${API_BASE}/api/v1/roles`, { headers: authHeaders() });
      if (!res.ok) throw new Error(`Server responded with ${res.status}`);
      const data = await res.json();
      setRoles(Array.isArray(data) ? data : data?.data ?? []);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load roles');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchRoles();
  }, [fetchRoles]);

  async function deleteRole(id: string) {
    if (!confirm('Delete this role?')) return;
    try {
      const res = await fetch(`${API_BASE}/api/v1/roles/${id}`, {
        method: 'DELETE',
        headers: authHeaders(),
      });
      if (!res.ok) throw new Error('Delete failed');
      fetchRoles();
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Failed');
    }
  }

  function getUserCount(r: Role): number {
    return r._count?.users ?? r.usersCount ?? 0;
  }

  return (
    <div className="max-w-4xl mx-auto">
      <div className="flex items-center gap-2 mb-6 text-sm text-gray-500">
        <Link href="/staff" className="hover:text-primary">Staff</Link>
        <span>/</span>
        <span className="text-gray-900 font-medium">Roles</span>
      </div>
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mb-6">
        <h1 className="text-2xl font-bold text-gray-900">Roles</h1>
        <Link
          href="/staff/roles/new"
          className="inline-flex items-center gap-1.5 bg-primary text-white text-sm font-medium px-4 py-2 rounded-lg hover:bg-primary/90"
        >
          <span className="text-lg leading-none">+</span>
          New Role
        </Link>
      </div>

      <div className="bg-white rounded-xl border border-gray-100 shadow-sm overflow-hidden">
        {error && (
          <div className="px-4 py-3 bg-red-50 border-b border-red-100 text-sm text-red-600">
            {error} — <button className="underline" onClick={fetchRoles}>retry</button>
          </div>
        )}
        <table className="min-w-full text-sm">
          <thead>
            <tr className="bg-gray-50 border-b border-gray-100 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide">
              <th className="px-4 py-3">Name</th>
              <th className="px-4 py-3">Users</th>
              <th className="px-4 py-3 text-right">Actions</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={3} className="px-4 py-12 text-center text-gray-400">Loading…</td></tr>
            ) : roles.length === 0 ? (
              <tr><td colSpan={3} className="px-4 py-12 text-center text-gray-400">No roles yet</td></tr>
            ) : (
              roles.map((r) => {
                const count = getUserCount(r);
                return (
                  <tr key={r.id} className="border-b border-gray-100 last:border-0 hover:bg-gray-50/60">
                    <td className="px-4 py-3 font-medium text-gray-900">{r.name}</td>
                    <td className="px-4 py-3 text-gray-500">{count}</td>
                    <td className="px-4 py-3">
                      <div className="flex items-center justify-end gap-3">
                        <Link href={`/staff/roles/${r.id}`} className="text-xs text-gray-500 hover:text-primary">Edit</Link>
                        <button
                          disabled={count > 0}
                          onClick={() => deleteRole(r.id)}
                          className="text-xs text-gray-500 hover:text-red-600 disabled:opacity-40 disabled:cursor-not-allowed"
                          title={count > 0 ? 'Cannot delete role with assigned users' : 'Delete'}
                        >
                          Delete
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
