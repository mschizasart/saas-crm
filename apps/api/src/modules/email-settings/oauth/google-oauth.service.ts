import { Injectable, Logger, BadRequestException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  OAuthProvider,
  OAuthProviderService,
  OAuthTokenResponse,
} from './oauth.types';

/**
 * Google OAuth 2.0 flow for Gmail / Workspace SMTP (XOAUTH2).
 *
 * Scopes: `https://mail.google.com/` — full mailbox access is required for
 * SMTP send. For read-only we'd use `gmail.send`, but with XOAUTH2 over
 * smtp.gmail.com only the full-mail scope is honoured (documented quirk).
 *
 * We intentionally use raw `fetch` rather than the `googleapis` SDK — the
 * token endpoint is a single POST and this avoids a heavy dep.
 */
@Injectable()
export class GoogleOAuthService implements OAuthProviderService {
  private readonly logger = new Logger(GoogleOAuthService.name);
  readonly providerName: OAuthProvider = 'google';

  private static readonly AUTH_URL =
    'https://accounts.google.com/o/oauth2/v2/auth';
  private static readonly TOKEN_URL = 'https://oauth2.googleapis.com/token';
  /** Full-mailbox scope required by XOAUTH2 / smtp.gmail.com. */
  private static readonly SCOPE = 'https://mail.google.com/';

  constructor(private config: ConfigService) {}

  private get clientId(): string | undefined {
    return this.config.get<string>('GOOGLE_OAUTH_CLIENT_ID');
  }
  private get clientSecret(): string | undefined {
    return this.config.get<string>('GOOGLE_OAUTH_CLIENT_SECRET');
  }
  private get redirectUri(): string | undefined {
    return this.config.get<string>('GOOGLE_OAUTH_REDIRECT_URI');
  }

  isConfigured(): boolean {
    return !!(this.clientId && this.clientSecret && this.redirectUri);
  }

  private requireConfig() {
    if (!this.isConfigured()) {
      throw new BadRequestException(
        'Google OAuth is not configured on this server — ask your administrator to set GOOGLE_OAUTH_CLIENT_ID, GOOGLE_OAUTH_CLIENT_SECRET and GOOGLE_OAUTH_REDIRECT_URI.',
      );
    }
  }

  /** Build the Google consent URL. `state` must be a signed, short-lived token. */
  getAuthUrl(state: string): string {
    this.requireConfig();
    const params = new URLSearchParams({
      client_id: this.clientId!,
      redirect_uri: this.redirectUri!,
      response_type: 'code',
      scope: [GoogleOAuthService.SCOPE, 'openid', 'email'].join(' '),
      // `access_type=offline` + `prompt=consent` forces the refresh_token
      // to be re-emitted every time, which is what we want when an admin
      // rotates accounts.
      access_type: 'offline',
      prompt: 'consent',
      include_granted_scopes: 'true',
      state,
    });
    return `${GoogleOAuthService.AUTH_URL}?${params.toString()}`;
  }

  async exchangeCode(code: string): Promise<OAuthTokenResponse> {
    this.requireConfig();
    const body = new URLSearchParams({
      code,
      client_id: this.clientId!,
      client_secret: this.clientSecret!,
      redirect_uri: this.redirectUri!,
      grant_type: 'authorization_code',
    });

    const res = await fetch(GoogleOAuthService.TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body,
    });

    if (!res.ok) {
      const txt = await res.text().catch(() => '');
      this.logger.warn(`Google token exchange failed: ${res.status} ${txt}`);
      throw new BadRequestException(
        `Google token exchange failed (${res.status})`,
      );
    }

    const json = (await res.json()) as {
      access_token: string;
      refresh_token?: string;
      expires_in: number;
      id_token?: string;
      scope?: string;
    };

    return {
      accessToken: json.access_token,
      refreshToken: json.refresh_token,
      expiresIn: json.expires_in,
      email: this.emailFromIdToken(json.id_token),
      scope: json.scope,
    };
  }

  async refreshAccessToken(refreshToken: string): Promise<OAuthTokenResponse> {
    this.requireConfig();
    const body = new URLSearchParams({
      client_id: this.clientId!,
      client_secret: this.clientSecret!,
      refresh_token: refreshToken,
      grant_type: 'refresh_token',
    });

    const res = await fetch(GoogleOAuthService.TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body,
    });
    if (!res.ok) {
      const txt = await res.text().catch(() => '');
      this.logger.warn(`Google refresh failed: ${res.status} ${txt}`);
      throw new BadRequestException(`Google token refresh failed (${res.status})`);
    }
    const json = (await res.json()) as {
      access_token: string;
      expires_in: number;
      // Google only returns a new refresh_token when the old one was revoked.
      refresh_token?: string;
      scope?: string;
    };
    return {
      accessToken: json.access_token,
      refreshToken: json.refresh_token,
      expiresIn: json.expires_in,
      scope: json.scope,
    };
  }

  /**
   * id_token is a JWT; middle segment is base64url JSON containing `email`.
   * We don't verify the signature — this token came from Google over TLS
   * directly from the token endpoint, it's not user-submitted.
   */
  private emailFromIdToken(idToken?: string): string | undefined {
    if (!idToken) return undefined;
    const parts = idToken.split('.');
    if (parts.length !== 3) return undefined;
    try {
      const pad = 4 - (parts[1].length % 4 || 4);
      const normalized =
        parts[1].replace(/-/g, '+').replace(/_/g, '/') + '='.repeat(pad % 4);
      const payload = JSON.parse(
        Buffer.from(normalized, 'base64').toString('utf8'),
      ) as { email?: string };
      return payload.email;
    } catch {
      return undefined;
    }
  }
}
