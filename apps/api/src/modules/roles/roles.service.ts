import {
  Injectable,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service';

export interface CreateRoleDto {
  name: string;
  permissions?: Record<string, boolean>;
}

export interface UpdateRoleDto {
  name?: string;
  permissions?: Record<string, boolean>;
}

@Injectable()
export class RolesService {
  constructor(private prisma: PrismaService) {}

  // ─── List ──────────────────────────────────────────────────

  async findAll(orgId: string) {
    return this.prisma.withOrganization(orgId, async (tx) => {
      return tx.role.findMany({
        where: { organizationId: orgId },
        include: { _count: { select: { users: true } } },
        orderBy: { name: 'asc' },
      });
    });
  }

  // ─── Single ────────────────────────────────────────────────

  async findOne(orgId: string, id: string) {
    return this.prisma.withOrganization(orgId, async (tx) => {
      const role = await tx.role.findFirst({
        where: { id, organizationId: orgId },
        include: { _count: { select: { users: true } } },
      });
      if (!role) throw new NotFoundException('Role not found');
      return role;
    });
  }

  // ─── Create ────────────────────────────────────────────────

  async create(orgId: string, dto: CreateRoleDto) {
    return this.prisma.withOrganization(orgId, async (tx) => {
      return tx.role.create({
        data: {
          organizationId: orgId,
          name: dto.name,
          permissions: dto.permissions ?? {},
        },
      });
    });
  }

  // ─── Update ────────────────────────────────────────────────

  async update(orgId: string, id: string, dto: UpdateRoleDto) {
    await this.findOne(orgId, id);
    return this.prisma.withOrganization(orgId, async (tx) => {
      return tx.role.update({
        where: { id },
        data: {
          ...(dto.name !== undefined && { name: dto.name }),
          ...(dto.permissions !== undefined && { permissions: dto.permissions }),
        },
      });
    });
  }

  // ─── Delete ────────────────────────────────────────────────

  async delete(orgId: string, id: string) {
    const role = await this.findOne(orgId, id);

    if (role._count.users > 0) {
      throw new BadRequestException(
        `Cannot delete role "${role.name}": ${role._count.users} user(s) are still assigned to it.`,
      );
    }

    await this.prisma.withOrganization(orgId, async (tx) => {
      await tx.role.delete({ where: { id } });
    });
  }

  // ─── Available permissions catalogue ───────────────────────

  getDefaultPermissions() {
    return {
      modules: {
        clients: [
          'clients.view',
          'clients.create',
          'clients.edit',
          'clients.delete',
        ],
        invoices: [
          'invoices.view',
          'invoices.create',
          'invoices.edit',
          'invoices.delete',
          'invoices.send',
        ],
        leads: [
          'leads.view',
          'leads.create',
          'leads.edit',
          'leads.delete',
        ],
        projects: [
          'projects.view',
          'projects.create',
          'projects.edit',
          'projects.delete',
        ],
        tickets: [
          'tickets.view',
          'tickets.create',
          'tickets.edit',
          'tickets.delete',
          'tickets.assign',
        ],
        users: [
          'users.view',
          'users.create',
          'users.edit',
          'users.delete',
        ],
        reports: ['reports.view'],
        settings: ['settings.edit'],
      },
    };
  }
}
