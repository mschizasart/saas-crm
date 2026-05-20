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
    const membership =
      await this.prisma.userOrganizationMembership.findUnique({
        where: {
          userId_organizationId: {
            userId: user.id,
            organizationId: payload.orgId,
          },
        },
        select: { role: true, acceptedAt: true },
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

    // ─── Per-org PERMISSION (role) resolution (BLOCKER fix) ────────
    //
    // `user.role` is the Role attached via User.roleId — the user's
    // PRIMARY-org role, carrying that org's full `permissions` JSON.
    // RbacGuard reads `user.role.permissions` to authorize permission-
    // gated routes. Returning the primary-org role while the active org
    // is a SECONDARY org leaks the primary-org permissions into the
    // secondary org (cross-org permission escalation), even when
    // `isAdmin` was correctly downgraded to false above.
    //
    // FAIL-CLOSED design — under no circumstance may a user in a non-
    // primary org receive their primary-org `role.permissions`:
    //
    //  1. Active org == primary org (payload.orgId === user.organizationId):
    //     return the user's existing primary `user.role` unchanged. This
    //     is the overwhelmingly common single-org / home-org path and
    //     MUST NOT regress.
    //
    //  2. Active org != primary org, with an accepted membership:
    //     - admin/owner: `isAdmin` is true so RbacGuard bypasses before
    //       it ever reads permissions; we still try to attach the active
    //       org's "Administrator"/"Admin" role for completeness, but never
    //       depend on it for access.
    //     - staff: resolve a Role IN THE ACTIVE ORG by a sensible default
    //       name ('Staff' | 'Member' | 'Employee', case-insensitive). If
    //       found, use ITS permissions. If not found, return an empty-
    //       permission role so the user is denied every permission-gated
    //       route in that org. NEVER fall back to the primary-org role.
    //
    //  3. No accepted membership (also rejected by TenantInterceptor):
    //     return an empty-permission role (deny).
    //
    // v2 FOLLOW-UP: this name-matching is a stopgap. Proper per-org role
    // assignment requires a `roleId` FK on UserOrganizationMembership,
    // set at invite/accept time, so secondary-org staff get a real,
    // configurable permission set instead of a matched-by-name default or
    // nothing. That schema change is intentionally OUT OF SCOPE here.
    const EMPTY_ROLE = { id: null, name: 'staff', permissions: {} as Record<string, unknown> };

    let role: typeof user.role | typeof EMPTY_ROLE;

    if (payload.orgId === user.organizationId) {
      // Case 1 — home/primary org: byte-identical to previous behavior.
      role = user.role;
    } else if (membership && membership.acceptedAt !== null) {
      // Case 2 — switched into a secondary org with an accepted membership.
      if (isAdmin) {
        // admin/owner: RbacGuard bypasses on isAdmin, so permissions are
        // moot. Attach the active org's admin role if one exists, else a
        // minimal empty role (NOT the primary-org role).
        const adminRole = await this.prisma.role.findFirst({
          where: {
            organizationId: payload.orgId,
            name: { in: ['Administrator', 'Admin'], mode: 'insensitive' },
          },
          select: { id: true, name: true, permissions: true },
        });
        role = adminRole ?? EMPTY_ROLE;
      } else {
        // staff: resolve a default-named role IN THE ACTIVE ORG. Fail-
        // closed to empty permissions when no such role exists.
        const staffRole = await this.prisma.role.findFirst({
          where: {
            organizationId: payload.orgId,
            name: { in: ['Staff', 'Member', 'Employee'], mode: 'insensitive' },
          },
          select: { id: true, name: true, permissions: true },
        });
        role = staffRole ?? EMPTY_ROLE;
      }
    } else {
      // Case 3 — no accepted membership for a non-primary org: deny.
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
      roleId: user.roleId,
      // Effective role for the ACTIVE org (payload.orgId). For the home
      // org this is the user's primary role unchanged; for a secondary
      // org it is that org's matched default role or an empty-permission
      // role — never the primary-org role. See resolution logic above.
      role,
      clientId: user.clientId,
    };
  }
}
