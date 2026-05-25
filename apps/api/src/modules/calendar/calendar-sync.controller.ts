import {
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Query,
  Res,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { ConfigService } from '@nestjs/config';
import { CalendarSyncService } from './sync/calendar-sync.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { Public } from '../../common/decorators/permissions.decorator';
import { CurrentOrg } from '../../common/decorators/current-org.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';

/**
 * 2-way calendar sync (Google Calendar / Microsoft Outlook).
 *
 * The OAuth dance reuses the email integration's HMAC-signed state pattern
 * (modules/email-settings/oauth/oauth-state.ts) but with calendar scopes and
 * its OWN redirect URI — see CalendarSyncService for the env vars / scopes.
 *
 * NOTE: the class is protected-by-default with @UseGuards(JwtAuthGuard); the
 * /callback route is explicitly PUBLIC (the provider redirects the browser
 * with no Bearer token — @Public() overrides the class guard) and is added to
 * TenantInterceptor's skip-list so it isn't rejected for having no resolvable
 * org. All trust on the callback comes from the signed `state`.
 */
@ApiTags('Calendar Sync')
@Controller({ version: '1', path: 'calendar-sync' })
@UseGuards(JwtAuthGuard)
@ApiBearerAuth()
export class CalendarSyncController {
  constructor(
    private sync: CalendarSyncService,
    private config: ConfigService,
  ) {}

  @Get('status')
  @ApiOperation({ summary: 'List the current user’s connected calendars (redacted)' })
  status(@CurrentOrg() org: any, @CurrentUser() user: any) {
    return this.sync.getStatus(org.id, user.id);
  }

  @Get(':provider/start')
  @ApiOperation({ summary: 'Get the OAuth consent URL for a calendar provider' })
  start(
    @CurrentOrg() org: any,
    @CurrentUser() user: any,
    @Param('provider') provider: string,
  ): { authUrl: string } {
    const p = this.sync.assertProvider(provider);
    return { authUrl: this.sync.getAuthUrl(org.id, user.id, p) };
  }

  /**
   * PUBLIC redirect target. Authorization is derived from the HMAC-signed
   * `state` (binds orgId+userId+provider, 10-min TTL).
   */
  @Public()
  @Get(':provider/callback')
  @ApiOperation({ summary: 'OAuth 2.0 redirect target — public, state-validated' })
  async callback(
    @Param('provider') provider: string,
    @Query('code') code: string,
    @Query('state') state: string,
    @Query('error') error: string | undefined,
    @Res() res: any,
  ) {
    const appUrl =
      this.config.get<string>('APP_URL') ??
      this.config.get<string>('FRONTEND_URL') ??
      '';
    const back = (params: Record<string, string>) => {
      const qs = new URLSearchParams(params).toString();
      return res.redirect(`${appUrl}/calendar?${qs}`);
    };

    // The provider `error` is attacker-influenceable (it arrives on the public
    // redirect). Whitelist it to the known OAuth 2.0 error codes; anything else
    // collapses to a generic message so we never reflect arbitrary strings into
    // the redirect URL or logs.
    if (error) return back({ calendar_error: this.normalizeOAuthError(error) });

    try {
      const p = this.sync.assertProvider(provider);
      const { connectedEmail } = await this.sync.handleCallback(p, code, state);
      return back({
        connected: '1',
        provider: p,
        ...(connectedEmail ? { email: connectedEmail } : {}),
      });
    } catch (e) {
      return back({ calendar_error: (e as Error).message || 'Calendar OAuth failed' });
    }
  }

  /**
   * Clamp the provider-supplied OAuth `error` to the RFC 6749 §4.1.2.1 set
   * (plus a couple of common provider extensions). Unknown values become a
   * single generic token so attacker-controlled strings are never reflected.
   */
  private normalizeOAuthError(error: string): string {
    const KNOWN = new Set([
      'invalid_request',
      'unauthorized_client',
      'access_denied',
      'unsupported_response_type',
      'invalid_scope',
      'server_error',
      'temporarily_unavailable',
      'consent_required',
      'login_required',
      'interaction_required',
    ]);
    return KNOWN.has(error) ? error : 'oauth_error';
  }

  @Delete(':provider')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Disconnect a calendar provider for the current user' })
  async disconnect(
    @CurrentOrg() org: any,
    @CurrentUser() user: any,
    @Param('provider') provider: string,
  ) {
    const p = this.sync.assertProvider(provider);
    await this.sync.disconnect(org.id, user.id, p);
  }

  @Post(':provider/sync-now')
  @ApiOperation({ summary: 'Manually trigger a sync for the current user + provider' })
  syncNow(
    @CurrentOrg() org: any,
    @CurrentUser() user: any,
    @Param('provider') provider: string,
  ) {
    const p = this.sync.assertProvider(provider);
    return this.sync.syncForUser(user.id, p, org.id);
  }
}
