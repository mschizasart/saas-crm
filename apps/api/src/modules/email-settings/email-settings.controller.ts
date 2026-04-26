import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Put,
  Query,
  Res,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  EmailSettingsService,
  UpsertEmailSettingsDto,
} from './email-settings.service';
import { EmailOAuthService } from './oauth/email-oauth.service';
import { OAuthProvider } from './oauth/oauth.types';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RbacGuard } from '../../common/guards/rbac.guard';
import { CurrentOrg } from '../../common/decorators/current-org.decorator';
import { Permissions } from '../../common/decorators/permissions.decorator';
import { ConfigService } from '@nestjs/config';

@ApiTags('Email Settings')
@Controller({ version: '1', path: 'email-settings' })
@ApiBearerAuth()
export class EmailSettingsController {
  constructor(
    private service: EmailSettingsService,
    private oauth: EmailOAuthService,
    private config: ConfigService,
  ) {}

  @Get()
  @UseGuards(JwtAuthGuard, RbacGuard)
  @Permissions('settings.view')
  @ApiOperation({ summary: 'Get this org email/SMTP settings (password redacted)' })
  get(@CurrentOrg() org: any) {
    return this.service.getForOrg(org.id);
  }

  @Put()
  @UseGuards(JwtAuthGuard, RbacGuard)
  @Permissions('settings.edit')
  @ApiOperation({ summary: 'Upsert email/SMTP settings for this org' })
  upsert(@CurrentOrg() org: any, @Body() body: UpsertEmailSettingsDto) {
    return this.service.upsert(org.id, body);
  }

  @Post('test')
  @UseGuards(JwtAuthGuard, RbacGuard)
  @Permissions('settings.edit')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Send a test email using current or overridden config' })
  test(
    @CurrentOrg() org: any,
    @Body() body: { to: string; override?: UpsertEmailSettingsDto },
  ) {
    return this.service.sendTest(org.id, body.to, body.override);
  }

  // ─── OAuth 2.0 flow ───────────────────────────────────────────────────

  @Get('oauth/config')
  @UseGuards(JwtAuthGuard, RbacGuard)
  @Permissions('settings.view')
  @ApiOperation({
    summary: 'Report which OAuth providers are configured on this server',
  })
  oauthConfig() {
    return this.oauth.getConfigStatus();
  }

  /**
   * Returns the provider consent URL. We deliberately return JSON rather
   * than 302 so the caller can decide whether to full-page redirect or
   * open the consent in a popup.
   */
  @Get('oauth/:provider/start')
  @UseGuards(JwtAuthGuard, RbacGuard)
  @Permissions('settings.edit')
  @ApiOperation({ summary: 'Get the OAuth consent URL for this provider' })
  startOAuth(
    @CurrentOrg() org: any,
    @Param('provider') provider: string,
  ): { authUrl: string } {
    const p = this.assertProvider(provider);
    return { authUrl: this.oauth.getAuthUrl(org.id, p) };
  }

  /**
   * PUBLIC endpoint — the provider redirects the user's browser here,
   * so there's no Bearer token. All authorization is derived from the
   * HMAC-signed `state` param, which binds the callback to a specific
   * orgId and expires after 10 minutes.
   */
  @Get('oauth/:provider/callback')
  @ApiOperation({ summary: 'OAuth 2.0 redirect target — public, state-validated' })
  async oauthCallback(
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
      return res.redirect(`${appUrl}/settings/email?${qs}`);
    };

    if (error) {
      return back({ oauth_error: error });
    }

    try {
      const p = this.assertProvider(provider);
      const { connectedEmail } = await this.oauth.handleCallback(p, code, state);
      return back({
        connected: '1',
        provider: p,
        ...(connectedEmail ? { email: connectedEmail } : {}),
      });
    } catch (e) {
      const msg = (e as Error).message || 'OAuth callback failed';
      return back({ oauth_error: msg });
    }
  }

  @Delete('oauth')
  @UseGuards(JwtAuthGuard, RbacGuard)
  @Permissions('settings.edit')
  @ApiOperation({ summary: 'Disconnect the OAuth mailbox for this org' })
  @HttpCode(HttpStatus.NO_CONTENT)
  async disconnectOAuth(@CurrentOrg() org: any) {
    await this.oauth.disconnect(org.id);
  }

  private assertProvider(p: string): OAuthProvider {
    if (p !== 'google' && p !== 'microsoft') {
      throw new Error(`Unsupported OAuth provider: ${p}`);
    }
    return p;
  }
}
