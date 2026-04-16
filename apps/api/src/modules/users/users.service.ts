import {
  Injectable,
  NotFoundException,
  ConflictException,
  BadRequestException,
} from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service';
import * as bcrypt from 'bcryptjs';

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
  constructor(private prisma: PrismaService) {}

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
}
