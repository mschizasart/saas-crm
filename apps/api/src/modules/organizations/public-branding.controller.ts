import { Controller, Get, Param } from '@nestjs/common';
import { ApiTags, ApiOperation } from '@nestjs/swagger';
import { OrganizationsService } from './organizations.service';
import { Public } from '../../common/decorators/permissions.decorator';

/**
 * Unauthenticated branding lookup for the client portal login and public
 * lead/quote forms. The `public/` prefix is recognised by TenantInterceptor
 * as org-less (see common/interceptors/tenant.interceptor.ts) and the route
 * is marked @Public() so JwtAuthGuard skips it.
 *
 * Returns ONLY safe display fields (name, logo, colors). When white-label is
 * disabled — or the slug is unknown — returns `null` so the caller falls back
 * to the platform default theme. No sensitive data is exposed.
 */
@ApiTags('Organizations')
@Controller({ version: '1' })
export class PublicBrandingController {
  constructor(private service: OrganizationsService) {}

  @Get('public/branding/:orgSlug')
  @Public()
  @ApiOperation({ summary: 'Public white-label branding for an org by slug' })
  async getPublicBranding(@Param('orgSlug') orgSlug: string) {
    return this.service.getPublicBranding(orgSlug);
  }
}
