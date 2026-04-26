import { Injectable, Logger, BadRequestException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  OAuthProvider,
  OAuthProviderService,
  OAuthTokenResponse,
} from './oauth.types';

/**
 * Microsoft / Outlook 365 OAuth 2.0 flow.
 *
 * Endpoint base: `https://login.microsoftonline.com/common/oauth2/v2.0/`
 * (the `common` tenant accepts both personal and work accounts).
 *
 * Scopes:
 *   - `https://outlook.office.com/SMTP.Send` — XOAUTH2 SMTP send
 *   - `offline_access`                       — return a refresh_token
 *   - `openid email profile`                 — /me call to resolve email
 */
@Injectable()
export class MicrosoftOAuthService implements OAuthProviderService {
  private readonly logger = new Logger(MicrosoftOAuthService.name);
  readonly providerName: OAuthProvider = 'microsoft';

  private static readonly AUTH_URL =
    'https://login.microsoftonline.com/common/oauth2/v2.0/authorize';
  private static readonly TOKEN_URL =
    'https://login.microsoftonline.com/common/oauth2/v2.0/token';
  private static readonly GRAPH_ME_URL = 'https://graph.microsoft.com/v1.0/me';

  private static readonly SCOPE = [
    'https://outlook.office.com/SMTP.Send',
    'offline_access',
    'openid',
    'email',
    'profile',
  ].join(' ');

  constructor(private config: ConfigService) {}

  private get clientId(): string | undefined {
    return this.config.get<string>('MICROSOFT_OAUTH_CLIENT_ID');
  }
  private get clientSecret(): string | undefined {
    return this.config.get<string>('MICROSOFT_OAUTH_CLIENT_SECRET');
  }
  private get redirectUri(): string | undefined {
    return this.config.get<string>('MICROSOFT_OAUTH_REDIRECT_URI');
  }

  isConfigured(): boolean {
    return !!(this.clientId && this.clientSecret && this.redirectUri);
  }

  private requireConfig() {
    if (!this.isConfigured()) {
      throw new BadRequestException(
        'Microsoft OAuth is not configured on this server — ask your administrator to set MICROSOFT_OAUTH_CLIENT_ID, MICROSOFT_OAUTH_CLIENT_SECRET and MICROSOFT_OAUTH_REDIRECT_URI.',
      );
    }
  }

  getAuthUrl(state: string): string {
    this.requireConfig();
    const params = new URLSearchParams({
      client_id: this.clientId!,
      redirect_uri: this.redirectUri!,
      response_type: 'code',
      response_mode: 'query',
      scope: MicrosoftOAuthService.SCOPE,
      // `prompt=select_account` lets an admin switch mailbox explicitly
      // without being silently signed in to a cached account.
      prompt: 'select_account',
      state,
    });
    return `${MicrosoftOAuthService.AUTH_URL}?${params.toString()}`;
  }

  async exchangeCode(code: string): Promise<OAuthTokenResponse> {
    this.requireConfig();
    const body = new URLSearchParams({
      code,
      client_id: this.clientId!,
      client_secret: this.clientSecret!,
      redirect_uri: this.redirectUri!,
      grant_type: 'authorization_code',
      scope: MicrosoftOAuthService.SCOPE,
    });
    const res = await fetch(MicrosoftOAuthService.TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body,
    });
    if (!res.ok) {
      const txt = await res.text().catch(() => '');
      this.logger.warn(
        `Microsoft token exchange failed: ${res.status} ${txt}`,
      );
      throw new BadRequestException(
        `Microsoft token exchange failed (${res.status})`,
      );
    }
    const json = (await res.json()) as {
      access_token: string;
      refresh_token?: string;
      expires_in: number;
      scope?: string;
      id_token?: string;
    };

    // Resolve mailbox email — try id_token first (cheap, same call),
    // fall back to Graph /me (one extra HTTP call).
    let email = this.emailFromIdToken(json.id_token);
    if (!email) {
      email = await this.emailFromGraph(json.access_token).catch(() => undefined);
    }

    return {
      accessToken: json.access_token,
      refreshToken: json.refresh_token,
      expiresIn: json.expires_in,
      email,
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
      scope: MicrosoftOAuthService.SCOPE,
    });
    const res = await fetch(MicrosoftOAuthService.TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body,
    });
    if (!res.ok) {
      const txt = await res.text().catch(() => '');
      this.logger.warn(`Microsoft refresh failed: ${res.status} ${txt}`);
      throw new BadRequestException(
        `Microsoft token refresh failed (${res.status})`,
      );
    }
    const json = (await res.json()) as {
      access_token: string;
      refresh_token?: string;
      expires_in: number;
      scope?: string;
    };
    // Microsoft rotates refresh tokens — always prefer the new one when
    // present so we stay within the 90-day inactivity window.
    return {
      accessToken: json.access_token,
      refreshToken: json.refresh_token,
      expiresIn: json.expires_in,
      scope: json.scope,
    };
  }

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
      ) as { email?: string; preferred_username?: string; upn?: string };
      return payload.email ?? payload.preferred_username ?? payload.upn;
    } catch {
      return undefined;
    }
  }

  private async emailFromGraph(accessToken: string): Promise<string | undefined> {
    const res = await fetch(MicrosoftOAuthService.GRAPH_ME_URL, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (!res.ok) return undefined;
    const json = (await res.json()) as {
      mail?: string;
      userPrincipalName?: string;
    };
    return json.mail ?? json.userPrincipalName;
  }
}
