import {
  Injectable,
  NestInterceptor,
  ExecutionContext,
  CallHandler,
  NotFoundException,
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

    // Skip for platform-admin routes
    const url = request.url ?? '';
    if (url.startsWith('/api/platform') || url.startsWith('/api/v1/platform')) {
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
