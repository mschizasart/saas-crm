import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { REQUIRE_SCOPES_KEY } from './require-scopes.decorator';

/**
 * Scope-based authorization for the public Integration API.
 *
 * Runs AFTER `JwtOrApiKeyGuard` (which has already populated
 * `request.user`). It reads the `@RequireScopes(...)` metadata and:
 *
 *   1. If the route declares NO required scopes → ALLOW (a valid principal
 *      is enough — e.g. /integration/me, /integration/scopes).
 *
 *   2. If `request.user.type === 'api-key'` → the key must carry EVERY
 *      required scope in its `user.scopes` array, otherwise 403. A `*`
 *      scope is treated as all-access (full grant).
 *
 *   3. If the principal is a JWT user, only ORG ADMINS are allowed on a
 *      scoped route. A non-admin staff JWT is DENIED (403). Rationale: this
 *      controller does NOT apply RbacGuard (RbacGuard denies api-key
 *      principals, which is why a scope-based surface exists), so allowing
 *      arbitrary JWT staff here would let a low-privilege user bypass their
 *      role's @Permissions on the normal controllers (privilege escalation).
 *      The integration surface is api-key-first; admins may use their JWT to
 *      test it. Non-admin staff must use a scoped api-key like any other
 *      integration client.
 *
 * Note: routes with NO @RequireScopes (e.g. /me, /scopes, /events) are
 * non-sensitive read-only metadata and remain open to any valid principal.
 */
@Injectable()
export class ScopesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const required =
      this.reflector.getAllAndOverride<string[]>(REQUIRE_SCOPES_KEY, [
        context.getHandler(),
        context.getClass(),
      ]) ?? [];

    // No scopes required — any authenticated principal may pass.
    if (required.length === 0) return true;

    const req = context.switchToHttp().getRequest();
    const user = req?.user;

    if (!user) return true; // no principal → JwtOrApiKeyGuard already 401s

    // JWT principal (org's own staff): only admins may use scoped integration
    // routes. Non-admin staff are denied so they can't bypass their RBAC role
    // via this RbacGuard-less surface (privilege escalation). See class doc.
    if (user.type !== 'api-key') {
      if (user.isAdmin === true) return true;
      throw new ForbiddenException(
        'The integration API requires a scoped API key for non-admin users.',
      );
    }

    const scopes: string[] = Array.isArray(user.scopes) ? user.scopes : [];

    // Wildcard = full access.
    if (scopes.includes('*')) return true;

    const missing = required.find((s) => !scopes.includes(s));
    if (missing) {
      throw new ForbiddenException(`Missing required scope: ${missing}`);
    }
    return true;
  }
}
