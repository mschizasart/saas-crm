import { Injectable, Logger } from '@nestjs/common';
import { ApiKeysService } from '../../public-api/api-keys.service';

/**
 * Public API key auth strategy.
 *
 * Implemented as a plain injectable (not a Passport strategy) so it can
 * be invoked directly from the combined `JwtOrApiKeyGuard` without
 * dragging in an extra `passport-custom` dependency. The token format is
 * `crm_<prefix>_<secret>` (see ApiKeysService.create for layout).
 *
 * On success the strategy returns a `request.user` shape compatible with
 * the existing JWT strategy. Specifically:
 *
 *   {
 *     sub:        'api-key:<keyId>',     // principal id, prefixed so audits
 *                                        // can distinguish humans from keys.
 *     orgId:      <orgId>,
 *     organizationId: <orgId>,           // alias — TenantInterceptor reads either.
 *     type:       'api-key',             // distinguishes from JWT 'staff' / 'contact'
 *     aud:        'public-api',
 *     isAdmin:    false,                 // FAIL-SAFE — gating is by scope, not isAdmin.
 *     scopes:     [...],
 *     apiKeyId:   <keyId>,
 *   }
 *
 * `type: 'api-key'` is what the TenantInterceptor uses to skip the
 * user-membership check (an API-key holder has no user membership row).
 * The interceptor already has a carve-out for `type !== 'api_key'` for
 * the legacy in-app key path — both are intentionally non-membership.
 *
 * `isAdmin: false` is deliberate: per-endpoint authorization for API-key
 * callers is by SCOPE, not by the JWT-era `isAdmin` bypass. RbacGuard
 * still requires the route's permission to be present, but the gating of
 * public API endpoints should layer a scope-check on top — left as a
 * follow-up on each public-API-eligible controller.
 */
@Injectable()
export class ApiKeyStrategy {
  private readonly logger = new Logger(ApiKeyStrategy.name);

  constructor(private readonly apiKeys: ApiKeysService) {}

  /**
   * Attempt to authenticate a request with the `Authorization: Bearer crm_*`
   * header. Returns the synthetic `user` object on success, or `null` on any
   * failure mode (no header, wrong prefix, bad hash, revoked, expired).
   *
   * The caller (typically `JwtOrApiKeyGuard`) is responsible for translating
   * a `null` result into a 401.
   */
  async authenticate(req: any): Promise<{
    sub: string;
    id: string;
    orgId: string;
    organizationId: string;
    type: 'api-key';
    aud: 'public-api';
    isAdmin: false;
    scopes: string[];
    apiKeyId: string;
  } | null> {
    const header: string | undefined =
      req?.headers?.authorization ?? req?.headers?.Authorization;
    if (!header || typeof header !== 'string') return null;

    const m = header.match(/^Bearer\s+(crm_[A-Za-z0-9_]+)$/);
    if (!m) return null;
    const token = m[1];

    const result = await this.apiKeys.validate(token);
    if (!result) return null;

    return {
      sub: `api-key:${result.id}`,
      id: `api-key:${result.id}`,
      orgId: result.organizationId,
      organizationId: result.organizationId,
      type: 'api-key',
      aud: 'public-api',
      isAdmin: false,
      scopes: result.scopes,
      apiKeyId: result.id,
    };
  }
}
