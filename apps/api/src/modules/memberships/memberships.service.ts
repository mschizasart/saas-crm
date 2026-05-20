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
      },
      orderBy: [{ isPrimary: 'desc' }, { invitedAt: 'asc' }],
    });

    return rows.map((m) => ({
      id: m.id,
      orgId: m.organizationId,
      orgName: m.organization.name,
      orgSlug: m.organization.slug,
      orgLogo: m.organization.logo,
      role: m.role,
      isPrimary: m.isPrimary,
      invitedAt: m.invitedAt,
      acceptedAt: m.acceptedAt,
      pending: m.acceptedAt === null,
    }));
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
    role: string;
  }) {
    const { email, organizationId, role } = params;
    if (!email || !organizationId || !role) {
      throw new BadRequestException('email, organizationId and role required');
    }

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

    return this.prisma.userOrganizationMembership.create({
      data: {
        userId: user.id,
        organizationId,
        role,
        isPrimary: false,
        acceptedAt: null, // pending until the invitee accepts
      },
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
