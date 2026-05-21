'use client';

/**
 * "Your organizations" settings page.
 *
 * Lets the authenticated user manage their own multi-org memberships:
 *   - see every org they belong to (accepted + pending) and their role
 *   - accept or decline pending invites
 *   - invite a user into an org they admin (with a real per-org Role)
 *
 * And, for orgs the user administers (the CURRENT active org), manage the
 * members of that org:
 *   - see each member's assigned Role
 *   - change a member's Role (PATCH /memberships/:id with { roleId })
 *
 * Permission: any authenticated user for the self-service parts; member
 * management is enforced server-side (must be an accepted admin/owner of the
 * org). These endpoints are cross-tenant by design and live under
 * /api/v1/memberships (see api/.../memberships).
 *
 * The granular Role dropdowns are populated from the CURRENT org's roles via
 * GET /api/v1/roles (tenant-scoped to the active org). Inviting into / managing
 * a DIFFERENT org therefore only offers the coarse role tier — switch into an
 * org to manage its members' granular roles.
 */

import { useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';
import { Building2, Check, X, Loader2, Plus, Users } from 'lucide-react';
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
  role: string; // coarse tier
  roleId: string | null;
  roleName: string | null;
  isPrimary: boolean;
  invitedAt: string;
  acceptedAt: string | null;
  pending: boolean;
}

interface OrgMember {
  id: string;
  userId: string;
  email: string;
  firstName: string;
  lastName: string;
  role: string; // coarse tier
  roleId: string | null;
  roleName: string | null;
  isPrimary: boolean;
  invitedAt: string;
  acceptedAt: string | null;
  pending: boolean;
}

interface Role {
  id: string;
  name: string;
}

// Decode the active org id from the current JWT (same approach as the org
// switcher). Avoids an extra round-trip just to learn which org is active.
function activeOrgId(): string | null {
  if (typeof window === 'undefined') return null;
  const token = localStorage.getItem('access_token');
  if (!token) return null;
  try {
    const json = atob(
      token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/'),
    );
    return (JSON.parse(json)?.orgId as string) ?? null;
  } catch {
    return null;
  }
}

export default function OrganizationsSettingsPage() {
  const [memberships, setMemberships] = useState<Membership[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);

  // Current active org + its roles (used to populate the granular Role
  // dropdowns and to manage that org's members).
  const [currentOrgId, setCurrentOrgId] = useState<string | null>(null);
  const [roles, setRoles] = useState<Role[]>([]);

  // Members of the current active org (only loaded when the user can manage
  // them — the server returns 403 otherwise, which we treat as "not admin").
  const [orgMembers, setOrgMembers] = useState<OrgMember[] | null>(null);
  const [orgMembersLoading, setOrgMembersLoading] = useState(false);
  const [memberBusyId, setMemberBusyId] = useState<string | null>(null);

  // Invite modal state.
  const [inviteOpen, setInviteOpen] = useState(false);
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteOrgId, setInviteOrgId] = useState('');
  const [inviteRole, setInviteRole] = useState('staff');
  const [inviteRoleId, setInviteRoleId] = useState<string>('');
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

  // Load the active org's roles (for the granular dropdowns).
  const loadRoles = async () => {
    try {
      const res = await apiFetch('/api/v1/roles');
      if (!res.ok) {
        setRoles([]);
        return;
      }
      const body = (await res.json()) as Role[];
      setRoles(Array.isArray(body) ? body : []);
    } catch {
      setRoles([]);
    }
  };

  // Load members of the current active org. A 403 means the user isn't an
  // admin/owner of it → hide the management section.
  const loadOrgMembers = async (orgId: string) => {
    setOrgMembersLoading(true);
    try {
      const res = await apiFetch(`/api/v1/memberships/org/${orgId}`);
      if (!res.ok) {
        setOrgMembers(null);
        return;
      }
      const body = (await res.json()) as OrgMember[];
      setOrgMembers(Array.isArray(body) ? body : []);
    } catch {
      setOrgMembers(null);
    } finally {
      setOrgMembersLoading(false);
    }
  };

  useEffect(() => {
    const orgId = activeOrgId();
    setCurrentOrgId(orgId);
    setInviteOrgId(orgId ?? '');
    load();
    loadRoles();
    if (orgId) loadOrgMembers(orgId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
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

  // Whether the invite targets the current org (so we can offer the granular
  // Role dropdown sourced from that org's roles).
  const invitingCurrentOrg = useMemo(
    () => !!currentOrgId && inviteOrgId.trim() === currentOrgId,
    [currentOrgId, inviteOrgId],
  );

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
          // Only send roleId when inviting into the current org (the only org
          // whose roles we can enumerate here) and one was picked.
          ...(invitingCurrentOrg && inviteRoleId
            ? { roleId: inviteRoleId }
            : {}),
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
      setInviteOrgId(currentOrgId ?? '');
      setInviteRole('staff');
      setInviteRoleId('');
      await load();
      if (currentOrgId) await loadOrgMembers(currentOrgId);
    } finally {
      setInviteBusy(false);
    }
  };

  // Change a member's granular Role.
  const handleChangeMemberRole = async (
    member: OrgMember,
    roleId: string,
  ) => {
    setMemberBusyId(member.id);
    try {
      const res = await apiFetch(`/api/v1/memberships/${member.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        // Empty selection clears the role (fail-closed → no permissions).
        body: JSON.stringify({ roleId: roleId === '' ? null : roleId }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(body.message || 'Could not update role');
        return;
      }
      toast.success('Role updated');
      if (currentOrgId) await loadOrgMembers(currentOrgId);
    } finally {
      setMemberBusyId(null);
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
                    Role: {m.roleName ?? m.role}
                    {m.roleName && (
                      <span className="opacity-60"> ({m.role})</span>
                    )}
                    {!m.roleName && (
                      <span className="ml-1 text-amber-600 dark:text-amber-400">
                        · no permissions assigned
                      </span>
                    )}
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
                    Role: {m.roleName ?? m.role}
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

      {/* Member management — only shown when the user can administer the
          current org (the org-members endpoint returns 403 otherwise, which
          leaves orgMembers null and hides this section). */}
      {orgMembers && (
        <SettingsSection
          title="Members of this organization"
          description="Assign each member a role within this organization. The role determines what they can access here."
        >
          {orgMembersLoading ? (
            <div className="flex items-center gap-2 text-sm text-gray-500">
              <Loader2 className="w-4 h-4 animate-spin" />
              Loading...
            </div>
          ) : orgMembers.length === 0 ? (
            <p className="text-sm text-gray-500">No members yet.</p>
          ) : (
            <ul className="divide-y divide-gray-100 dark:divide-gray-800">
              {orgMembers.map((member) => (
                <li
                  key={member.id}
                  className="py-3 flex items-center gap-3"
                >
                  <Users className="w-5 h-5 text-gray-500 dark:text-gray-400 flex-shrink-0" />
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-medium text-gray-900 dark:text-gray-100 truncate">
                      {member.firstName} {member.lastName}
                      {member.pending && (
                        <span className="ml-2 text-xs px-1.5 py-0.5 rounded bg-amber-500/10 text-amber-600 dark:text-amber-400">
                          pending
                        </span>
                      )}
                    </div>
                    <div className="text-xs text-gray-500 dark:text-gray-400 truncate">
                      {member.email} · tier: {member.role}
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <select
                      value={member.roleId ?? ''}
                      disabled={memberBusyId === member.id}
                      onChange={(e) =>
                        handleChangeMemberRole(member, e.target.value)
                      }
                      className="px-3 py-1.5 border border-gray-200 dark:border-gray-700 rounded-lg text-sm bg-white dark:bg-gray-900"
                    >
                      <option value="">No role (no access)</option>
                      {roles.map((r) => (
                        <option key={r.id} value={r.id}>
                          {r.name}
                        </option>
                      ))}
                    </select>
                    {memberBusyId === member.id && (
                      <Loader2 className="w-4 h-4 animate-spin text-gray-400" />
                    )}
                  </div>
                </li>
              ))}
            </ul>
          )}
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
                You can only invite a user into an organization where you are
                already an admin or owner. The role determines what they can
                access in that organization.
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
                {currentOrgId && inviteOrgId === currentOrgId && (
                  <p className="mt-1 text-[11px] text-gray-400">
                    This is your current organization.
                  </p>
                )}
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-700 dark:text-gray-300 mb-1">
                  Role tier
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
              {/* Granular Role dropdown — only when inviting into the current
                  org, whose roles we can enumerate via GET /api/v1/roles. */}
              {invitingCurrentOrg && (
                <div>
                  <label className="block text-xs font-medium text-gray-700 dark:text-gray-300 mb-1">
                    Permission role
                  </label>
                  <select
                    value={inviteRoleId}
                    onChange={(e) => setInviteRoleId(e.target.value)}
                    className="w-full px-3 py-2 border border-gray-200 dark:border-gray-700 rounded-lg text-sm bg-white dark:bg-gray-900"
                  >
                    <option value="">Org default (Staff/Member)</option>
                    {roles.map((r) => (
                      <option key={r.id} value={r.id}>
                        {r.name}
                      </option>
                    ))}
                  </select>
                  <p className="mt-1 text-[11px] text-gray-400">
                    Determines the member&apos;s granular permissions in this
                    organization.
                  </p>
                </div>
              )}
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
