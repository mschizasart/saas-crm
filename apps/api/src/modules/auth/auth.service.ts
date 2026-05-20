import {
  Injectable,
  UnauthorizedException,
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { EventEmitter2 } from '@nestjs/event-emitter';
import * as bcrypt from 'bcryptjs';
import { authenticator } from 'otplib';
import * as QRCode from 'qrcode';
import { PrismaService } from '../../database/prisma.service';
import { RegisterOrganizationDto, PortalRegisterDto } from './dto/auth.dto';
import { seedOrganization } from '../../../prisma/seed-org';

@Injectable()
export class AuthService {
  constructor(
    private prisma: PrismaService,
    private jwt: JwtService,
    private config: ConfigService,
    private events: EventEmitter2,
  ) {}

  // ─── Validate credentials ──────────────────────────────────

  async validateUser(email: string, password: string) {
    // Email is only unique PER ORG (@@unique([organizationId, email])), so the
    // same address can map to several User rows (one per org). `findFirst`
    // here was non-deterministic — it could return a row whose password
    // differs from the one the user typed, producing a spurious "invalid
    // credentials" even for a correct password. Iterate every candidate and
    // return the first whose password matches.
    const candidates = await this.prisma.user.findMany({
      where: { email, active: true },
      include: { role: true },
      orderBy: { createdAt: 'asc' },
    });

    for (const user of candidates) {
      if (!user.password) continue;

      let valid = false;
      if (user.passwordFormat === 'bcrypt') {
        valid = await bcrypt.compare(password, user.password);
      } else if (user.passwordFormat === 'phpass') {
        // Migrated Perfex users — node-phpass must be installed separately.
        // For now, treat as invalid to trigger the password-reset flow.
        valid = false;
      }

      if (valid) return user;
    }

    return null;
  }

  // ─── Login ─────────────────────────────────────────────────

  async login(user: any) {
    // If the user has TOTP-based 2FA enabled (new flow), short-circuit
    // before issuing a real session — the frontend must POST the TOTP code
    // (or a recovery code) to /auth/2fa/login with the returned token.
    // The org-selection step (when the user belongs to multiple orgs) is
    // handled by `twofa.service.ts#loginWithCode` AFTER the code is verified.
    if (user.twoFactorEnabled) {
      const twoFactorToken = this.jwt.sign(
        { sub: user.id, purpose: '2fa' },
        { expiresIn: '5m' },
      );
      return { requires2fa: true, twoFactorToken };
    }

    // Legacy 2FA scaffolding (twoFaEnabled). Still honoured so existing
    // rows aren't locked out, but new enrolments use twoFactorEnabled.
    if (user.twoFaEnabled) {
      const tempToken = this.jwt.sign(
        { sub: user.id, orgId: user.organizationId, step: '2fa' },
        { expiresIn: '5m' },
      );
      return { requires2fa: true, tempToken };
    }

    // Multi-org check: if the user has 2+ accepted memberships, return a
    // short-lived org-selection token instead of an access token. The
    // frontend POSTs to /auth/select-org with the chosen orgId.
    const orgChoice = await this.resolveLoginOrg(user);
    if (orgChoice.requiresOrgSelection) {
      return orgChoice;
    }

    // Update last login only when we're actually issuing a session.
    await this.prisma.user.update({
      where: { id: user.id },
      data: { lastLogin: new Date() },
    });

    return this.generateTokenPair({ ...user, organizationId: orgChoice.organizationId });
  }

  /**
   * Decide which org a freshly-authenticated user should land in.
   *  - 0 memberships → fall back to `user.organizationId` (legacy single-org
   *    users that pre-date the join table). Defensive — backfill should
   *    eliminate this case in practice.
   *  - 1 membership  → that org, no picker.
   *  - 2+ memberships → return a `requiresOrgSelection` envelope with a
   *    short-lived selection token; the caller will NOT issue an access
   *    token. The frontend resumes via POST /auth/select-org.
   */
  async resolveLoginOrg(user: any): Promise<
    | {
        requiresOrgSelection: false;
        organizationId: string;
      }
    | {
        requiresOrgSelection: true;
        orgSelectionToken: string;
        memberships: Array<{
          orgId: string;
          orgName: string;
          orgSlug: string;
          role: string;
          isPrimary: boolean;
        }>;
      }
  > {
    const memberships = await this.prisma.userOrganizationMembership.findMany({
      where: { userId: user.id, acceptedAt: { not: null } },
      include: {
        organization: { select: { id: true, name: true, slug: true } },
      },
    });

    if (memberships.length === 0) {
      // Backward-compat: no rows in the join table → trust the legacy
      // `User.organizationId`. Should be impossible after the backfill,
      // but guard anyway.
      return {
        requiresOrgSelection: false,
        organizationId: user.organizationId,
      };
    }

    if (memberships.length === 1) {
      return {
        requiresOrgSelection: false,
        organizationId: memberships[0].organizationId,
      };
    }

    // 2+ orgs → ask the user which one to log into. Issue a short JWT
    // that the client echoes back to /auth/select-org. The purpose claim
    // prevents accidental use as an access token.
    const orgSelectionToken = this.jwt.sign(
      { sub: user.id, purpose: 'org-select' },
      { expiresIn: '10m' },
    );

    return {
      requiresOrgSelection: true,
      orgSelectionToken,
      memberships: memberships.map((m) => ({
        orgId: m.organizationId,
        orgName: m.organization.name,
        orgSlug: m.organization.slug,
        role: m.role,
        isPrimary: m.isPrimary,
      })),
    };
  }

  /**
   * Step 3 of the multi-org login flow. The client posts the
   * org-selection JWT it received from /login (or /auth/2fa/login)
   * together with the chosen orgId. We verify:
   *   - the token is a valid `purpose:"org-select"` JWT and not expired
   *   - the user actually has an *accepted* membership in `orgId`
   * On success we mint a real access/refresh pair anchored at `orgId`.
   */
  async selectOrg(orgSelectionToken: string, orgId: string) {
    let payload: any;
    try {
      payload = this.jwt.verify(orgSelectionToken);
    } catch {
      throw new UnauthorizedException('Invalid or expired selection token');
    }
    if (payload.purpose !== 'org-select' || !payload.sub) {
      throw new UnauthorizedException('Invalid selection token');
    }

    const user = await this.prisma.user.findUnique({
      where: { id: payload.sub },
    });
    if (!user || !user.active) throw new UnauthorizedException();

    const membership = await this.prisma.userOrganizationMembership.findUnique({
      where: { userId_organizationId: { userId: user.id, organizationId: orgId } },
    });
    if (!membership || !membership.acceptedAt) {
      throw new UnauthorizedException('You do not have access to that organization');
    }

    await this.prisma.user.update({
      where: { id: user.id },
      data: { lastLogin: new Date() },
    });

    // Mint the real token pair, overriding the legacy `organizationId`
    // so the JWT.orgId reflects the *selected* tenant.
    return this.generateTokenPair({ ...user, organizationId: orgId });
  }

  /**
   * Mid-session org swap. The caller is already authenticated; this
   * re-mints their token pair with a different `orgId` claim. We verify
   * the user still has an accepted membership in the target org — an
   * admin may have revoked access since this session was issued.
   *
   * Returns the same shape as /auth/login (accessToken + refreshToken).
   */
  async switchOrg(userId: string, orgId: string) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user || !user.active) throw new UnauthorizedException();

    const membership = await this.prisma.userOrganizationMembership.findUnique({
      where: { userId_organizationId: { userId, organizationId: orgId } },
    });
    if (!membership || !membership.acceptedAt) {
      throw new UnauthorizedException('You do not have access to that organization');
    }

    return this.generateTokenPair({ ...user, organizationId: orgId });
  }

  async verify2fa(userId: string, code: string) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user?.twoFaSecret) throw new UnauthorizedException();

    const valid = authenticator.verify({
      token: code,
      secret: user.twoFaSecret,
    });
    if (!valid) throw new UnauthorizedException('Invalid 2FA code');

    // Layer the multi-org selection step after the legacy 2FA code
    // validates, mirroring twofa.service#loginWithCode. Without this,
    // multi-org users on the legacy /auth/2fa/verify path skip
    // org-selection and get dropped into their primary org by default.
    //  - 0/1 memberships → mint the access token as before.
    //  - 2+ memberships  → return the `requiresOrgSelection` envelope;
    //    the client then POSTs to /auth/select-org.
    const orgChoice = await this.resolveLoginOrg(user);
    if (orgChoice.requiresOrgSelection) {
      return orgChoice;
    }

    await this.prisma.user.update({
      where: { id: user.id },
      data: { lastLogin: new Date() },
    });

    return this.generateTokenPair({
      ...user,
      organizationId: orgChoice.organizationId,
    });
  }

  // ─── Token management ──────────────────────────────────────

  /**
   * Derive admin status for a user *within a specific org*, mirroring
   * JwtStrategy.validate so the baked `isAdmin` JWT claim agrees with the
   * per-request re-resolution.
   *
   *  - accepted membership for (userId, orgId) → admin iff role is
   *    'admin' or 'owner'.
   *  - no membership row + legacy primary org matches → fall back to the
   *    legacy `User.isAdmin` flag (backward compat for un-migrated users).
   *  - otherwise → not admin.
   */
  async resolveIsAdminForOrg(
    userId: string,
    orgId: string,
    legacyIsAdmin: boolean,
  ): Promise<boolean> {
    if (!orgId) return false;

    const membership = await this.prisma.userOrganizationMembership.findUnique({
      where: { userId_organizationId: { userId, organizationId: orgId } },
      select: { role: true, acceptedAt: true },
    });

    if (membership && membership.acceptedAt !== null) {
      return membership.role === 'admin' || membership.role === 'owner';
    }

    if (!membership) {
      const legacyUser = await this.prisma.user.findUnique({
        where: { id: userId },
        select: { organizationId: true },
      });
      if (legacyUser?.organizationId === orgId) {
        return legacyIsAdmin === true;
      }
    }

    return false;
  }

  async generateTokenPair(user: any) {
    // Resolve the `isAdmin` claim for the org the token is being minted
    // for. `user.organizationId` here is the *active* org (callers such
    // as selectOrg/switchOrg/refreshTokens override it). The User row's
    // `isAdmin` column only reflects the PRIMARY org, so we must derive
    // admin status from the membership for the active org — otherwise the
    // baked claim would disagree with JwtStrategy.validate (which
    // re-resolves per-org on every request and is authoritative).
    const isAdmin = await this.resolveIsAdminForOrg(
      user.id,
      user.organizationId,
      user.isAdmin === true,
    );

    const payload = {
      sub: user.id,
      orgId: user.organizationId,
      type: user.type,
      aud: user.type === 'contact' ? 'portal' : 'staff',
      isAdmin,
      roleId: user.roleId,
    };

    const accessToken = this.jwt.sign(payload, {
      expiresIn: this.config.get('JWT_EXPIRY', '15m'),
    });

    const refreshToken = this.jwt.sign(payload, {
      secret: this.config.get('JWT_REFRESH_SECRET'),
      expiresIn: this.config.get('JWT_REFRESH_EXPIRY', '7d'),
    });

    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
    await this.prisma.userSession.create({
      data: {
        userId: user.id,
        refreshToken,
        expiresAt,
      },
    });

    return { accessToken, refreshToken };
  }

  async refreshTokens(refreshToken: string) {
    let payload: any;
    try {
      payload = this.jwt.verify(refreshToken, {
        secret: this.config.get('JWT_REFRESH_SECRET'),
      });
    } catch {
      throw new UnauthorizedException('Invalid refresh token');
    }

    const session = await this.prisma.userSession.findUnique({
      where: { refreshToken },
    });
    if (!session || session.expiresAt < new Date()) {
      throw new UnauthorizedException('Session expired');
    }

    // Rotate refresh token
    await this.prisma.userSession.delete({ where: { id: session.id } });

    const user = await this.prisma.user.findUnique({
      where: { id: payload.sub },
    });
    if (!user || !user.active) throw new UnauthorizedException();

    // Preserve the ACTIVE org across refresh. The expiring refresh token
    // carries the org the session is anchored at (payload.orgId). Without
    // this, generateTokenPair(user) would fall back to the user's legacy
    // primary org and silently move a multi-org user out of the org they
    // switched into.
    let activeOrgId: string = payload.orgId ?? user.organizationId;

    // Defence-in-depth: verify the user still has an accepted membership in
    // the org the token is anchored at. Access could have been revoked
    // since the session was minted. If revoked, fall back to the legacy
    // primary org with a fresh token rather than hard-failing the refresh —
    // a softer mid-session UX than a 401 (the TenantInterceptor + RbacGuard
    // still gate what the user can actually touch in any org).
    if (activeOrgId && activeOrgId !== user.organizationId) {
      const membership =
        await this.prisma.userOrganizationMembership.findUnique({
          where: {
            userId_organizationId: {
              userId: user.id,
              organizationId: activeOrgId,
            },
          },
          select: { acceptedAt: true },
        });
      if (!membership || membership.acceptedAt === null) {
        activeOrgId = user.organizationId;
      }
    }

    return this.generateTokenPair({ ...user, organizationId: activeOrgId });
  }

  async logout(refreshToken: string) {
    await this.prisma.userSession.deleteMany({ where: { refreshToken } });
  }

  // ─── Password reset ────────────────────────────────────────

  async forgotPassword(email: string) {
    const user = await this.prisma.user.findFirst({ where: { email } });
    if (!user) return; // Don't reveal whether email exists

    const token = this.jwt.sign(
      { sub: user.id, purpose: 'reset' },
      { expiresIn: '1h' },
    );

    this.events.emit('auth.password_reset_requested', {
      user,
      token,
      resetUrl: `${this.config.get('APP_URL')}/reset-password?token=${token}`,
    });
  }

  async resetPassword(token: string, newPassword: string) {
    let payload: any;
    try {
      payload = this.jwt.verify(token);
    } catch {
      throw new BadRequestException('Invalid or expired reset token');
    }
    if (payload.purpose !== 'reset') throw new BadRequestException();

    const hash = await bcrypt.hash(newPassword, 12);
    await this.prisma.user.update({
      where: { id: payload.sub },
      data: { password: hash, passwordFormat: 'bcrypt' },
    });
  }

  // ─── 2FA Setup ─────────────────────────────────────────────

  async generate2faSecret(userId: string) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new NotFoundException();

    const secret = authenticator.generateSecret();
    const otpauth = authenticator.keyuri(user.email, 'AppoinlyCRM', secret);
    const qrCodeDataUrl = await QRCode.toDataURL(otpauth);

    // Store secret temporarily — only activate after verification
    await this.prisma.user.update({
      where: { id: userId },
      data: { twoFaSecret: secret, twoFaEnabled: false },
    });

    return { secret, qrCodeDataUrl };
  }

  async enable2fa(userId: string, code: string) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user?.twoFaSecret) throw new BadRequestException('2FA not initialized');

    const valid = authenticator.verify({ token: code, secret: user.twoFaSecret });
    if (!valid) throw new BadRequestException('Invalid verification code');

    await this.prisma.user.update({
      where: { id: userId },
      data: { twoFaEnabled: true },
    });
  }

  async disable2fa(userId: string) {
    await this.prisma.user.update({
      where: { id: userId },
      data: { twoFaEnabled: false, twoFaSecret: null },
    });
  }

  // ─── OAuth ─────────────────────────────────────────────────

  async handleOAuthLogin(oauthUser: any, organizationId: string) {
    let user = await this.prisma.user.findFirst({
      where: {
        organizationId,
        oauthProvider: oauthUser.provider,
        oauthId: oauthUser.providerId,
      },
    });

    if (!user) {
      // Try to find by email
      user = await this.prisma.user.findFirst({
        where: { organizationId, email: oauthUser.email },
      });

      if (user) {
        // Link OAuth to existing account
        await this.prisma.user.update({
          where: { id: user.id },
          data: {
            oauthProvider: oauthUser.provider,
            oauthId: oauthUser.providerId,
          },
        });
      } else {
        throw new UnauthorizedException(
          'No account found for this email. Contact your administrator.',
        );
      }
    }

    if (!user.active) throw new UnauthorizedException('Account is inactive');
    return this.generateTokenPair(user);
  }

  // ─── Organization registration (SaaS signup) ───────────────

  async registerOrganization(dto: RegisterOrganizationDto) {
    const existingOrg = await this.prisma.organization.findUnique({
      where: { slug: dto.slug },
    });
    if (existingOrg) {
      throw new ConflictException(
        'This organization name is already taken. Please choose another.',
      );
    }

    const existingUser = await this.prisma.user.findFirst({
      where: { email: dto.email },
    });
    if (existingUser) {
      throw new ConflictException('An account with this email already exists.');
    }

    const hashedPassword = await bcrypt.hash(dto.password, 12);
    const trialEndsAt = new Date(Date.now() + 14 * 24 * 60 * 60 * 1000);

    const org = await this.prisma.organization.create({
      data: {
        name: dto.organizationName,
        slug: dto.slug.toLowerCase().replace(/[^a-z0-9-]/g, '-'),
        subscriptionStatus: 'trialing',
        trialEndsAt,
        settings: { defaultCurrency: dto.currency ?? 'USD' },
        users: {
          create: {
            email: dto.email,
            password: hashedPassword,
            passwordFormat: 'bcrypt',
            firstName: dto.firstName,
            lastName: dto.lastName,
            type: 'staff',
            isAdmin: true,
          },
        },
      },
      include: { users: true },
    });

    // Seed default roles, currencies, taxes, statuses, etc. for the new org
    try {
      await seedOrganization(this.prisma as any, org.id);
      // Assign the Admin role to the creating user
      const adminRole = await this.prisma.role.findFirst({
        where: { organizationId: org.id, name: 'Admin' },
      });
      if (adminRole) {
        await this.prisma.user.update({
          where: { id: org.users[0].id },
          data: { roleId: adminRole.id },
        });
      }
    } catch (err) {
      // Don't block registration if seeding fails — just log
      console.error('Seed defaults failed for new org', org.id, err);
    }

    // Seed a primary membership row so the new org owner shows up
    // correctly in /memberships/me and the multi-org login flow.
    try {
      await this.prisma.userOrganizationMembership.create({
        data: {
          userId: org.users[0].id,
          organizationId: org.id,
          role: 'admin',
          isPrimary: true,
          acceptedAt: new Date(),
        },
      });
    } catch (err) {
      // Don't block registration — could fail only on a re-run race.
      console.error('Primary membership seed failed for new org', org.id, err);
    }

    this.events.emit('organization.registered', { org });

    const adminUser = org.users[0];
    return this.generateTokenPair(adminUser);
  }

  // ─── Portal contact self-registration ──────────────────────

  async registerPortalContact(dto: PortalRegisterDto) {
    const org = await this.prisma.organization.findFirst({
      where: { slug: { equals: dto.organizationSlug, mode: 'insensitive' } },
    });
    if (!org) {
      throw new NotFoundException('Organization not found');
    }

    const existing = await this.prisma.user.findFirst({
      where: { organizationId: org.id, email: dto.email },
    });
    if (existing) {
      throw new ConflictException(
        'An account with this email already exists for this organization.',
      );
    }

    // If the setting is missing, default to self-registration allowed (active immediately)
    const settings = (org as any).settings as Record<string, any> | null;
    const selfRegister = settings?.portalSelfRegister !== false;

    const hashedPassword = await bcrypt.hash(dto.password, 12);
    const user = await this.prisma.user.create({
      data: {
        organizationId: org.id,
        email: dto.email,
        password: hashedPassword,
        passwordFormat: 'bcrypt',
        firstName: dto.firstName,
        lastName: dto.lastName,
        phone: dto.phone,
        type: 'contact',
        active: selfRegister,
      },
    });

    if (!selfRegister) {
      return { requiresApproval: true };
    }

    const tokens = await this.generateTokenPair(user);
    return { ...tokens, user };
  }
}
