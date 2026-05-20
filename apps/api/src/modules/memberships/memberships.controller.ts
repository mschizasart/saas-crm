import {
  Controller,
  Get,
  Post,
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
    const callerMembership = await this.service.findMembership(
      user.id,
      dto.organizationId,
    );
    if (
      !callerMembership ||
      callerMembership.acceptedAt === null ||
      (callerMembership.role !== 'admin' && callerMembership.role !== 'owner')
    ) {
      throw new ForbiddenException(
        'You must be an admin or owner of the target organization to invite users.',
      );
    }
    return this.service.invite(dto);
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
