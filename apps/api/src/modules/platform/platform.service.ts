import {
  Injectable,
  UnauthorizedException,
  NotFoundException,
  ConflictException,
  BadRequestException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../../database/prisma.service';
import * as bcrypt from 'bcrypt';

export interface CreatePlatformAdminDto {
  email: string;
  password: string;
  name: string;
}

@Injectable()
export class PlatformService {
  constructor(
    private prisma: PrismaService,
    private jwt: JwtService,
    private config: ConfigService,
  ) {}

  // ─── Auth ──────────────────────────────────────────────────

  async validate(email: string, password: string) {
    const admin = await this.prisma.platformAdmin.findUnique({ where: { email } });
    if (!admin) return null;
    const valid = await bcrypt.compare(password, admin.password);
    if (!valid) return null;
    return admin;
  }

  async login(email: string, password: string) {
    const admin = await this.validate(email, password);
    if (!admin) throw new UnauthorizedException('Invalid credentials');

    const accessToken = this.jwt.sign(
      {
        sub: admin.id,
        email: admin.email,
        name: admin.name,
        aud: 'platform',
        type: 'platform_admin',
      },
      { expiresIn: '8h' },
    );

    return {
      accessToken,
      admin: { id: admin.id, email: admin.email, name: admin.name },
    };
  }

  async createAdmin(dto: CreatePlatformAdminDto) {
    const existing = await this.prisma.platformAdmin.findUnique({
      where: { email: dto.email },
    });
    if (existing) throw new ConflictException('Email already registered as platform admin');

    const hash = await bcrypt.hash(dto.password, 12);
    return this.prisma.platformAdmin.create({
      data: { email: dto.email, password: hash, name: dto.name },
      select: { id: true, email: true, name: true, createdAt: true },
    });
  }

  async listAdmins() {
    return this.prisma.platformAdmin.findMany({
      select: { id: true, email: true, name: true, createdAt: true },
      orderBy: { createdAt: 'desc' },
    });
  }

  async deleteAdmin(id: string) {
    const count = await this.prisma.platformAdmin.count();
    if (count <= 1) {
      throw new BadRequestException('Cannot delete the last platform admin');
    }
    await this.prisma.platformAdmin.delete({ where: { id } });
  }

  // ─── Organization management ───────────────────────────────

  async listOrganizations(query: { search?: string; status?: string; page?: number; limit?: number }) {
    const { search, status, page = 1, limit = 20 } = query;
    const skip = (page - 1) * limit;

    const where: any = {};
    if (search) {
      where.OR = [
        { name: { contains: search, mode: 'insensitive' } },
        { slug: { contains: search, mode: 'insensitive' } },
      ];
    }
    if (status) where.subscriptionStatus = status;

    const [data, total] = await Promise.all([
      this.prisma.organization.findMany({
        where,
        skip,
        take: limit,
        orderBy: { createdAt: 'desc' },
        select: {
          id: true,
          name: true,
          slug: true,
          customDomain: true,
          subscriptionStatus: true,
          subscriptionPlan: true,
          trialEndsAt: true,
          createdAt: true,
          _count: {
            select: {
              users: true,
              clients: true,
              invoices: true,
              projects: true,
            },
          },
        },
      }),
      this.prisma.organization.count({ where }),
    ]);

    return { data, total, page, limit, totalPages: Math.ceil(total / limit) };
  }

  async getOrganization(id: string) {
    const org = await this.prisma.organization.findUnique({
      where: { id },
      include: {
        users: {
          where: { type: 'staff' },
          select: {
            id: true,
            email: true,
            firstName: true,
            lastName: true,
            isAdmin: true,
            active: true,
            lastLogin: true,
            createdAt: true,
          },
        },
        _count: {
          select: {
            users: true,
            clients: true,
            invoices: true,
            projects: true,
            tickets: true,
            leads: true,
          },
        },
      },
    });
    if (!org) throw new NotFoundException('Organization not found');
    return org;
  }

  async suspendOrganization(id: string) {
    return this.prisma.organization.update({
      where: { id },
      data: { subscriptionStatus: 'suspended' },
    });
  }

  async activateOrganization(id: string) {
    return this.prisma.organization.update({
      where: { id },
      data: { subscriptionStatus: 'active' },
    });
  }

  async deleteOrganization(id: string) {
    // Cascade delete handled by Prisma
    return this.prisma.organization.delete({ where: { id } });
  }

  async extendTrial(id: string, days: number) {
    const org = await this.prisma.organization.findUnique({ where: { id } });
    if (!org) throw new NotFoundException();
    const currentEnd = org.trialEndsAt ?? new Date();
    const newEnd = new Date(currentEnd.getTime() + days * 24 * 60 * 60 * 1000);
    return this.prisma.organization.update({
      where: { id },
      data: { trialEndsAt: newEnd, subscriptionStatus: 'trialing' },
    });
  }

  // ─── Impersonate: generate a JWT as an org admin ───────────

  async impersonateOrgAdmin(orgId: string) {
    const user = await this.prisma.user.findFirst({
      where: { organizationId: orgId, type: 'staff', isAdmin: true, active: true },
      orderBy: { createdAt: 'asc' },
    });
    if (!user) throw new NotFoundException('No active admin user for this organization');

    const accessToken = this.jwt.sign(
      {
        sub: user.id,
        orgId: user.organizationId,
        type: user.type,
        aud: 'staff',
        isAdmin: true,
        roleId: user.roleId,
        impersonated: true,
      },
      { expiresIn: '1h' },
    );

    return { accessToken, user };
  }

  // ─── Platform-wide stats ───────────────────────────────────

  async getStats() {
    const [
      totalOrgs,
      trialingOrgs,
      activeOrgs,
      suspendedOrgs,
      totalUsers,
      totalClients,
      totalInvoices,
      newOrgsThisMonth,
    ] = await Promise.all([
      this.prisma.organization.count(),
      this.prisma.organization.count({ where: { subscriptionStatus: 'trialing' } }),
      this.prisma.organization.count({ where: { subscriptionStatus: 'active' } }),
      this.prisma.organization.count({ where: { subscriptionStatus: 'suspended' } }),
      this.prisma.user.count({ where: { type: 'staff' } }),
      this.prisma.client.count(),
      this.prisma.invoice.count(),
      this.prisma.organization.count({
        where: {
          createdAt: { gte: new Date(new Date().getFullYear(), new Date().getMonth(), 1) },
        },
      }),
    ]);

    return {
      totalOrgs,
      trialingOrgs,
      activeOrgs,
      suspendedOrgs,
      totalUsers,
      totalClients,
      totalInvoices,
      newOrgsThisMonth,
    };
  }

  async getRecentOrganizations(limit = 10) {
    return this.prisma.organization.findMany({
      take: limit,
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        name: true,
        slug: true,
        subscriptionStatus: true,
        createdAt: true,
        _count: { select: { users: true, clients: true } },
      },
    });
  }
}
