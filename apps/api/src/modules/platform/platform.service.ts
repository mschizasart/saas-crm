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
import { authenticator } from 'otplib';
import * as QRCode from 'qrcode';
import { encrypt, decrypt } from '../../common/crypto/encrypt';
import {
  generateRecoveryCodes,
  hashRecoveryCodes,
  consumeRecoveryCode,
} from '../auth/twofa.util';

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

    if ((admin as any).twoFactorEnabled) {
      // Defer the real session — caller must complete 2FA via /platform/2fa/login
      const twoFactorToken = this.jwt.sign(
        { sub: admin.id, purpose: '2fa', aud: 'platform' },
        { expiresIn: '5m' },
      );
      return { requires2fa: true, twoFactorToken };
    }

    return this.issueAdminTokens(admin);
  }

  /** Internal: mint the platform-admin access token + admin payload. */
  private issueAdminTokens(admin: { id: string; email: string; name: string }) {
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

  // ─── Platform admin 2FA ────────────────────────────────────────

  async getTwoFaStatus(adminId: string) {
    const admin = await this.prisma.platformAdmin.findUnique({
      where: { id: adminId },
      select: {
        twoFactorEnabled: true,
        twoFactorEnrolledAt: true,
        twoFactorRecoveryCodes: true,
      },
    });
    if (!admin) throw new NotFoundException();
    const recoveryCount = Array.isArray(admin.twoFactorRecoveryCodes)
      ? (admin.twoFactorRecoveryCodes as unknown[]).length
      : 0;
    return {
      enabled: !!admin.twoFactorEnabled,
      enrolledAt: admin.twoFactorEnrolledAt,
      recoveryCodesRemaining: recoveryCount,
    };
  }


  private getEncryptionKey(): string {
    const key = this.config.get<string>('ENCRYPTION_KEY');
    if (!key) {
      throw new BadRequestException(
        'Server is missing ENCRYPTION_KEY — 2FA cannot be enabled.',
      );
    }
    return key;
  }

  /** Generate + persist (unverified) a fresh TOTP secret for a platform admin. */
  async setupTwoFa(adminId: string) {
    const admin = await this.prisma.platformAdmin.findUnique({
      where: { id: adminId },
    });
    if (!admin) throw new NotFoundException();

    const secret = authenticator.generateSecret();
    const otpauthUrl = authenticator.keyuri(
      admin.email,
      this.config.get('APP_NAME', 'AppoinlyCRM') + ' (Platform)',
      secret,
    );
    const qrDataUrl = await QRCode.toDataURL(otpauthUrl);

    const encrypted = encrypt(secret, this.getEncryptionKey());

    await this.prisma.platformAdmin.update({
      where: { id: adminId },
      data: {
        twoFactorSecret: encrypted,
        twoFactorEnabled: false,
        twoFactorRecoveryCodes: [] as any,
        twoFactorEnrolledAt: null,
      },
    });

    return { secret, otpauthUrl, qrDataUrl };
  }

  async verifySetupTwoFa(adminId: string, code: string) {
    const admin = await this.prisma.platformAdmin.findUnique({
      where: { id: adminId },
    });
    if (!admin?.twoFactorSecret) {
      throw new BadRequestException('2FA setup has not been initialised.');
    }

    const secret = decrypt(admin.twoFactorSecret, this.getEncryptionKey());
    if (!authenticator.verify({ token: code.trim(), secret })) {
      throw new BadRequestException('Invalid verification code.');
    }

    const recoveryCodes = generateRecoveryCodes(10);
    const hashed = await hashRecoveryCodes(recoveryCodes);

    await this.prisma.platformAdmin.update({
      where: { id: adminId },
      data: {
        twoFactorEnabled: true,
        twoFactorEnrolledAt: new Date(),
        twoFactorRecoveryCodes: hashed,
      },
    });

    return { recoveryCodes };
  }

  async disableTwoFa(adminId: string, password: string, code: string) {
    const admin = await this.prisma.platformAdmin.findUnique({
      where: { id: adminId },
    });
    if (!admin) throw new UnauthorizedException();
    if (!admin.twoFactorEnabled || !admin.twoFactorSecret) {
      throw new BadRequestException('2FA is not enabled.');
    }

    const passwordOk = await bcrypt.compare(password, admin.password);
    if (!passwordOk) throw new UnauthorizedException('Invalid password.');

    const secret = decrypt(admin.twoFactorSecret, this.getEncryptionKey());
    if (!authenticator.verify({ token: code.trim(), secret })) {
      throw new UnauthorizedException('Invalid verification code.');
    }

    await this.prisma.platformAdmin.update({
      where: { id: adminId },
      data: {
        twoFactorEnabled: false,
        twoFactorSecret: null,
        twoFactorRecoveryCodes: [] as any,
        twoFactorEnrolledAt: null,
      },
    });

    return { ok: true };
  }

  async regenerateRecoveryTwoFa(adminId: string, code: string) {
    const admin = await this.prisma.platformAdmin.findUnique({
      where: { id: adminId },
    });
    if (!admin?.twoFactorEnabled || !admin.twoFactorSecret) {
      throw new BadRequestException('2FA is not enabled.');
    }
    const secret = decrypt(admin.twoFactorSecret, this.getEncryptionKey());
    if (!authenticator.verify({ token: code.trim(), secret })) {
      throw new UnauthorizedException('Invalid verification code.');
    }

    const recoveryCodes = generateRecoveryCodes(10);
    const hashed = await hashRecoveryCodes(recoveryCodes);

    await this.prisma.platformAdmin.update({
      where: { id: adminId },
      data: { twoFactorRecoveryCodes: hashed },
    });

    return { recoveryCodes };
  }

  /** Step 2 of platform login when admin has 2FA enabled. */
  async loginTwoFa(twoFactorToken: string, code: string) {
    let payload: any;
    try {
      payload = this.jwt.verify(twoFactorToken);
    } catch {
      throw new UnauthorizedException('Invalid or expired 2FA token.');
    }
    if (payload.purpose !== '2fa' || payload.aud !== 'platform' || !payload.sub) {
      throw new UnauthorizedException('Invalid 2FA token.');
    }

    const admin = await this.prisma.platformAdmin.findUnique({
      where: { id: payload.sub },
    });
    if (!admin || !admin.twoFactorEnabled || !admin.twoFactorSecret) {
      throw new UnauthorizedException();
    }

    const secret = decrypt(admin.twoFactorSecret, this.getEncryptionKey());
    const trimmed = (code ?? '').trim();
    const totpOk =
      trimmed.length === 6 && /^\d{6}$/.test(trimmed)
        ? authenticator.verify({ token: trimmed, secret })
        : false;

    if (!totpOk) {
      const hashes = Array.isArray(admin.twoFactorRecoveryCodes)
        ? (admin.twoFactorRecoveryCodes as unknown as string[])
        : [];
      const idx = await consumeRecoveryCode(trimmed, hashes);
      if (idx === -1) {
        throw new UnauthorizedException('Invalid verification code.');
      }
      const remaining = [...hashes];
      remaining.splice(idx, 1);
      await this.prisma.platformAdmin.update({
        where: { id: admin.id },
        data: { twoFactorRecoveryCodes: remaining as any },
      });
    }

    return this.issueAdminTokens(admin);
  }

  // ─── Operator: reset 2FA on a tenant user (escape hatch) ─────────
  //
  // When a staff user loses both their authenticator AND their recovery
  // codes, they cannot self-recover. A platform admin can wipe their
  // 2FA settings here so they can log in with just the password and
  // re-enrol. This is intentionally only exposed to platform admins
  // (NOT to org admins), to keep the blast radius small.

  async resetUserTwoFa(userId: string) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new NotFoundException('User not found');

    await this.prisma.user.update({
      where: { id: userId },
      data: {
        twoFactorEnabled: false,
        twoFactorSecret: null,
        twoFactorRecoveryCodes: [] as any,
        twoFactorEnrolledAt: null,
        // Also clear the legacy fields to be safe.
        twoFaEnabled: false,
        twoFaSecret: null,
      },
    });

    return { ok: true, userId };
  }

  /** Reset 2FA on another platform admin (cannot reset yourself this way). */
  async resetAdminTwoFa(targetAdminId: string, requesterId: string) {
    if (targetAdminId === requesterId) {
      throw new BadRequestException(
        'Use the disable-2FA flow from your own account instead.',
      );
    }
    const admin = await this.prisma.platformAdmin.findUnique({
      where: { id: targetAdminId },
    });
    if (!admin) throw new NotFoundException('Platform admin not found');

    await this.prisma.platformAdmin.update({
      where: { id: targetAdminId },
      data: {
        twoFactorEnabled: false,
        twoFactorSecret: null,
        twoFactorRecoveryCodes: [] as any,
        twoFactorEnrolledAt: null,
      },
    });

    return { ok: true, adminId: targetAdminId };
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
