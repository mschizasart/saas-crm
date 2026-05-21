import {
  Injectable,
  NotFoundException,
  ForbiddenException,
  ConflictException,
  BadRequestException,
} from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service';

/**
 * Multi-org membership service.
 *
 * IMPORTANT: every read here intentionally crosses tenants. We look up
 * "which orgs does user X belong to" or "create a membership in some
 * other org" — both queries cannot be scoped by `app.current_organization_id`
 * the way every other table is. That's why `/api/v1/memberships` is
 * added to the TenantInterceptor skip-list and we deliberately use the
 * raw Prisma client without any RLS context here.
 */
@Injectable()
export class MembershipsService {
  constructor(private prisma: PrismaService) {}

  /**
   * Lookup a single membership (or null). Used by the controller to
   * authorise cross-tenant /invite calls without leaking the raw
   * Prisma client.
   */
  async findMembership(userId: string, organizationId: string) {
    return this.prisma.userOrganizationMembership.findUnique({
      where: { userId_organizationId: { userId, organizationId } },
    });
  }

  /**
   * Lookup a single membership by its id (or null). Used by the controller
   * to discover a target membership's org before authorising a role change.
   */
  async findById(membershipId: string) {
    return this.prisma.userOrganizationMembership.findUnique({
      where: { id: membershipId },
    });
  }

  /**
   * Orgs the given user belongs to (accepted + pending). The frontend
   * uses this to render the org switcher and the settings page.
   */
  async listForUser(userId: string) {
    const rows = await this.prisma.userOrganizationMembership.findMany({
      where: { userId },
      include: {
        organization: {
          select: { id: true, name: true, slug: true, logo: true },
        },
        membershipRole: { select: { id: true, name: true } },
      },
      orderBy: [{ isPrimary: 'desc' }, { invitedAt: 'asc' }],
    });

    return rows.map((m) => ({
      id: m.id,
      orgId: m.organizationId,
      orgName: m.organization.name,
      orgSlug: m.organization.slug,
      orgLogo: m.organization.logo,
      // Coarse tier string (drives isAdmin).
      role: m.role,
      // Granular per-org Role FK + its display name (null when unassigned).
      roleId: m.roleId,
      roleName: m.membershipRole?.name ?? null,
      isPrimary: m.isPrimary,
      invitedAt: m.invitedAt,
      acceptedAt: m.acceptedAt,
      pending: m.acceptedAt === null,
    }));
  }

  /**
   * Members of a given org (accepted + pending) with their assigned Role.
   * Used by the org-management UI to render the member list + role dropdown.
   * Cross-tenant by design (same rationale as the rest of this service).
   */
  async listForOrg(organizationId: string) {
    const rows = await this.prisma.userOrganizationMembership.findMany({
      where: { organizationId },
      include: {
        user: {
          select: {
            id: true,
            email: true,
            firstName: true,
            lastName: true,
          },
        },
        membershipRole: { select: { id: true, name: true } },
      },
      orderBy: [{ isPrimary: 'desc' }, { invitedAt: 'asc' }],
    });

    return rows.map((m) => ({
      id: m.id,
      userId: m.userId,
      email: m.user.email,
      firstName: m.user.firstName,
      lastName: m.user.lastName,
      role: m.role,
      roleId: m.roleId,
      roleName: m.membershipRole?.name ?? null,
      isPrimary: m.isPrimary,
      invitedAt: m.invitedAt,
      acceptedAt: m.acceptedAt,
      pending: m.acceptedAt === null,
    }));
  }

  /**
   * Resolve and validate the granular `roleId` for a membership in
   * `organizationId`.
   *
   *  - If `roleId` is provided: it MUST reference a Role that belongs to
   *    `organizationId` (rejects cross-org role assignment), else throws.
   *  - If `roleId` is omitted: fall back to that org's default
   *    'Staff' | 'Member' Role (case-insensitive) if one exists, else null
   *    (fail-closed → no granular permissions until assigned).
   *
   * Returns the resolved `{ roleId, roleName }` (roleId may be null).
   */
  private async resolveRole(
    organizationId: string,
    roleId?: string | null,
  ): Promise<{ roleId: string | null; roleName: string | null }> {
    if (roleId) {
      const role = await this.prisma.role.findFirst({
        where: { id: roleId, organizationId },
        select: { id: true, name: true },
      });
      if (!role) {
        throw new BadRequestException(
          'roleId does not reference a role in the target organization.',
        );
      }
      return { roleId: role.id, roleName: role.name };
    }

    // Default: the org's Staff/Member role, if present.
    const fallback = await this.prisma.role.findFirst({
      where: {
        organizationId,
        name: { in: ['Staff', 'Member'], mode: 'insensitive' },
      },
      select: { id: true, name: true },
      orderBy: { name: 'asc' },
    });
    return {
      roleId: fallback?.id ?? null,
      roleName: fallback?.name ?? null,
    };
  }

  /**
   * ─── TIER-ASSIGNMENT POLICY (privilege-escalation fix) ───────────────
   *
   * The coarse membership `role` TIER ('admin' | 'staff' | 'owner') drives
   * the `isAdmin` RbacGuard bypass. It is therefore SECURITY-SENSITIVE and is
   * NEVER inferred from the assigned granular Role's display name (the old
   * `tierFromRoleName` heuristic let a 'settings.edit' user create a Role
   * named "Admin", get it assigned, and silently become isAdmin=true).
   *
   * The tier is now ONLY ever set by an EXPLICIT, validated `role` field in
   * the request, gated by the CALLER's own tier:
   *
   *   - 'staff'  → any org admin OR owner may grant.
   *   - 'admin'  → only an OWNER may grant.
   *   - 'owner'  → only an OWNER may grant.
   *
   * A plain 'admin' caller can manage staff freely but can never mint another
   * admin/owner (no admin-makes-admin lateral escalation). Self-changes are
   * blocked one layer up (controller). Granting the granular Role (`roleId`)
   * is unaffected — it carries permissions, not the isAdmin bypass.
   *
   * `callerTier` is the authenticated caller's accepted tier in the SAME org
   * (resolved by the controller). `requestedTier` is the explicit tier from
   * the request, or undefined to leave the tier unchanged.
   */
  private assertMayGrantTier(
    callerTier: 'admin' | 'staff' | 'owner',
    requestedTier: 'admin' | 'staff' | 'owner',
  ): void {
    if (requestedTier === 'admin' || requestedTier === 'owner') {
      if (callerTier !== 'owner') {
        throw new ForbiddenException(
          'Only an owner may grant the admin or owner tier.',
        );
      }
    }
    // 'staff' is grantable by any admin/owner caller (the controller already
    // gated the caller to admin|owner before reaching the service).
  }

  /**
   * Invite a user (by email) into an organization. The caller must
   * already be an admin/owner in that org — checked by the controller
   * via the existing `members.manage` permission.
   *
   *  - If a User row exists with the given email anywhere in the system
   *    we attach the membership to that existing User.
   *  - If no such User exists we currently refuse — auto-provisioning
   *    contacts across tenants is reserved for v2.
   */
  async invite(params: {
    email: string;
    organizationId: string;
    /** Caller's accepted tier in the target org — drives tier-grant gating. */
    callerTier: 'admin' | 'staff' | 'owner';
    /** Explicit requested tier; defaults to 'staff' when omitted. */
    role?: 'admin' | 'staff' | 'owner';
    roleId?: string;
  }) {
    const { email, organizationId, callerTier, roleId } = params;
    if (!email || !organizationId) {
      throw new BadRequestException('email and organizationId required');
    }

    // ── Tier resolution (escalation fix #1/#4) ───────────────────────────
    // The tier is EXPLICIT and validated; it is never inferred from the
    // assigned Role's name. Default to 'staff' when omitted. Granting an
    // admin/owner tier requires the caller to be an owner (assertMayGrantTier).
    //
    // An admin-tier membership with a NULL roleId (empty granular perms but
    // isAdmin=true bypass) is acceptable ONLY because it is a DELIBERATE,
    // owner-authorized tier grant here — never a side effect of a role name.
    const tier: 'admin' | 'staff' | 'owner' = params.role ?? 'staff';
    this.assertMayGrantTier(callerTier, tier);

    // Cross-tenant lookup: find any active user matching this email. We
    // pick the most recently created so re-invites land on the freshest
    // account.
    const user = await this.prisma.user.findFirst({
      where: { email, active: true },
      orderBy: { createdAt: 'desc' },
    });
    if (!user) {
      throw new NotFoundException(
        'No user with this email exists. Ask them to register first.',
      );
    }

    const org = await this.prisma.organization.findUnique({
      where: { id: organizationId },
      select: { id: true, name: true, slug: true },
    });
    if (!org) throw new NotFoundException('Organization not found');

    const existing = await this.prisma.userOrganizationMembership.findUnique({
      where: { userId_organizationId: { userId: user.id, organizationId } },
    });
    if (existing) {
      throw new ConflictException(
        'This user already has a membership in that organization.',
      );
    }

    // Resolve the granular per-org Role FK. Validates `roleId` belongs to
    // the TARGET org (rejects cross-org assignment); falls back to the org's
    // Staff/Member role, or null (fail-closed) when none exists. This carries
    // PERMISSIONS only — it does NOT influence the coarse tier above.
    const resolved = await this.resolveRole(organizationId, roleId);

    return this.prisma.userOrganizationMembership.create({
      data: {
        userId: user.id,
        organizationId,
        role: tier,
        roleId: resolved.roleId,
        isPrimary: false,
        acceptedAt: null, // pending until the invitee accepts
      },
    });
  }

  /**
   * Change a member's granular Role (`roleId`) and/or coarse tier (`role`)
   * for an org. The caller's authority (must be an accepted admin/owner of
   * the SAME org, and NOT the target — enforced by the controller) plus their
   * tier (`callerTier`) gate what may be granted.
   *
   * Inputs use a present/absent semantic so "field omitted" is a no-op and
   * "explicit null" clears (escalation/NIT fix #6):
   *
   *  - `roleIdProvided=false`     → leave roleId unchanged.
   *  - `roleIdProvided=true, roleId=null` → clear roleId (fail-closed).
   *  - `roleIdProvided=true, roleId=<uuid>` → set to that org's Role (the new
   *    roleId must belong to the membership's org; validated by resolveRole).
   *
   *  - `requestedTier=undefined`  → leave the coarse tier unchanged. The tier
   *    is NEVER inferred from the assigned Role's name.
   *  - `requestedTier` set        → set the tier explicitly, gated by
   *    `assertMayGrantTier(callerTier, requestedTier)` (only an owner may
   *    grant admin/owner).
   */
  async updateRole(params: {
    membershipId: string;
    callerTier: 'admin' | 'staff' | 'owner';
    roleIdProvided: boolean;
    roleId?: string | null;
    requestedTier?: 'admin' | 'staff' | 'owner';
  }) {
    const { membershipId, callerTier, roleIdProvided, requestedTier } = params;
    const membership = await this.prisma.userOrganizationMembership.findUnique({
      where: { id: membershipId },
    });
    if (!membership) throw new NotFoundException('Membership not found');

    const data: { roleId?: string | null; role?: string } = {};

    // ── Granular Role (permissions) ──────────────────────────────────────
    if (roleIdProvided) {
      if (params.roleId === null || params.roleId === undefined) {
        // Explicit clear → fail-closed (no granular permissions).
        data.roleId = null;
      } else {
        // Validate the Role belongs to the membership's org (rejects
        // cross-org assignment). resolveRole throws on a bad id.
        const resolved = await this.resolveRole(
          membership.organizationId,
          params.roleId,
        );
        data.roleId = resolved.roleId;
      }
    }

    // ── Coarse tier (isAdmin bypass) — explicit only, never name-derived ──
    if (requestedTier !== undefined) {
      this.assertMayGrantTier(callerTier, requestedTier);
      data.role = requestedTier;
    }

    if (Object.keys(data).length === 0) {
      // Nothing to change — return the membership unchanged.
      return this.prisma.userOrganizationMembership.findUnique({
        where: { id: membershipId },
        include: { membershipRole: { select: { id: true, name: true } } },
      });
    }

    return this.prisma.userOrganizationMembership.update({
      where: { id: membershipId },
      data,
      include: { membershipRole: { select: { id: true, name: true } } },
    });
  }

  /**
   * Accept a pending membership. The caller must own it.
   */
  async accept(membershipId: string, userId: string) {
    const membership = await this.prisma.userOrganizationMembership.findUnique({
      where: { id: membershipId },
    });
    if (!membership) throw new NotFoundException('Membership not found');
    if (membership.userId !== userId) {
      throw new ForbiddenException('You cannot accept this invitation');
    }
    if (membership.acceptedAt) {
      return membership; // already accepted — idempotent
    }
    return this.prisma.userOrganizationMembership.update({
      where: { id: membershipId },
      data: { acceptedAt: new Date() },
    });
  }

  /**
   * Decline / revoke a pending invite. The caller must own it.
   */
  async decline(membershipId: string, userId: string) {
    const membership = await this.prisma.userOrganizationMembership.findUnique({
      where: { id: membershipId },
    });
    if (!membership) throw new NotFoundException('Membership not found');
    if (membership.userId !== userId) {
      throw new ForbiddenException('You cannot decline this invitation');
    }
    if (membership.acceptedAt) {
      throw new BadRequestException(
        'This membership has already been accepted. Ask an admin to remove you.',
      );
    }
    await this.prisma.userOrganizationMembership.delete({
      where: { id: membershipId },
    });
    return { ok: true };
  }
}
