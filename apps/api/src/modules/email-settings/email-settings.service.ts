import {
  Injectable,
  Logger,
  BadRequestException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as nodemailer from 'nodemailer';
import { PrismaService } from '../../database/prisma.service';
import { decrypt, encrypt, isEncrypted } from '../../common/crypto/encrypt';
import { EmailOAuthService } from './oauth/email-oauth.service';

export type EmailProvider =
  | 'SMTP'
  | 'PLATFORM_DEFAULT'
  | 'GMAIL_OAUTH'
  | 'MICROSOFT_OAUTH'
  | 'SENDGRID'
  | 'POSTMARK';

export interface UpsertEmailSettingsDto {
  provider?: EmailProvider;
  smtpHost?: string | null;
  smtpPort?: number | null;
  smtpUser?: string | null;
  /** Plaintext — encrypted before storage. Omit to leave unchanged. */
  smtpPassword?: string | null;
  smtpSecure?: boolean;
  fromName?: string | null;
  fromEmail?: string | null;
  replyToEmail?: string | null;
}

export interface ResolvedMailConfig {
  host: string;
  port: number;
  secure: boolean;
  auth?: { user: string; pass: string };
  from: string;
  replyTo?: string;
  source: 'org-smtp' | 'org-oauth' | 'platform-env';
  /**
   * When `source === 'org-oauth'` the caller (EmailsService) is expected to
   * build a nodemailer transport using XOAUTH2 instead of password auth.
   * We don't resolve tokens here to avoid a circular dep with
   * EmailOAuthService — the caller looks them up on demand.
   */
  oauth?: {
    provider: 'google' | 'microsoft';
  };
}

/** Shape returned to clients — never includes the decrypted password. */
export interface EmailSettingsResponse {
  provider: EmailProvider;
  smtpHost: string | null;
  smtpPort: number | null;
  smtpUser: string | null;
  smtpSecure: boolean;
  smtpPasswordSet: boolean;
  fromName: string | null;
  fromEmail: string | null;
  replyToEmail: string | null;
  // OAuth connection surface — non-sensitive metadata only. Tokens never leave the server.
  oauthConnected: boolean;
  oauthConnectedEmail: string | null;
  oauthConnectedAt: string | null;
  oauthTokenExpiresAt: string | null;
  updatedAt: string | null;
}

@Injectable()
export class EmailSettingsService {
  private readonly logger = new Logger(EmailSettingsService.name);

  constructor(
    private prisma: PrismaService,
    private config: ConfigService,
    private emailOAuth: EmailOAuthService,
  ) {}

  private encKey(): string | undefined {
    return this.config.get<string>('ENCRYPTION_KEY');
  }

  /** Redact password / tokens before returning over the wire. */
  private toResponse(row: any): EmailSettingsResponse {
    return {
      provider: (row?.provider ?? 'PLATFORM_DEFAULT') as EmailProvider,
      smtpHost: row?.smtpHost ?? null,
      smtpPort: row?.smtpPort ?? null,
      smtpUser: row?.smtpUser ?? null,
      smtpSecure: !!row?.smtpSecure,
      smtpPasswordSet: !!row?.smtpPassword,
      fromName: row?.fromName ?? null,
      fromEmail: row?.fromEmail ?? null,
      replyToEmail: row?.replyToEmail ?? null,
      oauthConnected: !!row?.oauthRefreshToken,
      oauthConnectedEmail: row?.oauthConnectedEmail ?? null,
      oauthConnectedAt: row?.oauthConnectedAt
        ? new Date(row.oauthConnectedAt).toISOString()
        : null,
      oauthTokenExpiresAt: row?.oauthTokenExpiresAt
        ? new Date(row.oauthTokenExpiresAt).toISOString()
        : null,
      updatedAt: row?.updatedAt ? new Date(row.updatedAt).toISOString() : null,
    };
  }

  async getForOrg(orgId: string): Promise<EmailSettingsResponse> {
    const row = await this.prisma.withOrganization(orgId, (tx) =>
      tx.emailSettings.findUnique({ where: { organizationId: orgId } }),
    );
    return this.toResponse(row);
  }

  async upsert(
    orgId: string,
    dto: UpsertEmailSettingsDto,
  ): Promise<EmailSettingsResponse> {
    const provider: EmailProvider = dto.provider ?? 'PLATFORM_DEFAULT';

    if (provider === 'SMTP') {
      // Light validation when actually using SMTP.
      if (!dto.smtpHost) {
        throw new BadRequestException('smtpHost is required for SMTP provider');
      }
      if (!dto.smtpPort) {
        throw new BadRequestException('smtpPort is required for SMTP provider');
      }
    }

    // OAuth providers are driven by the dedicated /oauth/* endpoints (which
    // persist tokens). This PUT may fire from the UI before a connection
    // exists — allow the provider switch but surface a hint if tokens are
    // missing. We don't touch the OAuth token columns here.
    if (provider === 'GMAIL_OAUTH' || provider === 'MICROSOFT_OAUTH') {
      // No structural validation — caller must separately complete the
      // consent flow. Sender fields (fromName, replyTo) can still be edited.
    }

    // Build encrypted password only if the caller supplied a new plaintext.
    // `null` explicitly clears; `undefined` means "no change".
    let passwordUpdate: { smtpPassword?: string | null } = {};
    if (dto.smtpPassword === null) {
      passwordUpdate = { smtpPassword: null };
    } else if (typeof dto.smtpPassword === 'string' && dto.smtpPassword.length > 0) {
      passwordUpdate = {
        smtpPassword: encrypt(dto.smtpPassword, this.encKey()),
      };
    }

    const data = {
      provider,
      smtpHost: dto.smtpHost ?? null,
      smtpPort: dto.smtpPort ?? null,
      smtpUser: dto.smtpUser ?? null,
      smtpSecure: dto.smtpSecure ?? false,
      fromName: dto.fromName ?? null,
      fromEmail: dto.fromEmail ?? null,
      replyToEmail: dto.replyToEmail ?? null,
      ...passwordUpdate,
    };

    const row = await this.prisma.withOrganization(orgId, (tx) =>
      tx.emailSettings.upsert({
        where: { organizationId: orgId },
        create: {
          organizationId: orgId,
          ...data,
        },
        update: data,
      }),
    );
    return this.toResponse(row);
  }

  /**
   * Resolve the effective mail config for a given org.
   * - If provider = SMTP → use org's row.
   * - Otherwise (missing row / PLATFORM_DEFAULT / stub providers not yet wired)
   *   → fall back to env SMTP_* vars so platform email still works.
   */
  async resolveConfig(orgId?: string | null): Promise<ResolvedMailConfig> {
    const envHost = this.config.get<string>('SMTP_HOST', 'localhost');
    const envPort = parseInt(
      (this.config.get<string>('SMTP_PORT') ?? '587') as string,
      10,
    );
    const envUser = this.config.get<string>('SMTP_USER');
    const envPass = this.config.get<string>('SMTP_PASS');
    const envFrom = this.config.get<string>(
      'SMTP_FROM',
      'CRM <noreply@idealhost.cloud>',
    );
    const envFallback: ResolvedMailConfig = {
      host: envHost,
      port: envPort,
      secure: envPort === 465,
      auth: envUser ? { user: envUser, pass: envPass ?? '' } : undefined,
      from: envFrom,
      source: 'platform-env',
    };

    if (!orgId) return envFallback;

    const row = await this.prisma.withOrganization(orgId, (tx) =>
      tx.emailSettings.findUnique({ where: { organizationId: orgId } }),
    );

    // ─── OAuth path ───────────────────────────────────────────────────
    if (
      row &&
      (row.provider === 'GMAIL_OAUTH' || row.provider === 'MICROSOFT_OAUTH') &&
      row.oauthRefreshToken
    ) {
      const oauthProvider: 'google' | 'microsoft' =
        row.provider === 'GMAIL_OAUTH' ? 'google' : 'microsoft';
      const fromEmail =
        row.fromEmail ?? row.oauthConnectedEmail ?? 'noreply@localhost';
      const fromName = row.fromName ?? undefined;
      // Host/port are provider-fixed; secure flag is provider-fixed.
      return {
        host:
          oauthProvider === 'google' ? 'smtp.gmail.com' : 'smtp.office365.com',
        port: 465,
        secure: true,
        from: fromName ? `${fromName} <${fromEmail}>` : fromEmail,
        replyTo: row.replyToEmail ?? undefined,
        source: 'org-oauth',
        oauth: { provider: oauthProvider },
      };
    }

    if (!row || row.provider !== 'SMTP' || !row.smtpHost || !row.smtpPort) {
      // Still honour per-org from/replyTo if set, even on platform transport.
      const fromEmail = row?.fromEmail ?? undefined;
      const fromName = row?.fromName ?? undefined;
      return {
        ...envFallback,
        from: fromEmail
          ? fromName
            ? `${fromName} <${fromEmail}>`
            : fromEmail
          : envFallback.from,
        replyTo: row?.replyToEmail ?? undefined,
      };
    }

    let pass = '';
    if (row.smtpPassword) {
      try {
        pass = isEncrypted(row.smtpPassword)
          ? decrypt(row.smtpPassword, this.encKey())
          : row.smtpPassword;
      } catch (e) {
        this.logger.error(
          `Failed to decrypt SMTP password for org ${orgId}: ${(e as Error).message}`,
        );
        pass = '';
      }
    }

    const fromEmail = row.fromEmail ?? envUser ?? 'noreply@localhost';
    const fromName = row.fromName ?? undefined;

    return {
      host: row.smtpHost,
      port: row.smtpPort,
      secure: row.smtpSecure ?? row.smtpPort === 465,
      auth: row.smtpUser ? { user: row.smtpUser, pass } : undefined,
      from: fromName ? `${fromName} <${fromEmail}>` : fromEmail,
      replyTo: row.replyToEmail ?? undefined,
      source: 'org-smtp',
    };
  }

  /**
   * Send a probe email using either the saved org config OR a caller-provided
   * override. Returns a friendly ok/error object rather than throwing so the
   * UI can display the SMTP error verbatim.
   */
  async sendTest(
    orgId: string,
    to: string,
    override?: UpsertEmailSettingsDto,
  ): Promise<{ ok: boolean; error?: string }> {
    if (!to || !/.+@.+\..+/.test(to)) {
      return { ok: false, error: 'Recipient email is invalid' };
    }

    let config: ResolvedMailConfig;

    if (override && override.provider === 'SMTP') {
      // Use the override verbatim — lets the user test *before* saving.
      if (!override.smtpHost || !override.smtpPort) {
        return { ok: false, error: 'smtpHost and smtpPort are required' };
      }
      const fromEmail =
        override.fromEmail ?? override.smtpUser ?? 'noreply@localhost';
      const fromName = override.fromName ?? undefined;
      config = {
        host: override.smtpHost,
        port: override.smtpPort,
        secure: override.smtpSecure ?? override.smtpPort === 465,
        auth: override.smtpUser
          ? { user: override.smtpUser, pass: override.smtpPassword ?? '' }
          : undefined,
        from: fromName ? `${fromName} <${fromEmail}>` : fromEmail,
        replyTo: override.replyToEmail ?? undefined,
        source: 'org-smtp',
      };
    } else {
      config = await this.resolveConfig(orgId);
    }

    try {
      let transporter: nodemailer.Transporter;
      if (config.source === 'org-oauth' && config.oauth) {
        const t = await this.emailOAuth.ensureAccessToken(orgId);
        transporter = nodemailer.createTransport({
          host: config.host,
          port: config.port,
          secure: config.secure,
          auth: {
            type: 'OAuth2',
            user: t.email,
            clientId: t.clientId,
            clientSecret: t.clientSecret,
            refreshToken: t.refreshToken,
            accessToken: t.accessToken,
          },
        });
      } else {
        transporter = nodemailer.createTransport({
          host: config.host,
          port: config.port,
          secure: config.secure,
          auth: config.auth,
        });
      }
      await transporter.sendMail({
        from: config.from,
        replyTo: config.replyTo,
        to,
        subject: 'CRM SMTP Test',
        html: `<p>This is a test email from your CRM (${config.source}).</p>
<p>If you received this, your SMTP configuration is working.</p>`,
      });
      return { ok: true };
    } catch (e) {
      const msg = (e as Error).message || 'Unknown SMTP error';
      this.logger.warn(`Test email to ${to} failed: ${msg}`);
      return { ok: false, error: msg };
    }
  }
}
