import { SetMetadata } from '@nestjs/common';

/** Reflector metadata key the ScopesGuard reads. */
export const REQUIRE_SCOPES_KEY = 'integration:requireScopes';

/**
 * Declare the scope(s) an api-key principal must carry to call a route.
 *
 *   @RequireScopes('leads.write')
 *   @RequireScopes('leads.read', 'clients.read')
 *
 * Enforcement (see ScopesGuard):
 *  - api-key principal → must carry EVERY listed scope (or `*`).
 *  - JWT principal (staff/admin) → always allowed (they're the org's own
 *    authenticated users; scopes are an api-key-only concept).
 *
 * Routes with NO @RequireScopes decorator require only a valid principal
 * (any key / any JWT) — used for /me, /scopes, /events, /events/:e/sample.
 */
export const RequireScopes = (...scopes: string[]) =>
  SetMetadata(REQUIRE_SCOPES_KEY, scopes);
