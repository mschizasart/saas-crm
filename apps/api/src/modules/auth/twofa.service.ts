import {
  Injectable,
  BadRequestException,
  UnauthorizedException,
  NotFoundException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import * as bcrypt from 'bcryptjs';
import { authenticator } from 'otplib';
import * as QRCode from 'qrcode';
import { PrismaService } from '../../database/prisma.service';
import { encrypt, decrypt } from '../../common/crypto/encrypt';
import { AuthService } from './auth.service';
import {
  generateRecoveryCodes,
  hashRecoveryCodes,
  consumeRecoveryCode,
} from './twofa.util';

/**
 * Staff TOTP-based 2FA. The TOTP secret is stored encrypted with
 * AES-256-GCM (ENCRYPTION_KEY env). Recovery codes are bcrypt-hashed
 * and stored as a JSON array; consumed (matched) codes are removed
 * from the array.
 */
@Injectable()
export class TwoFactorAuthService {
  constructor(
    private prisma: PrismaService,
    private jwt: JwtService,
    private config: ConfigService,
    private authService: AuthService,
  ) {}

  private getEncryptionKey(): string {
    const key = this.config.get<string>('ENCRYPTION_KEY');
    if (!key) {
      throw new BadRequestException(
        'Server is missing ENCRYPTION_KEY — 2FA cannot be enabled.',
      );
    }
    return key;
  }

  // ─── Status ───────────────────────────────────────────────────────

  async getStatus(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: {
        twoFactorEnabled: true,
        twoFactorEnrolledAt: true,
        twoFactorRecoveryCodes: true,
      },
    });
    if (!user) throw new NotFoundException();
    const recoveryCount = Array.isArray(user.twoFactorRecoveryCodes)
      ? (user.twoFactorRecoveryCodes as unknown[]).length
      : 0;
    return {
      enabled: !!user.twoFactorEnabled,
      enrolledAt: user.twoFactorEnrolledAt,
      recoveryCodesRemaining: recoveryCount,
    };
  }

  // ─── Setup ────────────────────────────────────────────────────────

  /**
   * Generate a fresh TOTP secret for the user and persist it encrypted
   * with twoFactorEnabled = false (still pending verification). The
   * caller will scan the QR code, then POST /verify-setup with the code.
   */
  async setup(userId: string) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new NotFoundException('User not found');

    const secret = authenticator.generateSecret(); // base32, plaintext
    const otpauthUrl = authenticator.keyuri(
      user.email,
      this.config.get('APP_NAME', 'AppoinlyCRM'),
      secret,
    );
    const qrDataUrl = await QRCode.toDataURL(otpauthUrl);

    const encrypted = encrypt(secret, this.getEncryptionKey());

    await this.prisma.user.update({
      where: { id: userId },
      data: {
        twoFactorSecret: encrypted,
        twoFactorEnabled: false,
        twoFactorRecoveryCodes: [] as any,
        twoFactorEnrolledAt: null,
      },
    });

    return { secret, otpauthUrl, qrDataUrl };
  }

  /**
   * User scanned the QR and entered the first code — verify against
   * the just-stored secret, flip twoFactorEnabled to true, and return
   * a one-time list of plaintext recovery codes.
   */
  async verifySetup(userId: string, code: string) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user?.twoFactorSecret) {
      throw new BadRequestException('2FA setup has not been initialised.');
    }

    const secret = decrypt(user.twoFactorSecret, this.getEncryptionKey());
    if (!authenticator.verify({ token: code.trim(), secret })) {
      throw new BadRequestException('Invalid verification code.');
    }

    const recoveryCodes = generateRecoveryCodes(10);
    const hashed = await hashRecoveryCodes(recoveryCodes);

    await this.prisma.user.update({
      where: { id: userId },
      data: {
        twoFactorEnabled: true,
        twoFactorEnrolledAt: new Date(),
        twoFactorRecoveryCodes: hashed,
      },
    });

    return { recoveryCodes };
  }

  // ─── Disable / regenerate ────────────────────────────────────────

  async disable(userId: string, password: string, code: string) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user || !user.password) {
      throw new UnauthorizedException();
    }
    if (!user.twoFactorEnabled || !user.twoFactorSecret) {
      throw new BadRequestException('2FA is not enabled.');
    }

    const passwordOk = await bcrypt.compare(password, user.password);
    if (!passwordOk) {
      throw new UnauthorizedException('Invalid password.');
    }

    const secret = decrypt(user.twoFactorSecret, this.getEncryptionKey());
    if (!authenticator.verify({ token: code.trim(), secret })) {
      throw new UnauthorizedException('Invalid verification code.');
    }

    await this.prisma.user.update({
      where: { id: userId },
      data: {
        twoFactorEnabled: false,
        twoFactorSecret: null,
        twoFactorRecoveryCodes: [] as any,
        twoFactorEnrolledAt: null,
      },
    });

    return { ok: true };
  }

  async regenerateRecoveryCodes(userId: string, code: string) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user?.twoFactorEnabled || !user.twoFactorSecret) {
      throw new BadRequestException('2FA is not enabled.');
    }

    const secret = decrypt(user.twoFactorSecret, this.getEncryptionKey());
    if (!authenticator.verify({ token: code.trim(), secret })) {
      throw new UnauthorizedException('Invalid verification code.');
    }

    const recoveryCodes = generateRecoveryCodes(10);
    const hashed = await hashRecoveryCodes(recoveryCodes);

    await this.prisma.user.update({
      where: { id: userId },
      data: { twoFactorRecoveryCodes: hashed },
    });

    return { recoveryCodes };
  }

  // ─── Login (step 2) ──────────────────────────────────────────────

  /**
   * Issue a short-lived (5min) JWT after successful password validation
   * for users that have 2FA enabled. The token has purpose:"2fa" so it
   * can't be used as an access token by mistake.
   */
  issueTwoFactorToken(userId: string): string {
    return this.jwt.sign(
      { sub: userId, purpose: '2fa' },
      { expiresIn: '5m' },
    );
  }

  async loginWithCode(twoFactorToken: string, code: string) {
    let payload: any;
    try {
      payload = this.jwt.verify(twoFactorToken);
    } catch {
      throw new UnauthorizedException('Invalid or expired 2FA token.');
    }
    if (payload.purpose !== '2fa' || !payload.sub) {
      throw new UnauthorizedException('Invalid 2FA token.');
    }

    const user = await this.prisma.user.findUnique({
      where: { id: payload.sub },
    });
    if (!user || !user.active || !user.twoFactorEnabled || !user.twoFactorSecret) {
      throw new UnauthorizedException();
    }

    const secret = decrypt(user.twoFactorSecret, this.getEncryptionKey());
    const trimmed = (code ?? '').trim();
    const totpOk =
      trimmed.length === 6 && /^\d{6}$/.test(trimmed)
        ? authenticator.verify({ token: trimmed, secret })
        : false;

    if (!totpOk) {
      // Try recovery codes
      const hashes = Array.isArray(user.twoFactorRecoveryCodes)
        ? (user.twoFactorRecoveryCodes as unknown as string[])
        : [];
      const idx = await consumeRecoveryCode(trimmed, hashes);
      if (idx === -1) {
        throw new UnauthorizedException('Invalid verification code.');
      }
      // Mark code as used by removing it
      const remaining = [...hashes];
      remaining.splice(idx, 1);
      await this.prisma.user.update({
        where: { id: user.id },
        data: { twoFactorRecoveryCodes: remaining as any },
      });
    }

    // After the TOTP code validates, layer the multi-org selection step.
    // - 0/1 memberships → mint the access token as before.
    // - 2+ memberships  → return the same `requiresOrgSelection` envelope
    //   used by the non-2FA branch; the client then POSTs to
    //   /auth/select-org. The order is therefore: login → 2fa → org-select.
    const orgChoice = await this.authService.resolveLoginOrg(user);
    if (orgChoice.requiresOrgSelection) {
      return orgChoice;
    }

    await this.prisma.user.update({
      where: { id: user.id },
      data: { lastLogin: new Date() },
    });

    return this.authService.generateTokenPair({
      ...user,
      organizationId: orgChoice.organizationId,
    });
  }
}
