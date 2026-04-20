'use client';

import { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import { ListPageLayout } from '@/components/layouts/list-page-layout';
import { Card } from '@/components/ui/card';
import { ErrorBanner } from '@/components/ui/error-banner';
import { EmptyState } from '@/components/ui/empty-state';

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
    <ListPageLayout
      title="Roles"
      primaryAction={{ label: 'New Role', href: '/staff/roles/new' }}
      className="max-w-4xl mx-auto"
    >
      <div className="flex items-center gap-2 mb-6 text-sm text-gray-500 dark:text-gray-400">
        <Link href="/staff" className="hover:text-primary">Staff</Link>
        <span>/</span>
        <span className="text-gray-900 dark:text-gray-100 font-medium">Roles</span>
      </div>

      {error && (
        <div className="mb-4">
          <ErrorBanner message={error} onRetry={fetchRoles} />
        </div>
      )}

      <Card>
        <table className="min-w-full text-sm">
          <thead>
            <tr className="bg-gray-50 dark:bg-gray-900 border-b border-gray-100 dark:border-gray-800 text-left text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide">
              <th className="px-4 py-3">Name</th>
              <th className="px-4 py-3">Users</th>
              <th className="px-4 py-3 text-right">Actions</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={3} className="px-4 py-12 text-center text-gray-400 dark:text-gray-500">Loading…</td></tr>
            ) : roles.length === 0 ? (
              <tr>
                <td colSpan={3}>
                  <EmptyState title="No roles yet" action={{ label: 'New Role', href: '/staff/roles/new' }} />
                </td>
              </tr>
            ) : (
              roles.map((r) => {
                const count = getUserCount(r);
                return (
                  <tr key={r.id} className="border-b border-gray-100 dark:border-gray-800 last:border-0 hover:bg-gray-50/60">
                    <td className="px-4 py-3 font-medium text-gray-900 dark:text-gray-100">{r.name}</td>
                    <td className="px-4 py-3 text-gray-500 dark:text-gray-400">{count}</td>
                    <td className="px-4 py-3">
                      <div className="flex items-center justify-end gap-3">
                        <Link href={`/staff/roles/${r.id}`} className="text-xs text-gray-500 dark:text-gray-400 hover:text-primary">Edit</Link>
                        <button
                          disabled={count > 0}
                          onClick={() => deleteRole(r.id)}
                          className="text-xs text-gray-500 dark:text-gray-400 hover:text-red-600 disabled:opacity-40 disabled:cursor-not-allowed"
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
      </Card>
    </ListPageLayout>
  );
}
