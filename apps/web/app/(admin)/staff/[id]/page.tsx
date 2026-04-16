'use client';

import { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';

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
  isActive: boolean;
  isAdmin: boolean;
  twoFactorEnabled: boolean;
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
        <div className="animate-pulse text-gray-400 text-sm">Loading...</div>
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

  return (
    <div className="max-w-4xl mx-auto">
      <div className="flex items-center gap-2 mb-6 text-sm text-gray-500">
        <Link href="/staff" className="hover:text-primary">Staff</Link>
        <span>/</span>
        <span className="text-gray-900 font-medium">{user.firstName} {user.lastName}</span>
      </div>

      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mb-6">
        <div className="flex items-center gap-3">
          <div className="relative group">
            {user.avatar ? (
              <img
                src={user.avatar}
                alt={`${user.firstName} ${user.lastName}`}
                className="w-12 h-12 rounded-full object-cover border-2 border-gray-200"
              />
            ) : (
              <div className="w-12 h-12 rounded-full bg-primary/10 text-primary flex items-center justify-center text-lg font-semibold border-2 border-gray-200">
                {user.firstName[0]}{user.lastName[0]}
              </div>
            )}
            <label className="absolute inset-0 flex items-center justify-center bg-black/40 text-white text-xs font-medium rounded-full opacity-0 group-hover:opacity-100 cursor-pointer transition-opacity">
              {uploading ? '...' : 'Edit'}
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
          <h1 className="text-2xl font-bold text-gray-900">{user.firstName} {user.lastName}</h1>
          <Badge tone={user.isActive ? 'green' : 'gray'}>{user.isActive ? 'Active' : 'Inactive'}</Badge>
          {user.isAdmin && <Badge tone="blue">Admin</Badge>}
        </div>
        {!editing && (
          <div className="flex gap-2">
            <button
              onClick={startEdit}
              className="px-4 py-2 text-sm font-medium bg-primary text-white rounded-lg hover:bg-primary/90"
            >
              Edit
            </button>
            <button
              onClick={() => setShowReset(true)}
              className="px-4 py-2 text-sm font-medium border border-gray-200 rounded-lg hover:bg-gray-50"
            >
              Reset Password
            </button>
            <button
              onClick={toggleActive}
              className="px-4 py-2 text-sm font-medium border border-gray-200 rounded-lg hover:bg-gray-50"
            >
              {user.isActive ? 'Deactivate' : 'Activate'}
            </button>
            <button
              onClick={deleteUser}
              className="px-4 py-2 text-sm font-medium border border-red-200 text-red-600 rounded-lg hover:bg-red-50"
            >
              Delete
            </button>
          </div>
        )}
      </div>

      {editing ? (
        <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-6">
          {saveError && (
            <div className="mb-4 px-3 py-2 bg-red-50 border border-red-100 text-red-600 text-sm rounded-lg">
              {saveError}
            </div>
          )}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-medium text-gray-500 mb-1">First Name</label>
              <input
                type="text"
                value={(editForm.firstName as string) ?? ''}
                onChange={(e) => setEditForm((p) => ({ ...p, firstName: e.target.value }))}
                className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-500 mb-1">Last Name</label>
              <input
                type="text"
                value={(editForm.lastName as string) ?? ''}
                onChange={(e) => setEditForm((p) => ({ ...p, lastName: e.target.value }))}
                className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-500 mb-1">Email</label>
              <input
                type="email"
                value={(editForm.email as string) ?? ''}
                onChange={(e) => setEditForm((p) => ({ ...p, email: e.target.value }))}
                className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-500 mb-1">Phone</label>
              <input
                type="text"
                value={(editForm.phone as string) ?? ''}
                onChange={(e) => setEditForm((p) => ({ ...p, phone: e.target.value }))}
                className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-500 mb-1">Role</label>
              <select
                value={(editForm.roleId as string) ?? ''}
                onChange={(e) => setEditForm((p) => ({ ...p, roleId: e.target.value }))}
                className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg bg-white"
              >
                <option value="">— None —</option>
                {roles.map((r) => (
                  <option key={r.id} value={r.id}>{r.name}</option>
                ))}
              </select>
            </div>
            <div className="flex items-center">
              <label className="inline-flex items-center gap-2 text-sm text-gray-700 mt-5">
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
              className="px-4 py-2 text-sm font-medium border border-gray-200 rounded-lg hover:bg-gray-50"
            >
              Cancel
            </button>
          </div>
        </div>
      ) : (
        <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-6">
          <dl className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-sm">
            <div>
              <dt className="text-xs font-semibold text-gray-400 uppercase">Email</dt>
              <dd className="text-gray-900 mt-1">{user.email}</dd>
            </div>
            <div>
              <dt className="text-xs font-semibold text-gray-400 uppercase">Phone</dt>
              <dd className="text-gray-900 mt-1">{user.phone ?? '—'}</dd>
            </div>
            <div>
              <dt className="text-xs font-semibold text-gray-400 uppercase">Role</dt>
              <dd className="text-gray-900 mt-1">{user.role?.name ?? '—'}</dd>
            </div>
            <div>
              <dt className="text-xs font-semibold text-gray-400 uppercase">2FA</dt>
              <dd className="mt-1"><Badge tone={user.twoFactorEnabled ? 'green' : 'gray'}>{user.twoFactorEnabled ? 'Enabled' : 'Disabled'}</Badge></dd>
            </div>
            <div>
              <dt className="text-xs font-semibold text-gray-400 uppercase">Last Login</dt>
              <dd className="text-gray-900 mt-1">
                {user.lastLogin ? new Date(user.lastLogin).toLocaleString() : 'Never'}
              </dd>
            </div>
          </dl>
        </div>
      )}

      {showReset && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 px-4">
          <div className="bg-white rounded-xl shadow-xl max-w-md w-full p-6">
            <h2 className="text-lg font-semibold text-gray-900 mb-4">Reset Password</h2>
            {resetError && (
              <div className="mb-4 px-3 py-2 bg-red-50 border border-red-100 text-red-600 text-sm rounded-lg">
                {resetError}
              </div>
            )}
            <label className="block text-xs font-medium text-gray-500 mb-1">New Password</label>
            <input
              type="text"
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary"
            />
            <div className="flex gap-3 mt-5 justify-end">
              <button
                onClick={() => { setShowReset(false); setNewPassword(''); setResetError(null); }}
                className="px-4 py-2 text-sm font-medium border border-gray-200 rounded-lg hover:bg-gray-50"
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
    </div>
  );
}
