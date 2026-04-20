import {
  Injectable,
  NotFoundException,
  ConflictException,
  BadRequestException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { PrismaService } from '../../database/prisma.service';
import * as bcrypt from 'bcryptjs';
import * as crypto from 'crypto';

export interface CreateUserDto {
  email: string;
  firstName: string;
  lastName: string;
  roleId?: string;
  phone?: string;
  phoneMobile?: string;
  isAdmin?: boolean;
  password?: string;
}

export interface UpdateUserDto {
  firstName?: string;
  lastName?: string;
  roleId?: string;
  phone?: string;
  phoneMobile?: string;
  isAdmin?: boolean;
  active?: boolean;
}

export interface UpdateProfileDto {
  firstName?: string;
  lastName?: string;
  phone?: string;
  phoneMobile?: string;
  currentPassword?: string;
  newPassword?: string;
}

@Injectable()
export class UsersService {
  constructor(
    private prisma: PrismaService,
    private config: ConfigService,
    private events: EventEmitter2,
  ) {}

  // ─── List staff ────────────────────────────────────────────

  async findAll(
    orgId: string,
    query: { search?: string; page?: number; limit?: number; active?: boolean },
  ) {
    const { search, page = 1, limit = 20, active } = query;
    const skip = (page - 1) * limit;

    return this.prisma.withOrganization(orgId, async (tx) => {
      const where: any = { organizationId: orgId, type: 'staff' };
      if (search) {
        where.OR = [
          { firstName: { contains: search, mode: 'insensitive' } },
          { lastName: { contains: search, mode: 'insensitive' } },
          { email: { contains: search, mode: 'insensitive' } },
        ];
      }
      if (active !== undefined) where.active = active;

      const [data, total] = await Promise.all([
        tx.user.findMany({
          where,
          skip,
          take: limit,
          orderBy: [{ firstName: 'asc' }, { lastName: 'asc' }],
          select: {
            id: true,
            email: true,
            firstName: true,
            lastName: true,
            phone: true,
            isAdmin: true,
            active: true,
            lastLogin: true,
            twoFaEnabled: true,
            role: { select: { id: true, name: true } },
          },
        }),
        tx.user.count({ where }),
      ]);

      return { data, total, page, limit, totalPages: Math.ceil(total / limit) };
    });
  }

  // ─── Get single staff member ────────────────────────────────

  async findOne(orgId: string, id: string) {
    return this.prisma.withOrganization(orgId, async (tx) => {
      const user = await tx.user.findFirst({
        where: { id, organizationId: orgId, type: 'staff' },
        select: {
          id: true,
          email: true,
          firstName: true,
          lastName: true,
          phone: true,
          phoneMobile: true,
          isAdmin: true,
          active: true,
          lastLogin: true,
          twoFaEnabled: true,
          createdAt: true,
          role: { select: { id: true, name: true } },
        },
      });
      if (!user) throw new NotFoundException('User not found');
      return user;
    });
  }

  // ─── Create staff member ────────────────────────────────────

  async create(orgId: string, dto: CreateUserDto) {
    const existing = await this.prisma.user.findFirst({
      where: { email: dto.email },
    });
    if (existing) throw new ConflictException('A user with this email already exists');

    const password = dto.password ?? Math.random().toString(36).slice(-12);
    const hash = await bcrypt.hash(password, 12);

    return this.prisma.withOrganization(orgId, async (tx) => {
      return tx.user.create({
        data: {
          organizationId: orgId,
          email: dto.email,
          password: hash,
          passwordFormat: 'bcrypt',
          firstName: dto.firstName,
          lastName: dto.lastName,
          phone: dto.phone,
          phoneMobile: dto.phoneMobile,
          roleId: dto.roleId,
          isAdmin: dto.isAdmin ?? false,
          type: 'staff',
          active: true,
        },
        select: {
          id: true,
          email: true,
          firstName: true,
          lastName: true,
          isAdmin: true,
          active: true,
          role: { select: { id: true, name: true } },
        },
      });
    });
  }

  // ─── Update staff member ────────────────────────────────────

  async update(orgId: string, id: string, dto: UpdateUserDto) {
    await this.findOne(orgId, id);
    return this.prisma.withOrganization(orgId, async (tx) => {
      return tx.user.update({
        where: { id },
        data: dto,
        select: {
          id: true,
          email: true,
          firstName: true,
          lastName: true,
          isAdmin: true,
          active: true,
          role: { select: { id: true, name: true } },
        },
      });
    });
  }

  // ─── Delete staff member ────────────────────────────────────

  async delete(orgId: string, id: string, requestingUserId: string) {
    if (id === requestingUserId) {
      throw new BadRequestException('You cannot delete your own account');
    }
    await this.findOne(orgId, id);
    await this.prisma.withOrganization(orgId, async (tx) => {
      await tx.user.delete({ where: { id } });
    });
  }

  // ─── Toggle active ──────────────────────────────────────────

  async toggleActive(orgId: string, id: string, requestingUserId: string) {
    if (id === requestingUserId) {
      throw new BadRequestException('You cannot deactivate your own account');
    }
    const user = await this.findOne(orgId, id);
    return this.prisma.withOrganization(orgId, async (tx) => {
      return tx.user.update({
        where: { id },
        data: { active: !(user as any).active },
        select: { id: true, active: true },
      });
    });
  }

  // ─── Profile (self) ─────────────────────────────────────────

  async updateProfile(orgId: string, userId: string, dto: UpdateProfileDto) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new NotFoundException();

    const updateData: any = {};
    if (dto.firstName) updateData.firstName = dto.firstName;
    if (dto.lastName) updateData.lastName = dto.lastName;
    if (dto.phone !== undefined) updateData.phone = dto.phone;
    if (dto.phoneMobile !== undefined) updateData.phoneMobile = dto.phoneMobile;

    if (dto.newPassword) {
      if (!dto.currentPassword) {
        throw new BadRequestException('Current password is required to set a new password');
      }
      const valid = await bcrypt.compare(dto.currentPassword, user.password ?? '');
      if (!valid) throw new BadRequestException('Current password is incorrect');
      updateData.password = await bcrypt.hash(dto.newPassword, 12);
      updateData.passwordFormat = 'bcrypt';
    }

    return this.prisma.user.update({
      where: { id: userId },
      data: updateData,
      select: {
        id: true,
        email: true,
        firstName: true,
        lastName: true,
        phone: true,
        phoneMobile: true,
        isAdmin: true,
        twoFaEnabled: true,
        role: { select: { id: true, name: true } },
      },
    });
  }

  // ─── Reset password (admin action) ─────────────────────────

  async resetPassword(orgId: string, id: string, newPassword: string) {
    await this.findOne(orgId, id);
    const hash = await bcrypt.hash(newPassword, 12);
    await this.prisma.withOrganization(orgId, async (tx) => {
      await tx.user.update({
        where: { id },
        data: { password: hash, passwordFormat: 'bcrypt' },
      });
    });
  }

  // ─── Sessions ───────────────────────────────────────────────

  async getSessions(userId: string) {
    return this.prisma.userSession.findMany({
      where: { userId },
      select: { id: true, createdAt: true, expiresAt: true },
      orderBy: { createdAt: 'desc' },
    });
  }

  async revokeAllSessions(userId: string) {
    await this.prisma.userSession.deleteMany({ where: { userId } });
  }

  // ─── Dashboard Layout ───────────────────────────────────────

  async getDashboardLayout(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { dashboardLayout: true },
    });
    if (!user) throw new NotFoundException('User not found');
    return user.dashboardLayout ?? null;
  }

  async updateDashboardLayout(userId: string, layout: any) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new NotFoundException('User not found');
    return this.prisma.user.update({
      where: { id: userId },
      data: { dashboardLayout: layout },
      select: { id: true, dashboardLayout: true },
    });
  }

  // ─── Email change flow ─────────────────────────────────────

  async requestEmailChange(userId: string, newEmail: string) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new NotFoundException('User not found');

    const existing = await this.prisma.user.findFirst({
      where: {
        organizationId: user.organizationId,
        email: newEmail,
        NOT: { id: userId },
      },
    });
    if (existing) {
      throw new ConflictException('Email is already taken in this organization.');
    }

    const token = crypto.randomBytes(32).toString('hex');
    const expires = new Date(Date.now() + 60 * 60 * 1000); // 1 hour

    try {
      await this.prisma.user.update({
        where: { id: userId },
        data: {
          pendingEmail: newEmail,
          pendingEmailToken: token,
          pendingEmailExpires: expires,
        } as any,
      });
    } catch (err: any) {
      // Surface a friendly 503 if the migration hasn't been applied yet.
      throw new ServiceUnavailableException(
        'Email change not yet enabled — database migration required',
      );
    }

    const appUrl = this.config.get('APP_URL') ?? process.env.APP_URL ?? '';
    const confirmUrl = `${appUrl}/portal/confirm-email?token=${token}`;
    this.events.emit('auth.email_change_requested', {
      user: { ...user, email: newEmail },
      token,
      confirmUrl,
    });

    return { message: 'Confirmation email sent to the new address.' };
  }

  // ─── Permission catalogue ──────────────────────────────────────────────

  /**
   * Canonical list of every permission string the app recognises.
   * Shape: `{ modules: { [group]: string[] } }` to match the
   * existing roles controller response. Kept in-sync with the
   * `@Permissions(...)` decorators sprinkled across controllers.
   */
  getPermissionsCatalog() {
    return {
      modules: {
        clients: [
          'clients.view',
          'clients.create',
          'clients.edit',
          'clients.delete',
        ],
        leads: [
          'leads.view',
          'leads.create',
          'leads.edit',
          'leads.delete',
        ],
        invoices: [
          'invoices.view',
          'invoices.create',
          'invoices.edit',
          'invoices.delete',
          'invoices.send',
        ],
        estimates: [
          'estimates.view',
          'estimates.create',
          'estimates.edit',
          'estimates.delete',
          'estimates.send',
        ],
        proposals: [
          'proposals.view',
          'proposals.create',
          'proposals.edit',
          'proposals.delete',
          'proposals.send',
        ],
        projects: [
          'projects.view',
          'projects.create',
          'projects.edit',
          'projects.delete',
        ],
        tasks: [
          'tasks.view',
          'tasks.create',
          'tasks.edit',
          'tasks.delete',
        ],
        tickets: [
          'tickets.view',
          'tickets.create',
          'tickets.edit',
          'tickets.delete',
          'tickets.assign',
        ],
        contracts: [
          'contracts.view',
          'contracts.create',
          'contracts.edit',
          'contracts.delete',
        ],
        expenses: [
          'expenses.view',
          'expenses.create',
          'expenses.edit',
          'expenses.delete',
        ],
        payments: ['payments.view', 'payments.create'],
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

  private flattenCatalog(): string[] {
    const catalog = this.getPermissionsCatalog();
    return Object.values(catalog.modules).flat();
  }

  private rolePermissionStrings(
    rolePermissions: any,
  ): string[] {
    const out: string[] = [];
    if (!rolePermissions || typeof rolePermissions !== 'object') return out;
    for (const [resource, actions] of Object.entries(rolePermissions)) {
      if (!actions || typeof actions !== 'object') continue;
      for (const [action, on] of Object.entries(actions as Record<string, any>)) {
        if (on === true) out.push(`${resource}.${action}`);
      }
    }
    return out;
  }

  async getEffectivePermissions(orgId: string, userId: string) {
    // Load the user + role. This uses the same tenant-scoped pattern as
    // findOne but also includes the full role.permissions json.
    const user = await this.prisma.withOrganization(orgId, async (tx) => {
      return tx.user.findFirst({
        where: { id: userId, organizationId: orgId, type: 'staff' },
        include: { role: { select: { id: true, name: true, permissions: true } } },
      });
    });
    if (!user) throw new NotFoundException('User not found');

    const rolePermissions = this.rolePermissionStrings(
      (user.role as any)?.permissions,
    );

    let overrides: Array<{ permission: string; grant: boolean }> = [];
    try {
      overrides = await (this.prisma as any).userPermissionOverride.findMany({
        where: { userId },
        select: { permission: true, grant: true },
        orderBy: { permission: 'asc' },
      });
    } catch {
      // Table likely doesn't exist yet — migration pending. Fall back.
      overrides = [];
    }

    // Compute the effective set: start from role, apply overrides.
    const eff = new Set(rolePermissions);
    for (const o of overrides) {
      if (o.grant) eff.add(o.permission);
      else eff.delete(o.permission);
    }

    return {
      rolePermissions,
      overrides,
      effective: Array.from(eff).sort(),
    };
  }

  async replacePermissionOverrides(
    orgId: string,
    userId: string,
    overrides: Array<{ permission: string; grant: boolean }>,
  ) {
    // Validate user belongs to org
    await this.findOne(orgId, userId);

    // Filter out invalid entries (unknown permission strings silently drop).
    const catalog = new Set(this.flattenCatalog());
    const clean = overrides.filter(
      (o) =>
        o &&
        typeof o.permission === 'string' &&
        catalog.has(o.permission) &&
        typeof o.grant === 'boolean',
    );

    await (this.prisma as any).$transaction(async (tx: any) => {
      await tx.userPermissionOverride.deleteMany({ where: { userId } });
      if (clean.length > 0) {
        await tx.userPermissionOverride.createMany({
          data: clean.map((o) => ({
            userId,
            permission: o.permission,
            grant: o.grant,
          })),
        });
      }
    });

    return this.getEffectivePermissions(orgId, userId);
  }

  // ─── Email change flow (continued) ─────────────────────────

  async confirmEmailChange(token: string) {
    let user: any;
    try {
      user = await (this.prisma.user as any).findFirst({
        where: { pendingEmailToken: token },
      });
    } catch (err: any) {
      throw new ServiceUnavailableException(
        'Email change not yet enabled — database migration required',
      );
    }

    if (!user) throw new BadRequestException('Invalid or expired token');
    const expires = user.pendingEmailExpires;
    if (!expires || new Date(expires) < new Date()) {
      throw new BadRequestException('Invalid or expired token');
    }
    if (!user.pendingEmail) {
      throw new BadRequestException('No pending email to confirm');
    }

    try {
      await this.prisma.user.update({
        where: { id: user.id },
        data: {
          email: user.pendingEmail,
          pendingEmail: null,
          pendingEmailToken: null,
          pendingEmailExpires: null,
        } as any,
      });
    } catch (err: any) {
      throw new ServiceUnavailableException(
        'Email change not yet enabled — database migration required',
      );
    }

    return { message: 'Email updated successfully.' };
  }
}
