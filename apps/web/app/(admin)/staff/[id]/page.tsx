'use client';

import { useState, useEffect, useCallback } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { DetailPageLayout } from '@/components/layouts/detail-page-layout';

interface Role {
  id: string;
  name: string;
}

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
  role?: Role | null;
  roleId?: string | null;
}

const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001';

function getToken(): string | null {
  if (typeof window === 'undefined') return null;
  return localStorage.getItem('access_token');
}

function authHeaders(): HeadersInit {
  return { Authorization: `Bearer ${getToken()}`, 'Content-Type': 'application/json' };
}

function Badge({ tone, children }: { tone: 'green' | 'gray' | 'blue'; children: React.ReactNode }) {
  const tones: Record<string, string> = {
    green: 'bg-green-100 text-green-700',
    gray: 'bg-gray-100 text-gray-500',
    blue: 'bg-blue-100 text-blue-700',
  };
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${tones[tone]}`}>
      {children}
    </span>
  );
}

export default function StaffDetailPage() {
  const params = useParams();
  const router = useRouter();
  const userId = params.id as string;

  const [user, setUser] = useState<StaffUser | null>(null);
  const [roles, setRoles] = useState<Role[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [editing, setEditing] = useState(false);
  const [editForm, setEditForm] = useState<Partial<StaffUser>>({});
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  const [showReset, setShowReset] = useState(false);
  const [newPassword, setNewPassword] = useState('');
  const [resetting, setResetting] = useState(false);
  const [resetError, setResetError] = useState<string | null>(null);

  const [uploading, setUploading] = useState(false);

  async function uploadAvatar(file: File) {
    setUploading(true);
    try {
      const formData = new FormData();
      formData.append('file', file);
      formData.append('folder', 'avatars');

      const uploadRes = await fetch(`${API_BASE}/api/v1/storage/upload`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${getToken()}` },
        body: formData,
      });
      if (!uploadRes.ok) throw new Error('Upload failed');
      const uploadData = await uploadRes.json();
      const avatarUrl = uploadData.url || uploadData.path || uploadData.fileUrl;

      const patchRes = await fetch(`${API_BASE}/api/v1/users/${userId}`, {
        method: 'PATCH',
        headers: authHeaders(),
        body: JSON.stringify({ avatar: avatarUrl }),
      });
      if (!patchRes.ok) throw new Error('Failed to update avatar');
      const updated: StaffUser = await patchRes.json();
      setUser(updated);
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Avatar upload failed');
    } finally {
      setUploading(false);
    }
  }

  const fetchUser = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`${API_BASE}/api/v1/users/${userId}`, { headers: authHeaders() });
      if (!res.ok) throw new Error(`Server responded with ${res.status}`);
      const data: StaffUser = await res.json();
      setUser(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load');
    } finally {
      setLoading(false);
    }
  }, [userId]);

  useEffect(() => {
    fetchUser();
    fetch(`${API_BASE}/api/v1/roles`, { headers: authHeaders() })
      .then((r) => r.json())
      .then((d) => setRoles(Array.isArray(d) ? d : d?.data ?? []))
      .catch(() => setRoles([]));
  }, [fetchUser]);

  function startEdit() {
    if (!user) return;
    setEditForm({
      firstName: user.firstName,
      lastName: user.lastName,
      email: user.email,
      phone: user.phone ?? '',
      roleId: user.role?.id ?? '',
      isAdmin: user.isAdmin,
    });
    setSaveError(null);
    setEditing(true);
  }

  async function saveEdit() {
    setSaving(true);
    setSaveError(null);
    try {
      const res = await fetch(`${API_BASE}/api/v1/users/${userId}`, {
        method: 'PATCH',
        headers: authHeaders(),
        body: JSON.stringify(editForm),
      });
      if (!res.ok) throw new Error(`Save failed with status ${res.status}`);
      const updated: StaffUser = await res.json();
      setUser(updated);
      setEditing(false);
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : 'Failed to save');
    } finally {
      setSaving(false);
    }
  }

  async function resetPassword() {
    if (!newPassword) {
      setResetError('Password is required');
      return;
    }
    setResetting(true);
    setResetError(null);
    try {
      const res = await fetch(`${API_BASE}/api/v1/users/${userId}/reset-password`, {
        method: 'POST',
        headers: authHeaders(),
        body: JSON.stringify({ password: newPassword }),
      });
      if (!res.ok) throw new Error(`Failed with status ${res.status}`);
      setShowReset(false);
      setNewPassword('');
      alert('Password reset successfully');
    } catch (err) {
      setResetError(err instanceof Error ? err.message : 'Failed');
    } finally {
      setResetting(false);
    }
  }

  async function toggleActive() {
    try {
      const res = await fetch(`${API_BASE}/api/v1/users/${userId}/toggle-active`, {
        method: 'PATCH',
        headers: authHeaders(),
      });
      if (!res.ok) throw new Error('Failed');
      fetchUser();
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Failed');
    }
  }

  async function deleteUser() {
    if (!confirm('Delete this staff member?')) return;
    try {
      const res = await fetch(`${API_BASE}/api/v1/users/${userId}`, {
        method: 'DELETE',
        headers: authHeaders(),
      });
      if (!res.ok) throw new Error('Failed');
      router.push('/staff');
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Failed');
    }
  }

  if (loading) {
    return (
      <div className="flex justify-center py-24">
        <div className="animate-pulse text-gray-400 dark:text-gray-500 text-sm">Loading...</div>
      </div>
    );
  }

  if (error || !user) {
    return (
      <div className="px-4 py-8 text-center">
        <p className="text-red-600 text-sm mb-3">{error ?? 'Not found'}</p>
        <button onClick={fetchUser} className="text-sm text-primary underline">Retry</button>
      </div>
    );
  }

  const actions = !editing
    ? [
        { label: 'Edit', onClick: startEdit, variant: 'primary' as const },
        { label: 'Permissions', href: `/staff/${userId}/permissions`, variant: 'secondary' as const },
        { label: 'Reset Password', onClick: () => setShowReset(true), variant: 'secondary' as const },
        { label: user.active ? 'Deactivate' : 'Activate', onClick: toggleActive, variant: 'secondary' as const },
        { label: 'Delete', onClick: deleteUser, variant: 'secondary' as const },
      ]
    : undefined;

  const badgeNode = (
    <span className="inline-flex items-center gap-1">
      <Badge tone={user.active ? 'green' : 'gray'}>{user.active ? 'Active' : 'Inactive'}</Badge>
      {user.isAdmin && <Badge tone="blue">Admin</Badge>}
    </span>
  );

  const avatarNode = (
    <div className="relative group inline-block">
      {user.avatar ? (
        <img
          src={user.avatar}
          alt={`${user.firstName} ${user.lastName}`}
          className="w-24 h-24 rounded-full object-cover border-2 border-gray-200 dark:border-gray-700"
        />
      ) : (
        <div className="w-24 h-24 rounded-full bg-primary/10 text-primary flex items-center justify-center text-2xl font-semibold border-2 border-gray-200 dark:border-gray-700">
          {user.firstName[0]}{user.lastName[0]}
        </div>
      )}
      <label className="absolute inset-0 flex items-center justify-center bg-black/40 text-white text-xs font-medium rounded-full opacity-0 group-hover:opacity-100 cursor-pointer transition-opacity">
        {uploading ? '...' : 'Change avatar'}
        <input
          type="file"
          accept="image/*"
          className="hidden"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) uploadAvatar(file);
            e.target.value = '';
          }}
          disabled={uploading}
        />
      </label>
    </div>
  );

  return (
    <DetailPageLayout
      title={`${user.firstName} ${user.lastName}`}
      breadcrumbs={[
        { label: 'Staff', href: '/staff' },
        { label: `${user.firstName} ${user.lastName}` },
      ]}
      badge={badgeNode}
      actions={actions}
      sidebar={
        <div className="bg-white dark:bg-gray-900 rounded-xl border border-gray-100 dark:border-gray-800 shadow-sm p-6 flex flex-col items-center">
          {avatarNode}
        </div>
      }
    >
      {editing ? (
        <div className="bg-white dark:bg-gray-900 rounded-xl border border-gray-100 dark:border-gray-800 shadow-sm p-6">
          {saveError && (
            <div className="mb-4 px-3 py-2 bg-red-50 border border-red-100 text-red-600 text-sm rounded-lg">
              {saveError}
            </div>
          )}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">First Name</label>
              <input
                type="text"
                value={(editForm.firstName as string) ?? ''}
                onChange={(e) => setEditForm((p) => ({ ...p, firstName: e.target.value }))}
                className="w-full px-3 py-2 text-sm border border-gray-200 dark:border-gray-700 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">Last Name</label>
              <input
                type="text"
                value={(editForm.lastName as string) ?? ''}
                onChange={(e) => setEditForm((p) => ({ ...p, lastName: e.target.value }))}
                className="w-full px-3 py-2 text-sm border border-gray-200 dark:border-gray-700 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">Email</label>
              <input
                type="email"
                value={(editForm.email as string) ?? ''}
                onChange={(e) => setEditForm((p) => ({ ...p, email: e.target.value }))}
                className="w-full px-3 py-2 text-sm border border-gray-200 dark:border-gray-700 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">Phone</label>
              <input
                type="text"
                value={(editForm.phone as string) ?? ''}
                onChange={(e) => setEditForm((p) => ({ ...p, phone: e.target.value }))}
                className="w-full px-3 py-2 text-sm border border-gray-200 dark:border-gray-700 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">Role</label>
              <select
                value={(editForm.roleId as string) ?? ''}
                onChange={(e) => setEditForm((p) => ({ ...p, roleId: e.target.value }))}
                className="w-full px-3 py-2 text-sm border border-gray-200 dark:border-gray-700 rounded-lg bg-white dark:bg-gray-900"
              >
                <option value="">— None —</option>
                {roles.map((r) => (
                  <option key={r.id} value={r.id}>{r.name}</option>
                ))}
              </select>
            </div>
            <div className="flex items-center">
              <label className="inline-flex items-center gap-2 text-sm text-gray-700 dark:text-gray-300 mt-5">
                <input
                  type="checkbox"
                  checked={!!editForm.isAdmin}
                  onChange={(e) => setEditForm((p) => ({ ...p, isAdmin: e.target.checked }))}
                  className="w-4 h-4 rounded border-gray-300 text-primary focus:ring-primary/30"
                />
                Admin privileges
              </label>
            </div>
          </div>
          <div className="flex gap-3 mt-6">
            <button
              onClick={saveEdit}
              disabled={saving}
              className="px-4 py-2 text-sm font-medium bg-primary text-white rounded-lg hover:bg-primary/90 disabled:opacity-50"
            >
              {saving ? 'Saving…' : 'Save'}
            </button>
            <button
              onClick={() => setEditing(false)}
              className="px-4 py-2 text-sm font-medium border border-gray-200 dark:border-gray-700 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-800"
            >
              Cancel
            </button>
          </div>
        </div>
      ) : (
        <div className="bg-white dark:bg-gray-900 rounded-xl border border-gray-100 dark:border-gray-800 shadow-sm p-6">
          <dl className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-sm">
            <div>
              <dt className="text-xs font-semibold text-gray-400 dark:text-gray-500 uppercase">Email</dt>
              <dd className="text-gray-900 dark:text-gray-100 mt-1">{user.email}</dd>
            </div>
            <div>
              <dt className="text-xs font-semibold text-gray-400 dark:text-gray-500 uppercase">Phone</dt>
              <dd className="text-gray-900 dark:text-gray-100 mt-1">{user.phone ?? '—'}</dd>
            </div>
            <div>
              <dt className="text-xs font-semibold text-gray-400 dark:text-gray-500 uppercase">Role</dt>
              <dd className="text-gray-900 dark:text-gray-100 mt-1">{user.role?.name ?? '—'}</dd>
            </div>
            <div>
              <dt className="text-xs font-semibold text-gray-400 dark:text-gray-500 uppercase">2FA</dt>
              <dd className="mt-1"><Badge tone={user.twoFaEnabled ? 'green' : 'gray'}>{user.twoFaEnabled ? 'Enabled' : 'Disabled'}</Badge></dd>
            </div>
            <div>
              <dt className="text-xs font-semibold text-gray-400 dark:text-gray-500 uppercase">Last Login</dt>
              <dd className="text-gray-900 dark:text-gray-100 mt-1">
                {user.lastLogin ? new Date(user.lastLogin).toLocaleString() : 'Never'}
              </dd>
            </div>
          </dl>
        </div>
      )}

      {showReset && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 px-4">
          <div className="bg-white dark:bg-gray-900 rounded-xl shadow-xl max-w-md w-full p-6">
            <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100 mb-4">Reset Password</h2>
            {resetError && (
              <div className="mb-4 px-3 py-2 bg-red-50 border border-red-100 text-red-600 text-sm rounded-lg">
                {resetError}
              </div>
            )}
            <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">New Password</label>
            <input
              type="text"
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              className="w-full px-3 py-2 text-sm border border-gray-200 dark:border-gray-700 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary"
            />
            <div className="flex gap-3 mt-5 justify-end">
              <button
                onClick={() => { setShowReset(false); setNewPassword(''); setResetError(null); }}
                className="px-4 py-2 text-sm font-medium border border-gray-200 dark:border-gray-700 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-800"
              >
                Cancel
              </button>
              <button
                onClick={resetPassword}
                disabled={resetting}
                className="px-4 py-2 text-sm font-medium bg-primary text-white rounded-lg hover:bg-primary/90 disabled:opacity-50"
              >
                {resetting ? 'Resetting…' : 'Reset'}
              </button>
            </div>
          </div>
        </div>
      )}
    </DetailPageLayout>
  );
}
