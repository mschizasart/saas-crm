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
    const user = await this.prisma.user.findFirst({
      where: { email, active: true },
      include: { role: true },
    });

    if (!user || !user.password) return null;

    let valid = false;
    if (user.passwordFormat === 'bcrypt') {
      valid = await bcrypt.compare(password, user.password);
    } else if (user.passwordFormat === 'phpass') {
      // Migrated Perfex users — node-phpass must be installed separately
      // Run: pnpm add node-phpass (in apps/api) when migrating from Perfex
      // For now, force password reset on first login attempt
      // TODO: uncomment after installing node-phpass:
      // const phpass = new (require('node-phpass').PhpassHash)(8, false);
      // valid = phpass.CheckPassword(password, user.password);
      // if (valid) {
      //   const hash = await bcrypt.hash(password, 12);
      //   await this.prisma.user.update({ where: { id: user.id }, data: { password: hash, passwordFormat: 'bcrypt' } });
      // }
      valid = false; // triggers password reset flow during migration
    }

    if (!valid) return null;
    return user;
  }

  // ─── Login ─────────────────────────────────────────────────

  async login(user: any) {
    // Update last login
    await this.prisma.user.update({
      where: { id: user.id },
      data: { lastLogin: new Date() },
    });

    if (user.twoFaEnabled) {
      // Return a short-lived temp token — frontend must complete 2FA
      const tempToken = this.jwt.sign(
        { sub: user.id, orgId: user.organizationId, step: '2fa' },
        { expiresIn: '5m' },
      );
      return { requires2fa: true, tempToken };
    }

    return this.generateTokenPair(user);
  }

  async verify2fa(userId: string, code: string) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user?.twoFaSecret) throw new UnauthorizedException();

    const valid = authenticator.verify({
      token: code,
      secret: user.twoFaSecret,
    });
    if (!valid) throw new UnauthorizedException('Invalid 2FA code');

    await this.prisma.user.update({
      where: { id: user.id },
      data: { lastLogin: new Date() },
    });

    return this.generateTokenPair(user);
  }

  // ─── Token management ──────────────────────────────────────

  async generateTokenPair(user: any) {
    const payload = {
      sub: user.id,
      orgId: user.organizationId,
      type: user.type,
      aud: user.type === 'contact' ? 'portal' : 'staff',
      isAdmin: user.isAdmin,
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

    return this.generateTokenPair(user);
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
