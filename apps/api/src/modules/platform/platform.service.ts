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
import * as bcrypt from 'bcryptjs';

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

  // ─── Subscription Plans management ─────────────────────────

  async listPlans() {
    return this.prisma.platformPlan.findMany({
      orderBy: { order: 'asc' },
    });
  }

  async getPlan(id: string) {
    const plan = await this.prisma.platformPlan.findUnique({ where: { id } });
    if (!plan) throw new NotFoundException('Plan not found');
    return plan;
  }

  async createPlan(dto: {
    name: string;
    slug: string;
    description?: string;
    monthlyPrice: number;
    yearlyPrice?: number;
    currency?: string;
    maxStaff?: number;
    maxClients?: number;
    maxActiveProjects?: number;
    maxStorageMB?: number;
    features?: string[];
    active?: boolean;
    public?: boolean;
    order?: number;
  }) {
    return this.prisma.platformPlan.create({
      data: {
        name: dto.name,
        slug: dto.slug,
        description: dto.description,
        monthlyPrice: dto.monthlyPrice,
        yearlyPrice: dto.yearlyPrice ?? dto.monthlyPrice * 10,
        currency: dto.currency ?? 'USD',
        maxStaff: dto.maxStaff ?? 5,
        maxClients: dto.maxClients ?? 50,
        maxActiveProjects: dto.maxActiveProjects ?? 10,
        maxStorageMB: dto.maxStorageMB ?? 1000,
        features: dto.features ?? [],
        active: dto.active ?? true,
        public: dto.public ?? true,
        order: dto.order ?? 0,
      },
    });
  }

  async updatePlan(id: string, dto: any) {
    await this.getPlan(id);
    return this.prisma.platformPlan.update({
      where: { id },
      data: dto,
    });
  }

  async deletePlan(id: string) {
    const plan = await this.getPlan(id);
    const orgsUsing = await this.prisma.organization.count({
      where: { subscriptionPlan: { in: [plan.slug, plan.name] } },
    });
    if (orgsUsing > 0) {
      throw new BadRequestException(
        `Cannot delete plan: ${orgsUsing} organization(s) still subscribed`,
      );
    }
    await this.prisma.platformPlan.delete({ where: { id } });
  }

  // ─── Platform billing / revenue ────────────────────────────

  async getBillingStats() {
    const [orgs, trialOrgs, activeOrgs, canceledOrgs, pastDueOrgs] = await Promise.all([
      this.prisma.organization.findMany({
        select: {
          id: true,
          subscriptionStatus: true,
          subscriptionPlan: true,
          currentPeriodEnd: true,
        },
      }),
      this.prisma.organization.count({ where: { subscriptionStatus: 'trialing' } }),
      this.prisma.organization.count({ where: { subscriptionStatus: 'active' } }),
      this.prisma.organization.count({ where: { subscriptionStatus: 'canceled' } }),
      this.prisma.organization.count({ where: { subscriptionStatus: 'past_due' } }),
    ]);

    const plans = await this.prisma.platformPlan.findMany();
    const planMap = new Map(plans.map((p) => [p.slug, p]));

    let mrr = 0;
    for (const org of orgs) {
      if (org.subscriptionStatus === 'active' && org.subscriptionPlan) {
        const plan = planMap.get(org.subscriptionPlan);
        if (plan) mrr += Number(plan.monthlyPrice);
      }
    }

    return {
      mrr,
      arr: mrr * 12,
      trialOrgs,
      activeOrgs,
      canceledOrgs,
      pastDueOrgs,
      totalPayingOrgs: activeOrgs,
      churnRate: orgs.length > 0 ? (canceledOrgs / orgs.length) * 100 : 0,
    };
  }

  async getRevenueByMonth(months = 12) {
    const result: any[] = await this.prisma.$queryRawUnsafe(`
      SELECT
        TO_CHAR(DATE_TRUNC('month', "currentPeriodEnd"), 'YYYY-MM') as period,
        COUNT(*)::int as org_count
      FROM organizations
      WHERE "subscriptionStatus" = 'active'
        AND "currentPeriodEnd" IS NOT NULL
        AND "currentPeriodEnd" >= NOW() - INTERVAL '${Number(months)} months'
      GROUP BY period
      ORDER BY period DESC
    `);
    return result;
  }

  async getOrgsByPlan() {
    const plans = await this.prisma.platformPlan.findMany({ orderBy: { order: 'asc' } });
    const counts = await Promise.all(
      plans.map(async (plan) => ({
        planId: plan.id,
        planName: plan.name,
        planSlug: plan.slug,
        count: await this.prisma.organization.count({
          where: { subscriptionPlan: plan.slug, subscriptionStatus: 'active' },
        }),
        monthlyPrice: Number(plan.monthlyPrice),
        mrr: 0, // filled below
      })),
    );
    for (const c of counts) {
      c.mrr = c.count * c.monthlyPrice;
    }
    return counts;
  }

  // ─── Assign plan to org (admin override) ───────────────────

  async assignPlanToOrg(orgId: string, planSlug: string) {
    return this.prisma.organization.update({
      where: { id: orgId },
      data: {
        subscriptionPlan: planSlug,
        subscriptionStatus: 'active',
      },
    });
  }
}
