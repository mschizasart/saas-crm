'use client';

import { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';

interface StaffUser {
  id: string;
  firstName: string;
  lastName: string;
  email: string;
  phone: string | null;
  avatar?: string | null;
  isActive: boolean;
  isAdmin: boolean;
  twoFactorEnabled: boolean;
  lastLogin: string | null;
  role?: { id: string; name: string } | null;
}

interface StaffResponse {
  data: StaffUser[];
  meta: { page: number; limit: number; total: number; totalPages: number };
}

const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001';

function getToken(): string | null {
  if (typeof window === 'undefined') return null;
  return localStorage.getItem('access_token');
}

function authHeaders(): HeadersInit {
  return { Authorization: `Bearer ${getToken()}`, 'Content-Type': 'application/json' };
}

function useDebounce<T>(value: T, delay: number): T {
  const [d, setD] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setD(value), delay);
    return () => clearTimeout(t);
  }, [value, delay]);
  return d;
}

function Badge({ tone, children }: { tone: 'green' | 'gray' | 'blue' | 'red'; children: React.ReactNode }) {
  const tones: Record<string, string> = {
    green: 'bg-green-100 text-green-700',
    gray: 'bg-gray-100 text-gray-500',
    blue: 'bg-blue-100 text-blue-700',
    red: 'bg-red-100 text-red-700',
  };
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${tones[tone]}`}>
      {children}
    </span>
  );
}

function SkeletonRow() {
  return (
    <tr className="border-b border-gray-100 last:border-0">
      {Array.from({ length: 7 }).map((_, i) => (
        <td key={i} className="px-4 py-3">
          <div className="h-4 bg-gray-100 rounded animate-pulse" style={{ width: '60%' }} />
        </td>
      ))}
    </tr>
  );
}

export default function StaffPage() {
  const router = useRouter();
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [users, setUsers] = useState<StaffUser[]>([]);
  const [meta, setMeta] = useState<StaffResponse['meta'] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const debounced = useDebounce(search, 350);

  useEffect(() => {
    setPage(1);
  }, [debounced]);

  const fetchUsers = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({ page: String(page), limit: '20' });
      if (debounced) params.set('search', debounced);
      const res = await fetch(`${API_BASE}/api/v1/users?${params.toString()}`, {
        headers: authHeaders(),
      });
      if (!res.ok) throw new Error(`Server responded with ${res.status}`);
      const json: StaffResponse = await res.json();
      setUsers(json.data ?? []);
      setMeta(json.meta ?? null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load staff');
      setUsers([]);
    } finally {
      setLoading(false);
    }
  }, [debounced, page]);

  useEffect(() => {
    fetchUsers();
  }, [fetchUsers]);

  async function toggleActive(id: string) {
    try {
      const res = await fetch(`${API_BASE}/api/v1/users/${id}/toggle-active`, {
        method: 'PATCH',
        headers: authHeaders(),
      });
      if (!res.ok) throw new Error('Toggle failed');
      fetchUsers();
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Failed');
    }
  }

  async function deleteUser(id: string) {
    if (!confirm('Delete this staff member? This cannot be undone.')) return;
    try {
      const res = await fetch(`${API_BASE}/api/v1/users/${id}`, {
        method: 'DELETE',
        headers: authHeaders(),
      });
      if (!res.ok) throw new Error('Delete failed');
      fetchUsers();
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Failed');
    }
  }

  const totalPages = meta?.totalPages ?? 1;

  return (
    <div>
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mb-6">
        <h1 className="text-2xl font-bold text-gray-900">Staff Members</h1>
        <div className="flex gap-2">
          <Link
            href="/staff/roles"
            className="inline-flex items-center text-sm font-medium px-4 py-2 rounded-lg border border-gray-200 hover:bg-gray-50 transition-colors"
          >
            Roles
          </Link>
          <Link
            href="/staff/new"
            className="inline-flex items-center gap-1.5 bg-primary text-white text-sm font-medium px-4 py-2 rounded-lg hover:bg-primary/90 transition-colors"
          >
            <span className="text-lg leading-none">+</span>
            Invite Staff
          </Link>
        </div>
      </div>

      <div className="mb-4">
        <input
          type="text"
          placeholder="Search staff..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="w-full max-w-sm px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary bg-white"
        />
      </div>

      <div className="bg-white rounded-xl border border-gray-100 shadow-sm overflow-hidden">
        {error && (
          <div className="px-4 py-3 bg-red-50 border-b border-red-100 text-sm text-red-600">
            {error} — <button className="underline" onClick={fetchUsers}>retry</button>
          </div>
        )}
        <div className="overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead>
              <tr className="bg-gray-50 border-b border-gray-100 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide">
                <th className="px-4 py-3">Name</th>
                <th className="px-4 py-3">Email</th>
                <th className="px-4 py-3">Role</th>
                <th className="px-4 py-3">Last Login</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3">2FA</th>
                <th className="px-4 py-3 text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                Array.from({ length: 6 }).map((_, i) => <SkeletonRow key={i} />)
              ) : users.length === 0 ? (
                <tr>
                  <td colSpan={7} className="px-4 py-16 text-center text-sm text-gray-400">
                    {search ? `No staff match "${search}"` : 'No staff members yet'}
                  </td>
                </tr>
              ) : (
                users.map((u) => (
                  <tr
                    key={u.id}
                    className="border-b border-gray-100 last:border-0 hover:bg-gray-50/60 cursor-pointer"
                    onClick={() => router.push(`/staff/${u.id}`)}
                  >
                    <td className="px-4 py-3 font-medium text-gray-900">
                      <div className="flex items-center gap-2.5">
                        {u.avatar ? (
                          <img src={u.avatar} alt="" className="w-7 h-7 rounded-full object-cover flex-shrink-0" />
                        ) : (
                          <span className="w-7 h-7 rounded-full bg-primary/10 text-primary flex items-center justify-center text-xs font-semibold flex-shrink-0">
                            {u.firstName[0]}{u.lastName[0]}
                          </span>
                        )}
                        <span>
                          {u.firstName} {u.lastName}
                          {u.isAdmin && <span className="ml-2"><Badge tone="blue">Admin</Badge></span>}
                        </span>
                      </div>
                    </td>
                    <td className="px-4 py-3 text-gray-500">{u.email}</td>
                    <td className="px-4 py-3 text-gray-500">{u.role?.name ?? <span className="text-gray-300">—</span>}</td>
                    <td className="px-4 py-3 text-gray-500">
                      {u.lastLogin ? new Date(u.lastLogin).toLocaleDateString() : <span className="text-gray-300">Never</span>}
                    </td>
                    <td className="px-4 py-3">
                      <Badge tone={u.isActive ? 'green' : 'gray'}>{u.isActive ? 'Active' : 'Inactive'}</Badge>
                    </td>
                    <td className="px-4 py-3">
                      <Badge tone={u.twoFactorEnabled ? 'green' : 'gray'}>{u.twoFactorEnabled ? 'On' : 'Off'}</Badge>
                    </td>
                    <td className="px-4 py-3" onClick={(e) => e.stopPropagation()}>
                      <div className="flex items-center justify-end gap-3">
                        <Link href={`/staff/${u.id}`} className="text-xs text-gray-500 hover:text-primary">View</Link>
                        <button onClick={() => toggleActive(u.id)} className="text-xs text-gray-500 hover:text-primary">
                          {u.isActive ? 'Deactivate' : 'Activate'}
                        </button>
                        <button onClick={() => deleteUser(u.id)} className="text-xs text-gray-500 hover:text-red-600">
                          Delete
                        </button>
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
        {!loading && meta && meta.total > 0 && (
          <div className="flex items-center justify-between px-4 py-3 border-t border-gray-100 bg-gray-50/50">
            <p className="text-xs text-gray-500">{meta.total} total</p>
            <div className="flex items-center gap-2">
              <button
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                disabled={page <= 1}
                className="px-3 py-1.5 text-xs font-medium rounded-md border border-gray-200 bg-white hover:bg-gray-50 disabled:opacity-40"
              >
                Previous
              </button>
              <span className="text-xs text-gray-600 min-w-[80px] text-center">Page {page} of {totalPages}</span>
              <button
                onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                disabled={page >= totalPages}
                className="px-3 py-1.5 text-xs font-medium rounded-md border border-gray-200 bg-white hover:bg-gray-50 disabled:opacity-40"
              >
                Next
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
