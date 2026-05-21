import { Injectable, UnauthorizedException } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../../../database/prisma.service';

export interface JwtPayload {
  sub: string;       // user id
  orgId: string;     // organization id
  type: 'staff' | 'contact';
  aud: 'staff' | 'portal';
  // DEPRECATED: no longer minted by generateTokenPair (escalation fix #3).
  // Kept optional only for backward-compat decoding of in-flight tokens; it
  // is NEVER read for authorization. The effective active-org role is always
  // re-resolved from the membership FK in validate().
  roleId?: string;
  isAdmin?: boolean;
}

type MembershipRole = 'admin' | 'staff' | 'owner';

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(
    config: ConfigService,
    private prisma: PrismaService,
  ) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: config.get('JWT_SECRET'),
    });
  }

  async validate(payload: JwtPayload) {
    // Multi-org: a User row's `organizationId` is the LEGACY primary org.
    // Once a user switches into a secondary membership, JWT.orgId will
    // differ from user.organizationId — so we must look up by id only
    // and then verify the org link separately (see TenantInterceptor,
    // which checks user_organization_memberships).
    const user = await this.prisma.user.findFirst({
      where: { id: payload.sub, active: true },
      include: {
        role: { select: { id: true, name: true, permissions: true } },
      },
    });

    if (!user) throw new UnauthorizedException();

    // ─── Per-org admin resolution (BLOCKER fix) ────────────────────
    //
    // `User.isAdmin` is the admin flag for the user's PRIMARY org only.
    // Trusting it directly would let a user who is admin in Org A but
    // merely staff in Org B keep admin powers after switching to Org B
    // (cross-org privilege escalation). We must instead derive admin
    // status from the membership for the ACTIVE org (payload.orgId).
    //
    // Resolution order:
    //  1. If there's an accepted membership for (sub, orgId): admin iff
    //     role is 'admin' or 'owner'. This is authoritative.
    //  2. No membership row (un-migrated user, should be rare post-
    //     backfill): fall back to legacy `User.isAdmin` ONLY when the
    //     active org equals the user's legacy primary org. Otherwise the
    //     user has no business being admin (or even present) in that org,
    //     so treat as non-admin.
    // Pull the membership for the ACTIVE org INCLUDING its granular Role
    // relation (the FK Role carrying that org's `permissions` JSON). The
    // `role` string is the coarse role TIER (admin/staff/owner) that drives
    // `isAdmin`; `membershipRole` is the actual per-org Role for permissions.
    const membership =
      await this.prisma.userOrganizationMembership.findUnique({
        where: {
          userId_organizationId: {
            userId: user.id,
            organizationId: payload.orgId,
          },
        },
        select: {
          role: true,
          acceptedAt: true,
          roleId: true,
          membershipRole: {
            select: { id: true, name: true, permissions: true },
          },
        },
      });

    let isAdmin: boolean;
    let membershipRole: MembershipRole | null = null;

    if (membership && membership.acceptedAt !== null) {
      membershipRole = membership.role as MembershipRole;
      isAdmin = membershipRole === 'admin' || membershipRole === 'owner';
    } else if (!membership && user.organizationId === payload.orgId) {
      // Backward-compat: un-migrated user with no membership row whose
      // legacy primary org matches the active org → trust legacy flag.
      isAdmin = user.isAdmin === true;
    } else {
      // No accepted membership AND legacy org doesn't match → deny admin.
      // (The TenantInterceptor independently rejects the request when
      // there's no accepted membership and no legacy match; this guards
      // the case where membership exists but is still pending.)
      isAdmin = false;
    }

    // ─── Per-org PERMISSION (role) resolution (v2 — real FK) ───────
    //
    // `user.role` is the Role attached via User.roleId — the user's
    // PRIMARY-org role, carrying that org's full `permissions` JSON.
    // RbacGuard reads `user.role.permissions` to authorize permission-
    // gated routes. Returning the primary-org role while the active org
    // is a SECONDARY org would leak the primary-org permissions into the
    // secondary org (cross-org permission escalation), even when `isAdmin`
    // was correctly downgraded to false above.
    //
    // The v2 fix: each UserOrganizationMembership now carries a real
    // `roleId` FK to a Role IN THE SAME org (assigned at invite/accept time
    // or by an admin via PATCH /memberships/:id). The effective role for the
    // ACTIVE org is THAT membership's Role — never matched by name, never
    // borrowed from another org.
    //
    // FAIL-CLOSED design — under no circumstance may a user in a non-primary
    // org receive permissions that didn't come from a Role in THAT org:
    //
    //  1. Accepted membership WITH a roleId → use membership.membershipRole
    //     (the active org's actual Role + permissions). This is the
    //     authoritative path for any org, primary or secondary.
    //
    //  2. Accepted membership but roleId IS NULL → empty-permission role
    //     ({ id: null, name: <roleTier>, permissions: {} }). The user is
    //     denied every permission-gated route in that org until an admin
    //     assigns a real Role. `isAdmin` (from the tier) may still grant the
    //     RbacGuard bypass for admin/owner tiers — unchanged behavior.
    //
    //  3. No membership row, but active org == legacy primary org → return
    //     the legacy `user.role` (User.roleId) for backward compat with
    //     un-migrated users (rare post-backfill). This MUST NOT regress the
    //     common single-org / home-org path.
    //
    //  4. Otherwise (no accepted membership for a non-primary org, also
    //     rejected by TenantInterceptor) → empty-permission role (deny).
    // `id` is intentionally `null` (not '') for the fail-closed empty role:
    // the returned `roleId` claim is computed as `role?.id ?? null`, which
    // reads this safely, and no consumer dereferences `role.id` for anything
    // (RbacGuard authorizes off `role.permissions`). (NIT fix #6.)
    const EMPTY_ROLE = {
      id: null as string | null,
      name: membershipRole ?? 'staff',
      permissions: {} as Record<string, unknown>,
    };

    let role: typeof user.role | typeof EMPTY_ROLE;

    if (membership && membership.acceptedAt !== null && membership.roleId) {
      // Case 1 — accepted membership with a real per-org Role FK. Use that
      // org's Role + permissions. Works identically for primary & secondary
      // orgs; the membership's roleId is the single source of truth.
      role = membership.membershipRole ?? EMPTY_ROLE;
    } else if (membership && membership.acceptedAt !== null) {
      // Case 2 — accepted membership but no Role assigned yet: fail closed.
      role = EMPTY_ROLE;
    } else if (!membership && payload.orgId === user.organizationId) {
      // Case 3 — un-migrated user with no membership row whose legacy
      // primary org matches the active org: trust the legacy primary role.
      role = user.role;
    } else {
      // Case 4 — no accepted membership for a non-primary org: deny.
      role = EMPTY_ROLE;
    }

    return {
      // Pass `sub` through so the TenantInterceptor can verify the
      // membership without an extra DB hop.
      sub: user.id,
      id: user.id,
      email: user.email,
      firstName: user.firstName,
      lastName: user.lastName,
      type: user.type,
      // isAdmin reflects the ACTIVE org (payload.orgId), NOT the user's
      // primary-org legacy flag — see resolution logic above.
      isAdmin,
      // The membership role for the active org, exposed for downstream
      // per-org checks. Null when there's no accepted membership row.
      membershipRole,
      // The active organization is the one the JWT was issued for, NOT
      // the user's legacy primary org.
      organizationId: payload.orgId,
      orgId: payload.orgId,
      // Keep the legacy org reachable for backward-compat code paths.
      primaryOrganizationId: user.organizationId,
      // The EFFECTIVE active-org role id (escalation fix #3). Previously this
      // leaked the PRIMARY org's `user.roleId` even when the active org was a
      // secondary membership. It now mirrors the resolved active-org `role`
      // object (the membership's per-org Role, the legacy role only for the
      // un-migrated home-org path, or null when fail-closed). Nothing reads
      // this for authorization (RbacGuard uses role.permissions), but we keep
      // it consistent so no downstream code can act on a stale value.
      roleId: role?.id ?? null,
      // Effective role for the ACTIVE org (payload.orgId). Sourced from the
      // membership's `roleId` FK Role for that org; an empty-permission role
      // when no Role is assigned (fail-closed); or the legacy primary role
      // only for un-migrated users on their home org. Never another org's
      // role. See resolution logic above.
      role,
      clientId: user.clientId,
    };
  }
}
