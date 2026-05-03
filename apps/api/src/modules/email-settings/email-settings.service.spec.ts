import { ConfigService } from '@nestjs/config';
import { BadRequestException } from '@nestjs/common';
import { createMock, DeepMocked } from '@golevelup/ts-jest';
import { EmailSettingsService } from './email-settings.service';
import { PrismaService } from '../../database/prisma.service';
import { EmailOAuthService } from './oauth/email-oauth.service';
import { decrypt, encrypt, isEncrypted } from '../../common/crypto/encrypt';

function makeWithOrganization(prisma: DeepMocked<PrismaService>) {
  return jest
    .fn()
    .mockImplementation(async (_orgId: string, fn: (tx: any) => any) =>
      fn(prisma as any),
    );
}

const KEY =
  'aabbccddeeff00112233445566778899aabbccddeeff00112233445566778899';

describe('EmailSettingsService', () => {
  let service: EmailSettingsService;
  let prisma: DeepMocked<PrismaService>;
  let config: DeepMocked<ConfigService>;
  let oauth: DeepMocked<EmailOAuthService>;

  const ORG_ID = 'org_e';

  beforeEach(() => {
    prisma = createMock<PrismaService>();
    config = createMock<ConfigService>();
    oauth = createMock<EmailOAuthService>();
    (prisma.withOrganization as any) = makeWithOrganization(prisma);

    // Default: ENCRYPTION_KEY available
    (config.get as jest.Mock).mockImplementation((k: string, fallback?: any) => {
      if (k === 'ENCRYPTION_KEY') return KEY;
      return fallback;
    });

    service = new EmailSettingsService(prisma, config, oauth);
  });

  // ─── upsert: encryption + redaction ────────────────────────────
  describe('upsert', () => {
    it('encrypts smtpPassword + imapPassword on the way in and never echoes back', async () => {
      let upsertedData: any;
      (prisma.emailSettings.upsert as jest.Mock).mockImplementation(
        async (args: any) => {
          upsertedData = args.create;
          return {
            ...args.create,
            updatedAt: new Date(),
          };
        },
      );

      const response = await service.upsert(ORG_ID, {
        provider: 'SMTP',
        smtpHost: 'mail.example.com',
        smtpPort: 587,
        smtpUser: 'me',
        smtpPassword: 'plaintext-password',
        imapEnabled: true,
        imapHost: 'imap.example.com',
        imapPort: 993,
        imapUser: 'me',
        imapPassword: 'imap-secret',
      });

      expect(isEncrypted(upsertedData.smtpPassword)).toBe(true);
      expect(decrypt(upsertedData.smtpPassword, KEY)).toBe('plaintext-password');
      expect(isEncrypted(upsertedData.imapPassword)).toBe(true);
      expect(decrypt(upsertedData.imapPassword, KEY)).toBe('imap-secret');
      // Response is redacted — has booleans only
      expect(response.smtpPasswordSet).toBe(true);
      expect(response.imapPasswordSet).toBe(true);
      expect((response as any).smtpPassword).toBeUndefined();
    });

    it('leaves smtpPassword unchanged when undefined (omit semantics)', async () => {
      let upsertedData: any;
      (prisma.emailSettings.upsert as jest.Mock).mockImplementation(
        async (args: any) => {
          upsertedData = args.update;
          return { ...args.update };
        },
      );

      await service.upsert(ORG_ID, {
        provider: 'SMTP',
        smtpHost: 'h',
        smtpPort: 25,
      });

      expect('smtpPassword' in upsertedData).toBe(false);
    });

    it('clears smtpPassword when explicitly null', async () => {
      let upsertedData: any;
      (prisma.emailSettings.upsert as jest.Mock).mockImplementation(
        async (args: any) => {
          upsertedData = args.update;
          return {};
        },
      );

      await service.upsert(ORG_ID, {
        provider: 'SMTP',
        smtpHost: 'h',
        smtpPort: 25,
        smtpPassword: null,
      });

      expect(upsertedData.smtpPassword).toBeNull();
    });

    it('rejects SMTP provider without smtpHost / smtpPort', async () => {
      await expect(
        service.upsert(ORG_ID, { provider: 'SMTP', smtpHost: null }),
      ).rejects.toThrow(BadRequestException);
      await expect(
        service.upsert(ORG_ID, { provider: 'SMTP', smtpHost: 'h' }),
      ).rejects.toThrow(BadRequestException);
    });
  });

  // ─── getForOrg redaction ──────────────────────────────────────
  describe('getForOrg', () => {
    it('redacts password into smtpPasswordSet boolean', async () => {
      (prisma.emailSettings.findUnique as jest.Mock).mockResolvedValue({
        provider: 'SMTP',
        smtpHost: 'h',
        smtpPort: 25,
        smtpUser: 'u',
        smtpPassword: 'iv:tag:cipher',
        smtpSecure: true,
        fromName: null,
        fromEmail: null,
        replyToEmail: null,
        imapEnabled: false,
        imapHost: null,
        imapPort: null,
        imapUser: null,
        imapTls: true,
        imapPassword: null,
        oauthRefreshToken: null,
        updatedAt: new Date(),
      });

      const out = await service.getForOrg(ORG_ID);
      expect(out.smtpPasswordSet).toBe(true);
      expect(out.imapPasswordSet).toBe(false);
      expect((out as any).smtpPassword).toBeUndefined();
    });

    it('returns sane defaults when no row exists', async () => {
      (prisma.emailSettings.findUnique as jest.Mock).mockResolvedValue(null);
      const out = await service.getForOrg(ORG_ID);
      expect(out.provider).toBe('PLATFORM_DEFAULT');
      expect(out.smtpPasswordSet).toBe(false);
      expect(out.oauthConnected).toBe(false);
    });
  });

  // ─── resolveConfig ────────────────────────────────────────────
  describe('resolveConfig', () => {
    it('returns env fallback when no row exists', async () => {
      (config.get as jest.Mock).mockImplementation(
        (k: string, fb?: any) => {
          if (k === 'SMTP_HOST') return 'env.host';
          if (k === 'SMTP_PORT') return '465';
          if (k === 'SMTP_USER') return 'envuser';
          if (k === 'SMTP_PASS') return 'envpass';
          if (k === 'SMTP_FROM') return 'CRM <env@x.com>';
          if (k === 'ENCRYPTION_KEY') return KEY;
          return fb;
        },
      );
      (prisma.emailSettings.findUnique as jest.Mock).mockResolvedValue(null);

      const cfg = await service.resolveConfig(ORG_ID);
      expect(cfg.source).toBe('platform-env');
      expect(cfg.host).toBe('env.host');
      expect(cfg.port).toBe(465);
      expect(cfg.secure).toBe(true);
      expect(cfg.auth).toEqual({ user: 'envuser', pass: 'envpass' });
    });

    it('returns env fallback when orgId is null', async () => {
      (config.get as jest.Mock).mockImplementation(
        (k: string, fb?: any) =>
          ({ SMTP_HOST: 'h', SMTP_PORT: '25', SMTP_FROM: 'a' } as any)[k] ?? fb,
      );
      const cfg = await service.resolveConfig(null);
      expect(cfg.source).toBe('platform-env');
    });

    it('returns org SMTP config when provider=SMTP, decrypts password', async () => {
      // Pre-encrypt the password the way the service would
      const encrypted = encrypt('realpass', KEY);

      (prisma.emailSettings.findUnique as jest.Mock).mockResolvedValue({
        provider: 'SMTP',
        smtpHost: 'org.host',
        smtpPort: 587,
        smtpUser: 'u',
        smtpPassword: encrypted,
        smtpSecure: false,
        fromName: 'Org',
        fromEmail: 'org@x.com',
        replyToEmail: null,
      });

      const cfg = await service.resolveConfig(ORG_ID);
      expect(cfg.source).toBe('org-smtp');
      expect(cfg.host).toBe('org.host');
      expect(cfg.auth).toEqual({ user: 'u', pass: 'realpass' });
      expect(cfg.from).toBe('Org <org@x.com>');
    });

    it('returns OAuth shape when provider=GMAIL_OAUTH and refresh token present', async () => {
      (prisma.emailSettings.findUnique as jest.Mock).mockResolvedValue({
        provider: 'GMAIL_OAUTH',
        oauthRefreshToken: 'rt',
        oauthConnectedEmail: 'me@gmail.com',
        fromEmail: null,
        fromName: null,
        replyToEmail: null,
      });

      const cfg = await service.resolveConfig(ORG_ID);
      expect(cfg.source).toBe('org-oauth');
      expect(cfg.oauth).toEqual({ provider: 'google' });
      expect(cfg.host).toBe('smtp.gmail.com');
      expect(cfg.port).toBe(465);
      expect(cfg.from).toBe('me@gmail.com');
    });
  });
});
