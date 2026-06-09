import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { ApiKeyStrategy } from './strategies/api-key.strategy';

/**
 * Per-controller guard that accepts EITHER a JWT bearer or a public-API
 * key bearer (`Authorization: Bearer crm_<prefix>_<secret>`).
 *
 * ─── Design decision (writer note) ───────────────────────────
 *
 * The PROJECT-WIDE auth chain is left untouched:
 *  - `JwtAuthGuard` is still the globally-applied guard the rest of the
 *    app relies on. It already supports the LEGACY in-app API-key path
 *    via the `x-api-key` header and the existing `api_keys` table.
 *  - We deliberately do NOT swap the global guard to one that detects the
 *    `crm_` prefix and routes between strategies, because that would
 *    silently change behavior on hundreds of controllers and break the
 *    existing `x-api-key` callers if anything misroutes.
 *
 * Instead, this new guard is OPT-IN per controller. Public-API-eligible
 * controllers (clients/leads/opportunities/invoices/tickets) replace
 * their `@UseGuards(JwtAuthGuard)` with `@UseGuards(JwtOrApiKeyGuard)`
 * to additionally accept `crm_*` keys. Every other controller keeps the
 * existing JWT behavior unchanged.
 *
 * Behavior:
 *   1. If `Authorization: Bearer crm_...` is present → try the api-key
 *      strategy; on success attach `req.user` and pass.
 *   2. Otherwise → delegate to `JwtAuthGuard` (which itself falls through
 *      to the legacy `x-api-key` path if needed).
 *
 * The `@Public()` decorator continues to work (delegated to JwtAuthGuard).
 */
@Injectable()
export class JwtOrApiKeyGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly apiKeyStrategy: ApiKeyStrategy,
    private readonly jwt: JwtAuthGuard,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>('isPublic', [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;

    const req = context.switchToHttp().getRequest();
    const header: string | undefined =
      req?.headers?.authorization ?? req?.headers?.Authorization;

    // Public-API key path — only when the header explicitly carries the
    // `crm_` brand prefix. Other Bearer tokens (JWTs) fall through.
    if (typeof header === 'string' && /^Bearer\s+crm_/.test(header)) {
      const user = await this.apiKeyStrategy.authenticate(req);
      if (user) {
        req.user = user;
        return true;
      }
      throw new UnauthorizedException('Invalid API key');
    }

    // Default path: existing JWT guard (which itself supports legacy
    // `x-api-key`).
    return this.jwt.canActivate(context) as Promise<boolean>;
  }
}
