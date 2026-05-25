import { Controller, Post, Param, HttpCode, HttpStatus } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Public } from '../../common/decorators/permissions.decorator';
import { CampaignsService } from './campaigns.service';

/**
 * Public (un-authenticated) campaign endpoints.
 *
 * The `/api/v1/public/campaigns` prefix is in the TenantInterceptor skip-list
 * (no JWT, no subdomain) — the org is recovered from the HMAC-signed token in
 * the path, NOT from request context. @Public() makes JwtAuthGuard skip too.
 *
 * Unsubscribe is intentionally a one-click POST: the web /unsubscribe/:token
 * page calls this on load. The token is unguessable + tamper-proof (HMAC over
 * {orgId, email} with ENCRYPTION_KEY), so only someone who received the email
 * can opt that address out — an attacker cannot forge an unsubscribe for an
 * arbitrary address.
 */
@ApiTags('Campaigns (Public)')
@Controller({ version: '1', path: 'public/campaigns' })
export class PublicCampaignsController {
  constructor(private readonly service: CampaignsService) {}

  @Public()
  @Post('unsubscribe/:token')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Unsubscribe an email from an org mailing list' })
  unsubscribe(@Param('token') token: string) {
    return this.service.unsubscribe(token);
  }
}
