'use client';

import { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Users } from 'lucide-react';
import { ListPageLayout } from '@/components/layouts/list-page-layout';
import { Card } from '@/components/ui/card';
import { Badge as UiBadge, type BadgeVariant } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { TableSkeleton } from '@/components/ui/table-skeleton';
import { EmptyState } from '@/components/ui/empty-state';
import { ErrorBanner } from '@/components/ui/error-banner';
import { inputClass } from '@/components/ui/form-field';

interface StaffUser {
  id: string;
  firstName: string;
  lastName: string;
  email: string;
  phone: string | null;
  avatar?: string | null;
  active: boolean;
  isAdmin: boolean;
  twoFaEnabled: boolean;
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
  const variantMap: Record<string, BadgeVariant> = {
    green: 'success',
    gray: 'muted',
    blue: 'info',
    red: 'error',
  };
  return <UiBadge variant={variantMap[tone]}>{children}</UiBadge>;
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

  const filtersNode = (
    <input
      type="text"
      placeholder="Search staff..."
      value={search}
      onChange={(e) => setSearch(e.target.value)}
      aria-label="Search staff members"
      className={`${inputClass} max-w-sm`}
    />
  );

  const paginationNode =
    !loading && meta && meta.total > 0 ? (
      <div className="flex items-center justify-between px-4 py-3 border border-gray-100 dark:border-gray-800 rounded-xl bg-gray-50/50 dark:bg-gray-800/50">
        <p className="text-xs text-gray-500 dark:text-gray-400">{meta.total} total</p>
        <div className="flex items-center gap-2">
          <Button variant="secondary" size="sm" onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={page <= 1}>
            Previous
          </Button>
          <span className="text-xs text-gray-600 dark:text-gray-400 min-w-[80px] text-center">Page {page} of {totalPages}</span>
          <Button variant="secondary" size="sm" onClick={() => setPage((p) => Math.min(totalPages, p + 1))} disabled={page >= totalPages}>
            Next
          </Button>
        </div>
      </div>
    ) : null;

  return (
    <ListPageLayout
      title="Staff Members"
      secondaryActions={[{ label: 'Roles', href: '/staff/roles' }]}
      primaryAction={{ label: 'Invite Staff', href: '/staff/new', icon: <span className="text-lg leading-none">+</span> }}
      filters={filtersNode}
      pagination={paginationNode}
    >
      <Card>
        {error && (
          <ErrorBanner message={error} onRetry={fetchUsers} className="rounded-none border-0 border-b border-red-100" />
        )}
        <div className="overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead>
              <tr className="bg-gray-50 dark:bg-gray-900 border-b border-gray-100 dark:border-gray-800 text-left text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide">
                <th className="px-4 py-3">Name</th>
                <th className="px-4 py-3">Email</th>
                <th className="px-4 py-3">Role</th>
                <th className="px-4 py-3 hidden lg:table-cell">Last Login</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3 hidden lg:table-cell">2FA</th>
                <th className="px-4 py-3 text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <TableSkeleton rows={6} columns={7} columnWidths={['50%', '60%', '30%', '30%', '25%', '20%', '35%']} />
              ) : users.length === 0 ? (
                <tr>
                  <td colSpan={7} className="px-4 py-8">
                    <EmptyState
                      icon={<Users className="w-10 h-10" />}
                      title={search ? `No staff match "${search}"` : 'No staff members yet'}
                      action={!search ? { label: 'Invite your first staff member', href: '/staff/new' } : undefined}
                    />
                  </td>
                </tr>
              ) : (
                users.map((u) => (
                  <tr
                    key={u.id}
                    className="border-b border-gray-100 dark:border-gray-800 last:border-0 hover:bg-gray-50/60 cursor-pointer"
                    onClick={() => router.push(`/staff/${u.id}`)}
                  >
                    <td className="px-4 py-3 font-medium text-gray-900 dark:text-gray-100">
                      <div className="flex items-center gap-2.5">
                        {u.avatar ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img src={u.avatar} alt="" className="w-7 h-7 rounded-full object-cover flex-shrink-0" />
                        ) : (
                          <span className="w-7 h-7 rounded-full bg-primary/10 text-primary flex items-center justify-center text-xs font-semibold flex-shrink-0" aria-hidden="true">
                            {u.firstName[0]}{u.lastName[0]}
                          </span>
                        )}
                        <span>
                          {u.firstName} {u.lastName}
                          {u.isAdmin && <span className="ml-2"><Badge tone="blue">Admin</Badge></span>}
                        </span>
                      </div>
                    </td>
                    <td className="px-4 py-3 text-gray-500 dark:text-gray-400">{u.email}</td>
                    <td className="px-4 py-3 text-gray-500 dark:text-gray-400">{u.role?.name ?? <span className="text-gray-300 dark:text-gray-600">—</span>}</td>
                    <td className="px-4 py-3 text-gray-500 dark:text-gray-400 hidden lg:table-cell">
                      {u.lastLogin ? new Date(u.lastLogin).toLocaleDateString() : <span className="text-gray-300 dark:text-gray-600">Never</span>}
                    </td>
                    <td className="px-4 py-3">
                      <Badge tone={u.active ? 'green' : 'gray'}>{u.active ? 'Active' : 'Inactive'}</Badge>
                    </td>
                    <td className="px-4 py-3 hidden lg:table-cell">
                      <Badge tone={u.twoFaEnabled ? 'green' : 'gray'}>{u.twoFaEnabled ? 'On' : 'Off'}</Badge>
                    </td>
                    <td className="px-4 py-3" onClick={(e) => e.stopPropagation()}>
                      <div className="flex items-center justify-end gap-3">
                        <Link href={`/staff/${u.id}`} className="text-xs text-gray-500 dark:text-gray-400 hover:text-primary">View</Link>
                        <button onClick={() => toggleActive(u.id)} className="text-xs text-gray-500 dark:text-gray-400 hover:text-primary">
                          {u.active ? 'Deactivate' : 'Activate'}
                        </button>
                        <button onClick={() => deleteUser(u.id)} className="text-xs text-gray-500 dark:text-gray-400 hover:text-red-600">
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
      </Card>
    </ListPageLayout>
  );
}
