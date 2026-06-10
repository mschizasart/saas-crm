import {
  Injectable,
  BadRequestException,
  NotFoundException,
  ConflictException,
} from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service';
import { AddMemberDto } from './territories.dto';

// ─── Territory members service (Wave G2) ────────────────────────
//
// CRUD over `territory_members`. Tenant guards:
//   * territoryId — must belong to caller's org.
//   * userId      — must belong to caller's org.
// Defense-in-depth `organizationId: orgId` on every read/write.
// UNIQUE (territoryId, userId) → ConflictException via P2002.

@Injectable()
export class TerritoryMembersService {
  constructor(private prisma: PrismaService) {}

  async list(orgId: string, territoryId: string) {
    await this.assertTerritoryInOrg(orgId, territoryId);

    return this.prisma.withOrganization(orgId, async (tx) => {
      const members = await tx.territoryMember.findMany({
        where: { organizationId: orgId, territoryId },
        orderBy: { createdAt: 'asc' },
      });

      // Hand-stitch the user so we don't need a Prisma relation back
      // to User (the Territory slice intentionally skips back-rels).
      const userIds = members.map((m) => m.userId);
      const users = userIds.length
        ? await tx.user.findMany({
            where: { id: { in: userIds }, organizationId: orgId },
            select: {
              id: true,
              firstName: true,
              lastName: true,
              email: true,
              avatar: true,
            },
          })
        : [];
      const byId = new Map(users.map((u) => [u.id, u]));

      return members.map((m) => ({
        ...m,
        user: byId.get(m.userId) ?? null,
      }));
    });
  }

  async addMember(orgId: string, territoryId: string, dto: AddMemberDto) {
    await this.assertTerritoryInOrg(orgId, territoryId);

    return this.prisma.withOrganization(orgId, async (tx) => {
      // Cross-tenant FK guard on userId.
      const user = await tx.user.findFirst({
        where: { id: dto.userId, organizationId: orgId },
        select: { id: true },
      });
      if (!user) {
        throw new BadRequestException(
          'User not found for this organization',
        );
      }

      try {
        return await tx.territoryMember.create({
          data: {
            organizationId: orgId,
            territoryId,
            userId: dto.userId,
            role: dto.role,
          },
        });
      } catch (e: any) {
        // UNIQUE (territoryId, userId) — duplicate add.
        if (e?.code === 'P2002') {
          throw new ConflictException(
            'User is already a member of this territory',
          );
        }
        throw e;
      }
    });
  }

  async updateMember(
    orgId: string,
    territoryId: string,
    userId: string,
    role: 'member' | 'manager',
  ) {
    await this.assertTerritoryInOrg(orgId, territoryId);

    return this.prisma.withOrganization(orgId, async (tx) => {
      // Cross-tenant FK guard on userId — mirrors addMember. Without
      // this, an attacker could probe arbitrary UUIDs via the URL.
      const user = await tx.user.findFirst({
        where: { id: userId, organizationId: orgId },
        select: { id: true },
      });
      if (!user) {
        throw new NotFoundException('user not found in this organization');
      }

      const existing = await tx.territoryMember.findFirst({
        where: { organizationId: orgId, territoryId, userId },
        select: { id: true },
      });
      if (!existing) {
        throw new NotFoundException('Membership not found');
      }

      // Defense-in-depth: id-based update so we don't depend on a
      // composite-unique lookup; the existence check above already
      // tenant-validated everything.
      return tx.territoryMember.update({
        where: { id: existing.id },
        data: { role },
      });
    });
  }

  async removeMember(orgId: string, territoryId: string, userId: string) {
    await this.assertTerritoryInOrg(orgId, territoryId);

    return this.prisma.withOrganization(orgId, async (tx) => {
      // Cross-tenant FK guard on userId — mirrors addMember. Without
      // this, an attacker could probe arbitrary UUIDs via the URL.
      const user = await tx.user.findFirst({
        where: { id: userId, organizationId: orgId },
        select: { id: true },
      });
      if (!user) {
        throw new NotFoundException('user not found in this organization');
      }

      const existing = await tx.territoryMember.findFirst({
        where: { organizationId: orgId, territoryId, userId },
        select: { id: true },
      });
      if (!existing) {
        throw new NotFoundException('Membership not found');
      }

      await tx.territoryMember.delete({
        where: { id: existing.id },
      });
    });
  }

  // ─── Internals ────────────────────────────────────────────────

  private async assertTerritoryInOrg(orgId: string, territoryId: string) {
    const t = await this.prisma.territory.findFirst({
      where: { id: territoryId, organizationId: orgId },
      select: { id: true },
    });
    if (!t) throw new NotFoundException('Territory not found');
  }
}
