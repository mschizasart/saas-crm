/**
 * Shared types for the Gmail / Microsoft OAuth 2.0 flow.
 */

export type OAuthProvider = 'google' | 'microsoft';

export interface OAuthTokenResponse {
  accessToken: string;
  /** Gmail always returns a refresh token on first consent (with
   *  `access_type=offline&prompt=consent`). Microsoft returns one when
   *  `offline_access` scope is requested. */
  refreshToken?: string;
  /** Seconds until the access token expires. */
  expiresIn: number;
  /** The email address the user consented with — resolved from the
   *  id_token (Google) or /me endpoint (Microsoft) in the service. */
  email?: string;
  /** Scopes actually granted by the provider (may be a subset). */
  scope?: string;
}

export interface OAuthProviderService {
  readonly providerName: OAuthProvider;
  isConfigured(): boolean;
  getAuthUrl(state: string): string;
  exchangeCode(code: string): Promise<OAuthTokenResponse>;
  refreshAccessToken(refreshToken: string): Promise<OAuthTokenResponse>;
}
