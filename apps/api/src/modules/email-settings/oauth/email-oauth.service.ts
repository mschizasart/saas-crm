import {
  Injectable,
  Logger,
  BadRequestException,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../../../database/prisma.service';
import { decrypt, encrypt, isEncrypted } from '../../../common/crypto/encrypt';
import { GoogleOAuthService } from './google-oauth.service';
import { MicrosoftOAuthService } from './microsoft-oauth.service';
import { signOAuthState, verifyOAuthState } from './oauth-state';
import { OAuthProvider, OAuthProviderService } from './oauth.types';

/**
 * Orchestrator tying the two per-provider services to the DB and the
 * state-token signing. Handles:
 *
 *   - GET /start    → returns an auth URL (with a signed state)
 *   - GET /callback → verifies state, swaps code → tokens, persists encrypted
 *   - refresh       → reads encrypted refresh_token, calls provider, persists
 *   - disconnect    → clears OAuth columns and resets provider
 *
 * All secrets are stored AES-256-GCM encrypted with ENCRYPTION_KEY, mirroring
 * the existing `smtpPassword` handling.
 */
@Injectable()
export class EmailOAuthService {
  private readonly logger = new Logger(EmailOAuthService.name);

  constructor(
    private prisma: PrismaService,
    private config: ConfigService,
    private google: GoogleOAuthService,
    private microsoft: MicrosoftOAuthService,
  ) {}

  private encKey(): string | undefined {
    return this.config.get<string>('ENCRYPTION_KEY');
  }

  private providerService(p: OAuthProvider): OAuthProviderService {
    return p === 'google' ? this.google : this.microsoft;
  }

  private mapToDbProvider(p: OAuthProvider): 'GMAIL_OAUTH' | 'MICROSOFT_OAUTH' {
    return p === 'google' ? 'GMAIL_OAUTH' : 'MICROSOFT_OAUTH';
  }

  /** Decrypt a value only if it looks encrypted; tolerate legacy plaintext. */
  private tryDecrypt(v: string | null | undefined): string | null {
    if (!v) return null;
    try {
      return isEncrypted(v) ? decrypt(v, this.encKey()) : v;
    } catch (e) {
      this.logger.error(`Decrypt failed: ${(e as Error).message}`);
      return null;
    }
  }

  /**
   * Build the consent URL for the given provider + org. Throws 400 if the
   * provider isn't configured on this server (missing client id/secret).
   */
  getAuthUrl(orgId: string, provider: OAuthProvider): string {
    const svc = this.providerService(provider);
    if (!svc.isConfigured()) {
      throw new BadRequestException(
        `${provider} OAuth is not configured on this server`,
      );
    }
    const state = signOAuthState({ orgId, provider }, this.encKey());
    return svc.getAuthUrl(state);
  }

  /**
   * Handle the redirect-back from the provider. Verifies state, swaps the
   * auth code for tokens, encrypts them, and persists to `email_settings`.
   * Returns the orgId so the caller can redirect the browser back to the UI.
   */
  async handleCallback(
    provider: OAuthProvider,
    code: string,
    state: string,
  ): Promise<{ orgId: string; connectedEmail?: string }> {
    if (!code) {
      throw new BadRequestException('Missing authorization code');
    }
    const decoded = verifyOAuthState(state, this.encKey());
    if (decoded.provider !== provider) {
      throw new BadRequestException('State provider mismatch');
    }

    const svc = this.providerService(provider);
    const tokens = await svc.exchangeCode(code);

    if (!tokens.refreshToken) {
      // Google only omits refresh_token when the user has previously granted
      // consent WITHOUT prompt=consent — shouldn't happen with our flow but
      // surface it clearly instead of silently saving a useless record.
      throw new BadRequestException(
        'Provider did not return a refresh_token — revoke access in your account and try again.',
      );
    }

    const dbProvider = this.mapToDbProvider(provider);
    const encryptedRefresh = encrypt(tokens.refreshToken, this.encKey());
    const encryptedAccess = encrypt(tokens.accessToken, this.encKey());
    const expiresAt = new Date(Date.now() + tokens.expiresIn * 1000);

    await this.prisma.withOrganization(decoded.orgId, (tx) =>
      tx.emailSettings.upsert({
        where: { organizationId: decoded.orgId },
        create: {
          organizationId: decoded.orgId,
          provider: dbProvider,
          oauthRefreshToken: encryptedRefresh,
          oauthAccessToken: encryptedAccess,
          oauthTokenExpiresAt: expiresAt,
          oauthConnectedEmail: tokens.email ?? null,
          oauthConnectedAt: new Date(),
          fromEmail: tokens.email ?? null,
        },
        update: {
          provider: dbProvider,
          oauthRefreshToken: encryptedRefresh,
          oauthAccessToken: encryptedAccess,
          oauthTokenExpiresAt: expiresAt,
          oauthConnectedEmail: tokens.email ?? null,
          oauthConnectedAt: new Date(),
          // Default fromEmail to the connected mailbox if the admin hasn't
          // set one yet — they can override later in the UI.
          ...(tokens.email ? { fromEmail: tokens.email } : {}),
        },
      }),
    );

    return { orgId: decoded.orgId, connectedEmail: tokens.email };
  }

  /**
   * Ensure a fresh access token is available for the given org. Refreshes
   * if the cached token is missing, expired, or within 60 s of expiry.
   * Returns the decrypted access token ready for nodemailer XOAUTH2.
   */
  async ensureAccessToken(orgId: string): Promise<{
    accessToken: string;
    refreshToken: string;
    email: string;
    provider: OAuthProvider;
    clientId: string;
    clientSecret: string;
  }> {
    const row = await this.prisma.withOrganization(orgId, (tx) =>
      tx.emailSettings.findUnique({ where: { organizationId: orgId } }),
    );
    if (!row) {
      throw new NotFoundException('No email settings for org');
    }
    if (row.provider !== 'GMAIL_OAUTH' && row.provider !== 'MICROSOFT_OAUTH') {
      throw new BadRequestException('Org is not configured for OAuth email');
    }
    const provider: OAuthProvider =
      row.provider === 'GMAIL_OAUTH' ? 'google' : 'microsoft';
    const svc = this.providerService(provider);
    if (!svc.isConfigured()) {
      throw new BadRequestException(
        `${provider} OAuth is not configured on this server`,
      );
    }

    const refreshPlain = this.tryDecrypt(row.oauthRefreshToken);
    if (!refreshPlain) {
      throw new BadRequestException(
        'Refresh token missing or undecryptable — reconnect the mailbox.',
      );
    }

    const now = Date.now();
    const exp = row.oauthTokenExpiresAt
      ? new Date(row.oauthTokenExpiresAt).getTime()
      : 0;
    const fresh = exp - now > 60_000; // more than 60 s left

    let accessPlain = fresh ? this.tryDecrypt(row.oauthAccessToken) : null;

    if (!accessPlain) {
      this.logger.debug(
        `Refreshing ${provider} access token for org ${orgId} (expired or missing)`,
      );
      const t = await svc.refreshAccessToken(refreshPlain);
      accessPlain = t.accessToken;
      const newExpiry = new Date(Date.now() + t.expiresIn * 1000);
      // If the provider rotated the refresh token (Microsoft does), keep it.
      const nextRefreshEncrypted = t.refreshToken
        ? encrypt(t.refreshToken, this.encKey())
        : row.oauthRefreshToken;
      await this.prisma.withOrganization(orgId, (tx) =>
        tx.emailSettings.update({
          where: { organizationId: orgId },
          data: {
            oauthAccessToken: encrypt(accessPlain!, this.encKey()),
            oauthRefreshToken: nextRefreshEncrypted,
            oauthTokenExpiresAt: newExpiry,
          },
        }),
      );
    }

    const { clientId, clientSecret } = this.providerCreds(provider);
    return {
      accessToken: accessPlain,
      refreshToken: refreshPlain,
      email:
        row.oauthConnectedEmail ??
        row.fromEmail ??
        '', // nodemailer will reject empty — caller should have surfaced this
      provider,
      clientId,
      clientSecret,
    };
  }

  private providerCreds(p: OAuthProvider): {
    clientId: string;
    clientSecret: string;
  } {
    if (p === 'google') {
      return {
        clientId: this.config.get<string>('GOOGLE_OAUTH_CLIENT_ID') ?? '',
        clientSecret:
          this.config.get<string>('GOOGLE_OAUTH_CLIENT_SECRET') ?? '',
      };
    }
    return {
      clientId: this.config.get<string>('MICROSOFT_OAUTH_CLIENT_ID') ?? '',
      clientSecret:
        this.config.get<string>('MICROSOFT_OAUTH_CLIENT_SECRET') ?? '',
    };
  }

  /**
   * Disconnect the connected mailbox — clears all OAuth fields and reverts
   * the provider to `PLATFORM_DEFAULT` so mail still flows via env SMTP.
   */
  async disconnect(orgId: string): Promise<void> {
    await this.prisma.withOrganization(orgId, (tx) =>
      tx.emailSettings.updateMany({
        where: { organizationId: orgId },
        data: {
          provider: 'PLATFORM_DEFAULT',
          oauthRefreshToken: null,
          oauthAccessToken: null,
          oauthTokenExpiresAt: null,
          oauthConnectedEmail: null,
          oauthConnectedAt: null,
        },
      }),
    );
  }

  /** Whether each provider is configured on this server. Used by the UI. */
  getConfigStatus(): { google: boolean; microsoft: boolean } {
    return {
      google: this.google.isConfigured(),
      microsoft: this.microsoft.isConfigured(),
    };
  }
}
