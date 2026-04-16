'use client';

import { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import { ArrowLeft } from 'lucide-react';

const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001';

interface OrgUser {
  id: string;
  email: string;
  name: string;
  isAdmin: boolean;
  isActive: boolean;
  lastLoginAt?: string | null;
}

interface OrgDetail {
  id: string;
  name: string;
  slug: string;
  status: string;
  plan?: string | null;
  createdAt: string;
  trialEndsAt?: string | null;
  userCount: number;
  clientCount: number;
  invoiceCount: number;
  projectCount: number;
  ticketCount: number;
  leadCount: number;
  users: OrgUser[];
}

const STATUS_BADGE: Record<string, string> = {
  trialing: 'bg-blue-100 text-blue-700',
  active: 'bg-green-100 text-green-700',
  suspended: 'bg-orange-100 text-orange-700',
  cancelled: 'bg-red-100 text-red-700',
  past_due: 'bg-red-100 text-red-700',
};

function StatusBadge({ status }: { status: string }) {
  return (
    <span
      className={`inline-flex px-2 py-1 rounded-full text-xs font-medium ${
        STATUS_BADGE[status] ?? 'bg-gray-100 text-gray-600'
      }`}
    >
      {status}
    </span>
  );
}

type Tab = 'overview' | 'users' | 'actions';

export default function OrgDetailPage() {
  const router = useRouter();
  const params = useParams<{ id: string }>();
  const id = params.id;

  const [org, setOrg] = useState<OrgDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>('overview');
  const [actionError, setActionError] = useState<string | null>(null);
  const [actionMessage, setActionMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [trialDays, setTrialDays] = useState(14);
  const [deleteInput, setDeleteInput] = useState('');
  const [plans, setPlans] = useState<{ id: string; name: string; slug: string }[]>([]);
  const [selectedPlanSlug, setSelectedPlanSlug] = useState<string>('');

  const token = () => (typeof window === 'undefined' ? null : localStorage.getItem('platform_token'));

  const fetchOrg = async () => {
    const t = token();
    if (!t) {
      router.replace('/platform/login');
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`${API_BASE}/api/v1/platform/organizations/${id}`, {
        headers: { Authorization: `Bearer ${t}` },
      });
      if (res.status === 401) {
        router.replace('/platform/login');
        return;
      }
      if (!res.ok) {
        setError('Failed to load organization');
        return;
      }
      setOrg(await res.json());
    } catch {
      setError('Network error');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (id) fetchOrg();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  useEffect(() => {
    const t = token();
    if (!t) return;
    fetch(`${API_BASE}/api/v1/platform/plans`, {
      headers: { Authorization: `Bearer ${t}` },
    })
      .then((r) => (r.ok ? r.json() : []))
      .then((data) => setPlans(Array.isArray(data) ? data : []))
      .catch(() => {});
  }, []);

  const onAssignPlan = async () => {
    if (!selectedPlanSlug) return;
    const res = await doAction('/assign-plan', 'POST', { planSlug: selectedPlanSlug });
    if (res?.ok) {
      setActionMessage(`Plan "${selectedPlanSlug}" assigned`);
      fetchOrg();
    }
  };

  const doAction = async (
    path: string,
    method: 'POST' | 'DELETE' = 'POST',
    body?: Record<string, unknown>,
  ): Promise<Response | null> => {
    const t = token();
    if (!t) {
      router.replace('/platform/login');
      return null;
    }
    setBusy(true);
    setActionError(null);
    setActionMessage(null);
    try {
      const res = await fetch(`${API_BASE}/api/v1/platform/organizations/${id}${path}`, {
        method,
        headers: {
          Authorization: `Bearer ${t}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(body ?? {}),
      });
      if (res.status === 401) {
        router.replace('/platform/login');
        return null;
      }
      if (!res.ok) {
        setActionError('Action failed');
        return res;
      }
      return res;
    } catch {
      setActionError('Network error');
      return null;
    } finally {
      setBusy(false);
    }
  };

  const onSuspend = async () => {
    const res = await doAction('/suspend');
    if (res?.ok) {
      setActionMessage('Organization suspended');
      fetchOrg();
    }
  };

  const onActivate = async () => {
    const res = await doAction('/activate');
    if (res?.ok) {
      setActionMessage('Organization activated');
      fetchOrg();
    }
  };

  const onExtendTrial = async () => {
    const res = await doAction('/extend-trial', 'POST', { days: trialDays });
    if (res?.ok) {
      setActionMessage(`Trial extended by ${trialDays} days`);
      fetchOrg();
    }
  };

  const onDelete = async () => {
    if (deleteInput !== 'DELETE') return;
    const res = await doAction('', 'DELETE');
    if (res?.ok) {
      router.replace('/platform/organizations');
    }
  };

  const onImpersonate = async () => {
    const res = await doAction('/impersonate');
    if (res?.ok) {
      const data = await res.json();
      localStorage.setItem('access_token', data.accessToken);
      window.location.href = '/dashboard';
    }
  };

  if (loading) {
    return (
      <div className="space-y-4">
        <div className="h-6 w-48 bg-gray-100 animate-pulse rounded" />
        <div className="h-32 bg-gray-100 animate-pulse rounded-xl" />
      </div>
    );
  }

  if (error || !org) {
    return (
      <div>
        <Link href="/platform/organizations" className="text-sm text-indigo-600 hover:underline">
          ← Back to organizations
        </Link>
        <div className="mt-4 p-4 rounded-lg bg-red-50 border border-red-100 text-sm text-red-700">
          {error ?? 'Organization not found'}
        </div>
      </div>
    );
  }

  return (
    <div>
      <Link
        href="/platform/organizations"
        className="inline-flex items-center gap-1 text-sm text-gray-500 hover:text-gray-800 mb-4"
      >
        <ArrowLeft className="w-4 h-4" /> Back to organizations
      </Link>

      <div className="flex items-start justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-3">
            {org.name}
            <StatusBadge status={org.status} />
          </h1>
          <p className="text-sm text-gray-500 mt-1">@{org.slug}</p>
        </div>
      </div>

      {/* Tabs */}
      <div className="border-b border-gray-200 mb-6">
        <div className="flex gap-6">
          {(['overview', 'users', 'actions'] as Tab[]).map((key) => (
            <button
              key={key}
              onClick={() => setTab(key)}
              className={`py-2 text-sm font-medium border-b-2 transition-colors ${
                tab === key
                  ? 'border-indigo-600 text-indigo-600'
                  : 'border-transparent text-gray-500 hover:text-gray-800'
              }`}
            >
              {key.charAt(0).toUpperCase() + key.slice(1)}
            </button>
          ))}
        </div>
      </div>

      {tab === 'overview' && (
        <div>
          <div className="grid grid-cols-2 md:grid-cols-3 gap-4 mb-6">
            {[
              { label: 'Users', value: org.userCount, accent: 'text-indigo-600' },
              { label: 'Clients', value: org.clientCount, accent: 'text-purple-600' },
              { label: 'Invoices', value: org.invoiceCount, accent: 'text-amber-600' },
              { label: 'Projects', value: org.projectCount, accent: 'text-green-600' },
              { label: 'Tickets', value: org.ticketCount, accent: 'text-orange-600' },
              { label: 'Leads', value: org.leadCount, accent: 'text-blue-600' },
            ].map((c) => (
              <div key={c.label} className="rounded-xl border border-gray-100 bg-white shadow-sm p-5">
                <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-2">
                  {c.label}
                </p>
                <p className={`text-2xl font-bold ${c.accent}`}>{c.value}</p>
              </div>
            ))}
          </div>

          <div className="rounded-xl border border-gray-100 bg-white shadow-sm p-5 space-y-3">
            <div className="flex justify-between text-sm">
              <span className="text-gray-500">Created</span>
              <span className="text-gray-900">{new Date(org.createdAt).toLocaleString()}</span>
            </div>
            <div className="flex justify-between text-sm">
              <span className="text-gray-500">Trial Ends</span>
              <span className="text-gray-900">
                {org.trialEndsAt ? new Date(org.trialEndsAt).toLocaleString() : '—'}
              </span>
            </div>
            <div className="flex justify-between text-sm">
              <span className="text-gray-500">Subscription Plan</span>
              <span className="text-gray-900">{org.plan ?? '—'}</span>
            </div>
          </div>
        </div>
      )}

      {tab === 'users' && (
        <div className="bg-white rounded-xl border border-gray-100 shadow-sm overflow-hidden">
          <div className="overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead>
                <tr className="bg-gray-50 border-b border-gray-100 text-left text-xs font-semibold text-gray-400 uppercase tracking-wide">
                  <th className="px-4 py-2.5">Name</th>
                  <th className="px-4 py-2.5">Email</th>
                  <th className="px-4 py-2.5">Admin</th>
                  <th className="px-4 py-2.5">Active</th>
                  <th className="px-4 py-2.5">Last Login</th>
                </tr>
              </thead>
              <tbody>
                {org.users.length === 0 ? (
                  <tr>
                    <td colSpan={5} className="px-4 py-8 text-center text-sm text-gray-400">
                      No users.
                    </td>
                  </tr>
                ) : (
                  org.users.map((u) => (
                    <tr
                      key={u.id}
                      className="border-b border-gray-100 last:border-0 hover:bg-gray-50/60 transition-colors"
                    >
                      <td className="px-4 py-3 font-medium text-gray-900">{u.name}</td>
                      <td className="px-4 py-3 text-gray-600">{u.email}</td>
                      <td className="px-4 py-3">
                        {u.isAdmin && (
                          <span className="inline-flex px-2 py-1 rounded-full text-xs font-medium bg-indigo-100 text-indigo-700">
                            Admin
                          </span>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        <span
                          className={`inline-flex px-2 py-1 rounded-full text-xs font-medium ${
                            u.isActive
                              ? 'bg-green-100 text-green-700'
                              : 'bg-gray-100 text-gray-500'
                          }`}
                        >
                          {u.isActive ? 'Active' : 'Inactive'}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-gray-500">
                        {u.lastLoginAt ? new Date(u.lastLoginAt).toLocaleString() : 'Never'}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {tab === 'actions' && (
        <div className="space-y-4 max-w-2xl">
          {actionError && (
            <div className="p-3 rounded-lg bg-red-50 border border-red-100 text-sm text-red-700">
              {actionError}
            </div>
          )}
          {actionMessage && (
            <div className="p-3 rounded-lg bg-green-50 border border-green-100 text-sm text-green-700">
              {actionMessage}
            </div>
          )}

          {/* Assign Plan */}
          <div className="rounded-xl border border-gray-100 bg-white shadow-sm p-5">
            <h3 className="font-semibold text-gray-900 mb-1">Assign Subscription Plan</h3>
            <p className="text-sm text-gray-500 mb-3">
              Override this organization's plan. Current plan:{' '}
              <span className="font-medium text-gray-900">{org.plan ?? '—'}</span> (status:{' '}
              <span className="font-medium text-gray-900">{org.status}</span>)
            </p>
            <div className="flex items-center gap-2">
              <select
                value={selectedPlanSlug}
                onChange={(e) => setSelectedPlanSlug(e.target.value)}
                className="flex-1 max-w-xs px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500"
              >
                <option value="">— Select a plan —</option>
                {plans.map((p) => (
                  <option key={p.id} value={p.slug}>
                    {p.name} ({p.slug})
                  </option>
                ))}
              </select>
              <button
                onClick={onAssignPlan}
                disabled={busy || !selectedPlanSlug}
                className="px-4 py-2 bg-indigo-600 text-white rounded-lg text-sm font-medium hover:bg-indigo-700 disabled:opacity-60"
              >
                Assign
              </button>
            </div>
          </div>

          {/* Impersonate */}
          <div className="rounded-xl border border-gray-100 bg-white shadow-sm p-5">
            <h3 className="font-semibold text-gray-900 mb-1">Impersonate Admin</h3>
            <p className="text-sm text-gray-500 mb-3">
              Log in as the org admin to troubleshoot their account.
            </p>
            <button
              onClick={onImpersonate}
              disabled={busy}
              className="px-4 py-2 bg-indigo-600 text-white rounded-lg text-sm font-medium hover:bg-indigo-700 disabled:opacity-60"
            >
              Impersonate Admin
            </button>
          </div>

          {/* Suspend / Activate */}
          <div className="rounded-xl border border-gray-100 bg-white shadow-sm p-5">
            <h3 className="font-semibold text-gray-900 mb-1">
              {org.status === 'suspended' ? 'Activate Organization' : 'Suspend Organization'}
            </h3>
            <p className="text-sm text-gray-500 mb-3">
              {org.status === 'suspended'
                ? 'Re-enable access for this organization.'
                : 'Temporarily block access to this organization.'}
            </p>
            {org.status === 'suspended' ? (
              <button
                onClick={onActivate}
                disabled={busy}
                className="px-4 py-2 bg-green-600 text-white rounded-lg text-sm font-medium hover:bg-green-700 disabled:opacity-60"
              >
                Activate
              </button>
            ) : (
              <button
                onClick={onSuspend}
                disabled={busy}
                className="px-4 py-2 bg-orange-600 text-white rounded-lg text-sm font-medium hover:bg-orange-700 disabled:opacity-60"
              >
                Suspend
              </button>
            )}
          </div>

          {/* Extend trial */}
          <div className="rounded-xl border border-gray-100 bg-white shadow-sm p-5">
            <h3 className="font-semibold text-gray-900 mb-1">Extend Trial</h3>
            <p className="text-sm text-gray-500 mb-3">Add additional trial days.</p>
            <div className="flex items-center gap-2">
              <input
                type="number"
                min={1}
                value={trialDays}
                onChange={(e) => setTrialDays(parseInt(e.target.value, 10) || 0)}
                className="w-24 px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500"
              />
              <span className="text-sm text-gray-500">days</span>
              <button
                onClick={onExtendTrial}
                disabled={busy || trialDays < 1}
                className="px-4 py-2 bg-indigo-600 text-white rounded-lg text-sm font-medium hover:bg-indigo-700 disabled:opacity-60"
              >
                Extend
              </button>
            </div>
          </div>

          {/* Delete */}
          <div className="rounded-xl border border-red-100 bg-white shadow-sm p-5">
            <h3 className="font-semibold text-red-700 mb-1">Delete Organization</h3>
            <p className="text-sm text-gray-500 mb-3">
              Permanently delete this organization and all of its data. This cannot be undone. Type{' '}
              <span className="font-mono font-semibold">DELETE</span> to confirm.
            </p>
            <div className="flex items-center gap-2">
              <input
                type="text"
                value={deleteInput}
                onChange={(e) => setDeleteInput(e.target.value)}
                placeholder="DELETE"
                className="w-40 px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:border-red-500 focus:ring-1 focus:ring-red-500"
              />
              <button
                onClick={onDelete}
                disabled={busy || deleteInput !== 'DELETE'}
                className="px-4 py-2 bg-red-600 text-white rounded-lg text-sm font-medium hover:bg-red-700 disabled:opacity-40 disabled:cursor-not-allowed"
              >
                Delete Permanently
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
