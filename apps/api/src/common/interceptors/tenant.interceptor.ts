import {
  Injectable,
  NestInterceptor,
  ExecutionContext,
  CallHandler,
  NotFoundException,
  ForbiddenException,
} from '@nestjs/common';
import { Observable } from 'rxjs';
import { PrismaService } from '../../database/prisma.service';

/**
 * Resolves the current tenant from:
 *  1. Subdomain (Host header): acme.yoursaas.com → slug = "acme"
 *  2. Custom domain match
 *  3. JWT claim (organizationId) — set by JwtAuthGuard
 *
 * Attaches `request.organization` for downstream use.
 */
@Injectable()
export class TenantInterceptor implements NestInterceptor {
  constructor(private prisma: PrismaService) {}

  async intercept(
    context: ExecutionContext,
    next: CallHandler,
  ): Promise<Observable<any>> {
    const request = context.switchToHttp().getRequest();

    // Skip for platform-admin routes and known org-less public endpoints.
    // `/api/v1/memberships` is also skipped because it's intentionally
    // cross-tenant — see modules/memberships/* for the rationale.
    const url = request.url ?? '';
    if (
      url.startsWith('/api/platform') ||
      url.startsWith('/api/v1/platform') ||
      url.startsWith('/api/v1/memberships') ||
      url.startsWith('/api/v1/push/public-key') ||
      url.startsWith('/api/push/public-key') ||
      // Twilio inbound-SMS webhook: org-less (no JWT, no subdomain). The
      // controller resolves the org from the :orgSlug path param itself and
      // validates the X-Twilio-Signature. See modules/sms/sms-webhook.controller.ts.
      url.startsWith('/api/v1/public/sms/webhook') ||
      url.startsWith('/api/public/sms/webhook')
    ) {
      return next.handle();
    }

    let organization: any = null;

    // 1. Try subdomain resolution
    const host = request.headers?.host || '';
    const subdomain = this.extractSubdomain(host);

    if (subdomain) {
      organization = await this.prisma.organization.findUnique({
        where: { slug: subdomain },
        select: {
          id: true,
          name: true,
          slug: true,
          subscriptionStatus: true,
          trialEndsAt: true,
          planId: true,
          settings: true,
        },
      });
    }

    // 2. Try custom domain
    if (!organization && host && !host.includes('localhost')) {
      organization = await this.prisma.organization.findFirst({
        where: { customDomain: host },
        select: {
          id: true,
          name: true,
          slug: true,
          subscriptionStatus: true,
          trialEndsAt: true,
          planId: true,
          settings: true,
        },
      });
    }

    // 3. Fall back to JWT claim (set after auth)
    if (!organization && (request.user?.orgId || request.user?.organizationId)) {
      organization = await this.prisma.organization.findUnique({
        where: { id: request.user.orgId || request.user.organizationId },
        select: {
          id: true,
          name: true,
          slug: true,
          subscriptionStatus: true,
          trialEndsAt: true,
          planId: true,
          settings: true,
        },
      });
    }

    // 4. Multi-org safety net.
    //
    // Now that a single User can belong to multiple organizations, a stale
    // JWT can point at an org the user has since been removed from. Verify
    // that the JWT.orgId still corresponds to an *accepted* membership in
    // user_organization_memberships. If it doesn't, we reject with 403 so
    // the client drops the stale token and re-logs-in. Without this check,
    // the request would continue with a tenant the user no longer has
    // access to — defeating the whole point of membership revocation.
    //
    // The previous code had a legacy `User.organizationId === JWT.orgId`
    // fallback "for un-migrated users". Post-backfill every user has a
    // membership row, so that fallback only served to UNDERMINE
    // revocation: a revoked user whose primary org still matched the JWT
    // would slip through. It has been removed.
    //
    // The API-key carve-out is preserved — only JWT users get the check.
    if (
      organization &&
      request.user?.sub /* JWT-authenticated, not API-key */ &&
      request.user?.type !== 'api_key'
    ) {
      const userId = request.user.sub;
      const membership =
        await this.prisma.userOrganizationMembership.findUnique({
          where: {
            userId_organizationId: {
              userId,
              organizationId: organization.id,
            },
          },
          select: { acceptedAt: true },
        });

      const hasMembership = !!membership && membership.acceptedAt !== null;

      if (!hasMembership) {
        throw new ForbiddenException(
          'You no longer have access to this organization.',
        );
      }
    }

    if (!organization) {
      // Allow unauthenticated public routes to pass through
      const isPublicRoute =
        request.url?.includes('/auth/') ||
        request.url?.includes('/public/') ||
        request.url?.includes('/billing/webhook');

      if (!isPublicRoute) {
        throw new NotFoundException('Organization not found');
      }
    }

    request.organization = organization;
    return next.handle();
  }

  private extractSubdomain(host: string): string | null {
    // e.g. "acme.yoursaas.com" → "acme"
    // "localhost:3001" or "yoursaas.com" → null
    const parts = host.split('.');
    if (parts.length >= 3) {
      const subdomain = parts[0];
      // Exclude common prefixes that aren't tenant slugs
      if (!['www', 'api', 'app', 'mail'].includes(subdomain)) {
        return subdomain;
      }
    }
    return null;
  }
}
