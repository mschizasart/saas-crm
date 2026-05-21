import {
  Controller,
  Get,
  Post,
  Patch,
  Body,
  Param,
  UseGuards,
  HttpCode,
  HttpStatus,
  ForbiddenException,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { MembershipsService } from './memberships.service';
import { InviteMembershipDto } from './dto/invite-membership.dto';
import { UpdateMembershipRoleDto } from './dto/update-membership-role.dto';

/**
 * Multi-org membership endpoints.
 *
 * These routes intentionally cross tenants: a single user may belong to
 * many orgs and we need to enumerate them BEFORE knowing which org to
 * scope to. The TenantInterceptor therefore explicitly skips
 * `/api/v1/memberships` (see tenant.interceptor.ts) — DO NOT decorate
 * any handler here with `@CurrentOrg()` or `RbacGuard` (which depends
 * on a resolved tenant).
 *
 * Auth is JWT-only; the caller's identity comes from `JwtAuthGuard`.
 */
@ApiTags('Memberships')
@Controller({ version: '1', path: 'memberships' })
export class MembershipsController {
  constructor(private service: MembershipsService) {}

  /**
   * GET /api/v1/memberships/me
   *
   * Cross-tenant: returns every org the authenticated user belongs to,
   * including pending invitations. Powers the org switcher and the
   * "Organizations" settings page. Permission: any authenticated user.
   */
  @Get('me')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({
    summary:
      'List every organization the authenticated user belongs to (cross-tenant by design).',
  })
  async myMemberships(@CurrentUser() user: any) {
    return this.service.listForUser(user.id);
  }

  /**
   * POST /api/v1/memberships/invite
   *
   * Invite an existing user into an org. The caller must be an admin
   * or owner inside the *target* org — since this is cross-tenant we
   * cannot rely on the regular RbacGuard, so we enforce it manually:
   * the inviting user must hold a membership in the target org with
   * role 'admin' or 'owner'.
   */
  @Post('invite')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({
    summary: 'Invite a user into an organization (creates a pending membership).',
  })
  async invite(@CurrentUser() user: any, @Body() dto: InviteMembershipDto) {
    // Manual permission check: caller must hold an ACCEPTED admin/owner
    // membership in the *target* org. We can't rely on RbacGuard because
    // this endpoint is cross-tenant and the TenantInterceptor doesn't
    // pre-load `request.organization`.
    //
    // NOTE: there is deliberately NO platform-admin escape hatch here.
    // The previous `user.isAdmin === true && !callerMembership` bypass
    // let any primary-org admin invite users into orgs they don't belong
    // to (privilege escalation). Platform super-admins that legitimately
    // need cross-org invite must use a separate PlatformAdminGuard-gated
    // endpoint, not this membership-scoped one.
    const callerTier = await this.assertOrgAdmin(user.id, dto.organizationId);
    // Pass the caller's tier so the service can gate tier grants: only an
    // owner may invite at the admin/owner tier; everyone else is forced to
    // 'staff' regardless of the requested tier (escalation fix #1/#4).
    return this.service.invite({
      email: dto.email,
      organizationId: dto.organizationId,
      callerTier,
      role: dto.role,
      roleId: dto.roleId,
    });
  }

  /**
   * GET /api/v1/memberships/org/:orgId
   *
   * List every member of an org (accepted + pending) with their assigned
   * Role. Powers the org-management member list + role dropdown. Cross-tenant
   * by design; the caller must hold an ACCEPTED admin/owner membership in
   * that org (same authority as inviting).
   */
  @Get('org/:orgId')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({
    summary:
      'List the members of an organization (admin/owner of that org only).',
  })
  async listOrgMembers(
    @CurrentUser() user: any,
    @Param('orgId') orgId: string,
  ) {
    await this.assertOrgAdmin(user.id, orgId);
    return this.service.listForOrg(orgId);
  }

  /**
   * PATCH /api/v1/memberships/:id
   *
   * Change a member's granular per-org Role (`roleId`). The caller must hold
   * an ACCEPTED admin/owner membership in the SAME org as the target
   * membership. The new `roleId` must belong to that org (enforced in the
   * service); `null` clears it (fail-closed). Cross-tenant by design.
   */
  @Patch(':id')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({
    summary:
      "Change a member's role within an organization (admin/owner of that org only).",
  })
  async updateMemberRole(
    @CurrentUser() user: any,
    @Param('id') id: string,
    @Body() dto: UpdateMembershipRoleDto,
  ) {
    const target = await this.service.findById(id);
    if (!target) {
      // Mirror the service's NotFound, but check authority against the org
      // first would leak existence; a 403 here is acceptable since the
      // caller couldn't be an admin of an org for a nonexistent membership.
      throw new ForbiddenException('Membership not found or access denied.');
    }

    // ── Self-tier-change block (escalation fix #2) ──────────────────────
    // A user must NEVER alter their own membership tier or roleId — even an
    // owner. Otherwise a self-targeted PATCH could re-grant a tier or swap a
    // role. assertOrgAdmin passing when the caller IS the target was the gap.
    if (target.userId === user.id) {
      throw new ForbiddenException('Cannot change your own role.');
    }

    const callerTier = await this.assertOrgAdmin(user.id, target.organizationId);

    // Distinguish "field omitted" (no-op) from "explicit null" (clear) for
    // roleId, and treat the coarse tier as explicit-only (escalation fix
    // #1/#6). The service gates admin/owner tier grants to owner callers.
    return this.service.updateRole({
      membershipId: id,
      callerTier,
      roleIdProvided: 'roleId' in dto,
      roleId: dto.roleId,
      requestedTier: dto.role,
    });
  }

  /**
   * Shared authority check: the caller must hold an ACCEPTED membership with
   * role tier 'admin' or 'owner' in `organizationId`. Throws otherwise.
   * Mirrors the manual check in the invite handler — there is deliberately
   * NO platform-admin escape hatch on these membership-scoped routes.
   *
   * Returns the caller's tier so callers can gate WHAT they may grant (e.g.
   * only an 'owner' may mint another admin/owner — see the service).
   */
  private async assertOrgAdmin(
    userId: string,
    organizationId: string,
  ): Promise<'admin' | 'owner'> {
    const callerMembership = await this.service.findMembership(
      userId,
      organizationId,
    );
    if (
      !callerMembership ||
      callerMembership.acceptedAt === null ||
      (callerMembership.role !== 'admin' && callerMembership.role !== 'owner')
    ) {
      throw new ForbiddenException(
        'You must be an admin or owner of this organization.',
      );
    }
    return callerMembership.role as 'admin' | 'owner';
  }

  /**
   * POST /api/v1/memberships/accept/:id
   * Accept a pending invitation. Must be the owner of the membership.
   */
  @Post('accept/:id')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Accept a pending membership invitation.' })
  async accept(@CurrentUser() user: any, @Param('id') id: string) {
    return this.service.accept(id, user.id);
  }

  /**
   * POST /api/v1/memberships/decline/:id
   * Decline / delete a pending invitation. Must be the owner.
   */
  @Post('decline/:id')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Decline a pending membership invitation.' })
  async decline(@CurrentUser() user: any, @Param('id') id: string) {
    return this.service.decline(id, user.id);
  }
}
