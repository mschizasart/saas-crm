import {
  BadRequestException,
  UnauthorizedException,
  NotFoundException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { authenticator } from 'otplib';
import { createMock, DeepMocked } from '@golevelup/ts-jest';
import { TwoFactorAuthService } from './twofa.service';
import { PrismaService } from '../../database/prisma.service';
import { AuthService } from './auth.service';
import { encrypt } from '../../common/crypto/encrypt';
import { hashRecoveryCodes } from './twofa.util';

const KEY =
  '00112233445566778899aabbccddeeff00112233445566778899aabbccddeeff';

describe('TwoFactorAuthService', () => {
  let service: TwoFactorAuthService;
  let prisma: DeepMocked<PrismaService>;
  let jwt: DeepMocked<JwtService>;
  let config: DeepMocked<ConfigService>;
  let authService: DeepMocked<AuthService>;

  beforeEach(() => {
    prisma = createMock<PrismaService>();
    jwt = createMock<JwtService>();
    config = createMock<ConfigService>();
    authService = createMock<AuthService>();

    (config.get as jest.Mock).mockImplementation((k: string, fb?: any) => {
      if (k === 'ENCRYPTION_KEY') return KEY;
      if (k === 'APP_NAME') return 'AppoinlyCRM';
      return fb;
    });

    service = new TwoFactorAuthService(prisma, jwt, config, authService);
  });

  // ─── setup ────────────────────────────────────────────────────
  describe('setup', () => {
    it('generates a TOTP secret + persists it encrypted with twoFactorEnabled=false', async () => {
      (prisma.user.findUnique as jest.Mock).mockResolvedValue({
        id: 'u1',
        email: 'u@x.com',
      });
      (prisma.user.update as jest.Mock).mockResolvedValue({});

      const out = await service.setup('u1');
      expect(out.secret).toMatch(/^[A-Z2-7]+$/); // base32
      expect(out.otpauthUrl).toContain('otpauth://totp/');
      expect(out.qrDataUrl).toMatch(/^data:image\/png;base64,/);

      const updateCall = (prisma.user.update as jest.Mock).mock.calls[0][0];
      expect(updateCall.data.twoFactorEnabled).toBe(false);
      expect(typeof updateCall.data.twoFactorSecret).toBe('string');
      expect(updateCall.data.twoFactorSecret.split(':')).toHaveLength(3);
    });

    it('throws NotFound when user is missing', async () => {
      (prisma.user.findUnique as jest.Mock).mockResolvedValue(null);
      await expect(service.setup('nope')).rejects.toThrow(NotFoundException);
    });
  });

  // ─── verifySetup ──────────────────────────────────────────────
  describe('verifySetup', () => {
    it('rejects an invalid code', async () => {
      const secret = authenticator.generateSecret();
      (prisma.user.findUnique as jest.Mock).mockResolvedValue({
        id: 'u1',
        twoFactorSecret: encrypt(secret, KEY),
      });
      await expect(service.verifySetup('u1', '000000')).rejects.toThrow(
        /Invalid verification code/,
      );
    });

    it('flips twoFactorEnabled to true and returns recovery codes on a valid code', async () => {
      const secret = authenticator.generateSecret();
      const validCode = authenticator.generate(secret);
      (prisma.user.findUnique as jest.Mock).mockResolvedValue({
        id: 'u1',
        twoFactorSecret: encrypt(secret, KEY),
      });
      (prisma.user.update as jest.Mock).mockResolvedValue({});

      const out = await service.verifySetup('u1', validCode);
      expect(out.recoveryCodes).toHaveLength(10);
      out.recoveryCodes.forEach((c) =>
        expect(c).toMatch(/^[A-HJ-NP-Z2-9]{5}-[A-HJ-NP-Z2-9]{5}$/),
      );

      const data = (prisma.user.update as jest.Mock).mock.calls[0][0].data;
      expect(data.twoFactorEnabled).toBe(true);
      expect(data.twoFactorEnrolledAt).toBeInstanceOf(Date);
      expect(Array.isArray(data.twoFactorRecoveryCodes)).toBe(true);
      expect(data.twoFactorRecoveryCodes).toHaveLength(10);
    });

    it('throws BadRequest when 2FA setup was never initialised', async () => {
      (prisma.user.findUnique as jest.Mock).mockResolvedValue({
        id: 'u1',
        twoFactorSecret: null,
      });
      await expect(service.verifySetup('u1', '123456')).rejects.toThrow(
        BadRequestException,
      );
    });
  });

  // ─── loginWithCode ────────────────────────────────────────────
  describe('loginWithCode', () => {
    it('rejects an invalid 2FA token', async () => {
      (jwt.verify as jest.Mock).mockImplementation(() => {
        throw new Error('expired');
      });
      await expect(service.loginWithCode('bad-token', '123456')).rejects.toThrow(
        UnauthorizedException,
      );
    });

    it('rejects a token with the wrong purpose', async () => {
      (jwt.verify as jest.Mock).mockReturnValue({ sub: 'u1', purpose: 'access' });
      await expect(service.loginWithCode('tok', '123456')).rejects.toThrow(
        /Invalid 2FA token/,
      );
    });

    it('accepts valid TOTP and returns access token pair', async () => {
      const secret = authenticator.generateSecret();
      (jwt.verify as jest.Mock).mockReturnValue({ sub: 'u1', purpose: '2fa' });
      (prisma.user.findUnique as jest.Mock).mockResolvedValue({
        id: 'u1',
        active: true,
        twoFactorEnabled: true,
        twoFactorSecret: encrypt(secret, KEY),
        twoFactorRecoveryCodes: [],
      });
      (prisma.user.update as jest.Mock).mockResolvedValue({});
      (authService.generateTokenPair as jest.Mock).mockResolvedValue({
        accessToken: 'A',
        refreshToken: 'R',
      });

      const tok = authenticator.generate(secret);
      const out = await service.loginWithCode('jwt', tok);
      expect(out).toEqual({ accessToken: 'A', refreshToken: 'R' });
    });

    it('accepts a valid recovery code and consumes it (one-time use)', async () => {
      const recoveryCode = 'AAAAA-BBBBB';
      const hashes = await hashRecoveryCodes([recoveryCode, 'CCCCC-DDDDD']);
      (jwt.verify as jest.Mock).mockReturnValue({ sub: 'u1', purpose: '2fa' });
      (prisma.user.findUnique as jest.Mock).mockResolvedValue({
        id: 'u1',
        active: true,
        twoFactorEnabled: true,
        twoFactorSecret: encrypt(authenticator.generateSecret(), KEY),
        twoFactorRecoveryCodes: hashes,
      });
      (prisma.user.update as jest.Mock).mockResolvedValue({});
      (authService.generateTokenPair as jest.Mock).mockResolvedValue({
        accessToken: 'A',
        refreshToken: 'R',
      });

      await service.loginWithCode('tok', recoveryCode);

      // Asserts the consumed code was spliced out (length 1 remaining)
      const consumeCall = (prisma.user.update as jest.Mock).mock.calls.find(
        (c: any) => 'twoFactorRecoveryCodes' in c[0].data,
      );
      expect(consumeCall).toBeTruthy();
      expect(consumeCall[0].data.twoFactorRecoveryCodes).toHaveLength(1);
    });

    it('rejects after recovery code is consumed (replayed)', async () => {
      // Simulate "consumed" by passing an empty hashes array
      (jwt.verify as jest.Mock).mockReturnValue({ sub: 'u1', purpose: '2fa' });
      (prisma.user.findUnique as jest.Mock).mockResolvedValue({
        id: 'u1',
        active: true,
        twoFactorEnabled: true,
        twoFactorSecret: encrypt(authenticator.generateSecret(), KEY),
        twoFactorRecoveryCodes: [],
      });
      await expect(
        service.loginWithCode('tok', 'AAAAA-BBBBB'),
      ).rejects.toThrow(/Invalid verification code/);
    });

    it('rejects when user is inactive', async () => {
      (jwt.verify as jest.Mock).mockReturnValue({ sub: 'u1', purpose: '2fa' });
      (prisma.user.findUnique as jest.Mock).mockResolvedValue({
        id: 'u1',
        active: false,
        twoFactorEnabled: true,
        twoFactorSecret: encrypt('secret', KEY),
      });
      await expect(service.loginWithCode('tok', '123456')).rejects.toThrow(
        UnauthorizedException,
      );
    });
  });

  // ─── issueTwoFactorToken ──────────────────────────────────────
  describe('issueTwoFactorToken', () => {
    it('signs a short-lived token with purpose=2fa', () => {
      (jwt.sign as jest.Mock).mockReturnValue('signed-jwt');
      const out = service.issueTwoFactorToken('u1');
      expect(out).toBe('signed-jwt');
      expect(jwt.sign).toHaveBeenCalledWith(
        { sub: 'u1', purpose: '2fa' },
        expect.objectContaining({ expiresIn: '5m' }),
      );
    });
  });
});
