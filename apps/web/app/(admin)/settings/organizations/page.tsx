'use client';

/**
 * "Your organizations" settings page.
 *
 * Lets the authenticated user manage their own multi-org memberships:
 *   - see every org they belong to (accepted + pending)
 *   - accept or decline pending invites
 *   - (for platform admins) invite themselves to any org by id
 *
 * Permission: any authenticated user — these endpoints are cross-tenant
 * by design and live under /api/v1/memberships (see api/.../memberships).
 */

import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { Building2, Check, X, Loader2, Plus } from 'lucide-react';
import { apiFetch } from '@/lib/api';
import { Button } from '@/components/ui/button';
import {
  SettingsPageLayout,
  SettingsSection,
} from '@/components/layouts/settings-page-layout';

interface Membership {
  id: string;
  orgId: string;
  orgName: string;
  orgSlug: string;
  orgLogo: string | null;
  role: string;
  isPrimary: boolean;
  invitedAt: string;
  acceptedAt: string | null;
  pending: boolean;
}

export default function OrganizationsSettingsPage() {
  const [memberships, setMemberships] = useState<Membership[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);

  // Invite modal state (self-invite for platform/workspace admins).
  const [inviteOpen, setInviteOpen] = useState(false);
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteOrgId, setInviteOrgId] = useState('');
  const [inviteRole, setInviteRole] = useState('staff');
  const [inviteBusy, setInviteBusy] = useState(false);

  const load = async () => {
    setLoading(true);
    try {
      const res = await apiFetch('/api/v1/memberships/me');
      if (!res.ok) {
        toast.error('Could not load memberships');
        return;
      }
      const body = (await res.json()) as Membership[];
      setMemberships(Array.isArray(body) ? body : []);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, []);

  const handleAccept = async (m: Membership) => {
    setBusyId(m.id);
    try {
      const res = await apiFetch(`/api/v1/memberships/accept/${m.id}`, {
        method: 'POST',
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        toast.error(body.message || 'Could not accept invitation');
        return;
      }
      toast.success(`Joined ${m.orgName}`);
      await load();
    } finally {
      setBusyId(null);
    }
  };

  const handleDecline = async (m: Membership) => {
    setBusyId(m.id);
    try {
      const res = await apiFetch(`/api/v1/memberships/decline/${m.id}`, {
        method: 'POST',
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        toast.error(body.message || 'Could not decline invitation');
        return;
      }
      toast.success('Invitation declined');
      await load();
    } finally {
      setBusyId(null);
    }
  };

  const handleInvite = async () => {
    if (!inviteEmail || !inviteOrgId) {
      toast.error('Email and organization id are required');
      return;
    }
    setInviteBusy(true);
    try {
      const res = await apiFetch('/api/v1/memberships/invite', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: inviteEmail,
          organizationId: inviteOrgId,
          role: inviteRole,
        }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(body.message || 'Could not create invitation');
        return;
      }
      toast.success('Invitation created');
      setInviteOpen(false);
      setInviteEmail('');
      setInviteOrgId('');
      setInviteRole('staff');
      await load();
    } finally {
      setInviteBusy(false);
    }
  };

  const accepted = memberships.filter((m) => !m.pending);
  const pending = memberships.filter((m) => m.pending);

  return (
    <SettingsPageLayout
      title="Your organizations"
      description="Manage the organizations your account belongs to. Switch between them at any time from the top bar."
    >
      <SettingsSection
        title="Active memberships"
        description="Organizations you currently have access to."
        footer={
          <Button
            variant="secondary"
            icon={<Plus className="w-4 h-4" />}
            onClick={() => setInviteOpen(true)}
          >
            Add to another organization
          </Button>
        }
      >
        {loading ? (
          <div className="flex items-center gap-2 text-sm text-gray-500">
            <Loader2 className="w-4 h-4 animate-spin" />
            Loading...
          </div>
        ) : accepted.length === 0 ? (
          <p className="text-sm text-gray-500">No active memberships yet.</p>
        ) : (
          <ul className="divide-y divide-gray-100 dark:divide-gray-800">
            {accepted.map((m) => (
              <li key={m.id} className="py-3 flex items-center gap-3">
                <Building2 className="w-5 h-5 text-gray-500 dark:text-gray-400 flex-shrink-0" />
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-medium text-gray-900 dark:text-gray-100 truncate">
                    {m.orgName}
                    {m.isPrimary && (
                      <span className="ml-2 text-xs px-1.5 py-0.5 rounded bg-primary/10 text-primary">
                        primary
                      </span>
                    )}
                  </div>
                  <div className="text-xs text-gray-500 dark:text-gray-400">
                    Role: {m.role}
                    {m.acceptedAt && (
                      <>
                        {' · joined '}
                        {new Date(m.acceptedAt).toLocaleDateString()}
                      </>
                    )}
                  </div>
                </div>
              </li>
            ))}
          </ul>
        )}
      </SettingsSection>

      {pending.length > 0 && (
        <SettingsSection
          title="Pending invitations"
          description="Accept to join, or decline to remove the invitation."
        >
          <ul className="divide-y divide-gray-100 dark:divide-gray-800">
            {pending.map((m) => (
              <li key={m.id} className="py-3 flex items-center gap-3">
                <Building2 className="w-5 h-5 text-gray-500 dark:text-gray-400 flex-shrink-0" />
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-medium text-gray-900 dark:text-gray-100 truncate">
                    {m.orgName}
                  </div>
                  <div className="text-xs text-gray-500 dark:text-gray-400">
                    Role: {m.role}
                    {' · invited '}
                    {new Date(m.invitedAt).toLocaleDateString()}
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <Button
                    size="sm"
                    variant="primary"
                    icon={<Check className="w-3.5 h-3.5" />}
                    onClick={() => handleAccept(m)}
                    loading={busyId === m.id}
                  >
                    Accept
                  </Button>
                  <Button
                    size="sm"
                    variant="secondary"
                    icon={<X className="w-3.5 h-3.5" />}
                    onClick={() => handleDecline(m)}
                    loading={busyId === m.id}
                  >
                    Decline
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        </SettingsSection>
      )}

      {inviteOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
          onClick={() => !inviteBusy && setInviteOpen(false)}
        >
          <div
            className="bg-white dark:bg-gray-900 rounded-xl shadow-xl max-w-md w-full"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="px-6 py-4 border-b border-gray-100 dark:border-gray-800 flex items-center justify-between">
              <h3 className="text-base font-semibold text-gray-900 dark:text-gray-100">
                Add to another organization
              </h3>
              <button
                onClick={() => setInviteOpen(false)}
                disabled={inviteBusy}
                className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-200"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="p-6 space-y-4">
              <p className="text-xs text-gray-500 dark:text-gray-400">
                You can only invite yourself into an organization if you are
                already an admin or owner of it (or a platform administrator).
                Otherwise ask an admin of that org to invite you.
              </p>
              <div>
                <label className="block text-xs font-medium text-gray-700 dark:text-gray-300 mb-1">
                  Email
                </label>
                <input
                  type="email"
                  value={inviteEmail}
                  onChange={(e) => setInviteEmail(e.target.value)}
                  className="w-full px-3 py-2 border border-gray-200 dark:border-gray-700 rounded-lg text-sm bg-white dark:bg-gray-900"
                  placeholder="you@company.com"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-700 dark:text-gray-300 mb-1">
                  Organization id
                </label>
                <input
                  type="text"
                  value={inviteOrgId}
                  onChange={(e) => setInviteOrgId(e.target.value)}
                  className="w-full px-3 py-2 border border-gray-200 dark:border-gray-700 rounded-lg text-sm font-mono bg-white dark:bg-gray-900"
                  placeholder="uuid"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-700 dark:text-gray-300 mb-1">
                  Role
                </label>
                <select
                  value={inviteRole}
                  onChange={(e) => setInviteRole(e.target.value)}
                  className="w-full px-3 py-2 border border-gray-200 dark:border-gray-700 rounded-lg text-sm bg-white dark:bg-gray-900"
                >
                  <option value="staff">staff</option>
                  <option value="admin">admin</option>
                  <option value="owner">owner</option>
                </select>
              </div>
            </div>
            <div className="px-6 py-4 border-t border-gray-100 dark:border-gray-800 bg-gray-50/50 dark:bg-gray-900/60 flex items-center justify-end gap-2">
              <Button
                variant="secondary"
                onClick={() => setInviteOpen(false)}
                disabled={inviteBusy}
              >
                Cancel
              </Button>
              <Button onClick={handleInvite} loading={inviteBusy}>
                Send invitation
              </Button>
            </div>
          </div>
        </div>
      )}
    </SettingsPageLayout>
  );
}
