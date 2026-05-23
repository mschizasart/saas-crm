import {
  Controller,
  Post,
  Param,
  Req,
  Body,
  Logger,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { PrismaService } from '../../database/prisma.service';
import { SmsConfigService } from './sms-config.service';
import { Public } from '../../common/decorators/permissions.decorator';

/**
 * Public inbound-SMS webhook for Twilio.
 *
 * Twilio POSTs application/x-www-form-urlencoded with From / To / Body /
 * MessageSid when a message arrives at the tenant's number. There is no JWT —
 * the route is @Public() (JwtAuthGuard skips) and its `/public/` path is in
 * the TenantInterceptor skip-list, so the org is resolved here from :orgSlug.
 *
 * SECURITY — Twilio request signature validation IS enforced (NOT stubbed):
 *   Twilio signs each request with the account's Auth Token and sends the
 *   signature in the `X-Twilio-Signature` header. We recompute it with the
 *   official SDK's `twilio.validateRequest(authToken, signature, url, params)`
 *   over the EXACT public URL Twilio called + the POSTed params, and reject
 *   (403) on mismatch. This prevents an attacker from POSTing spoofed inbound
 *   messages into a tenant's thread.
 *
 *   The URL Twilio signs must match byte-for-byte. Twilio always calls the
 *   public HTTPS URL it has on file, which may differ from what Fastify sees
 *   behind a reverse proxy. We reconstruct it from, in order of preference:
 *     1. SMS_WEBHOOK_BASE_URL env (recommended — set to the exact public
 *        origin, e.g. https://api.appoinly.com)
 *     2. APP_URL / FRONTEND_URL env
 *     3. X-Forwarded-Proto / X-Forwarded-Host headers (proxy hints)
 *     4. the raw request host (last resort)
 *   plus the original request path.
 */
@ApiTags('SMS')
@Controller({ version: '1' })
export class SmsWebhookController {
  private readonly logger = new Logger(SmsWebhookController.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    private readonly sms: SmsConfigService,
  ) {}

  @Post('public/sms/webhook/:orgSlug')
  @Public()
  @ApiOperation({ summary: 'Twilio inbound-SMS webhook (public, signature-validated)' })
  async inbound(
    @Param('orgSlug') orgSlug: string,
    @Req() req: any,
    @Body() body: Record<string, string>,
  ): Promise<{ ok: boolean }> {
    const org = await this.prisma.organization.findUnique({
      where: { slug: orgSlug },
      select: { id: true },
    });
    if (!org) {
      // 404 rather than leaking which slugs exist via timing differences in
      // signature checks — there's nothing to do for an unknown org.
      throw new NotFoundException('Organization not found');
    }

    // Fast fail-closed guard: a genuine Twilio request ALWAYS carries the
    // X-Twilio-Signature header. If it's absent, reject immediately — no point
    // doing the org token-decrypt + SDK validate call (which would have
    // returned false anyway, but only after the extra work, and with a
    // misleading "bad signature" warning).
    const signature =
      req.headers?.['x-twilio-signature'] ||
      req.headers?.['X-Twilio-Signature'];
    if (!signature) {
      this.logger.warn(
        `Inbound SMS webhook for org ${orgSlug} rejected: missing X-Twilio-Signature header`,
      );
      throw new ForbiddenException('Missing Twilio signature');
    }

    // The auth token used to validate the signature is the SAME token the org
    // configured for sending (Twilio signs inbound webhooks with the account's
    // auth token). No saved token → we cannot validate → reject.
    const authToken = await this.sms.getAuthTokenForOrg(org.id);
    if (!authToken) {
      this.logger.warn(
        `Inbound SMS webhook for org ${orgSlug} rejected: no Twilio auth token configured`,
      );
      throw new ForbiddenException('SMS not configured for this organization');
    }

    const url = this.reconstructUrl(req);

    let valid = false;
    try {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const twilio = require('twilio');
      valid = twilio.validateRequest(authToken, signature, url, body || {});
    } catch (e) {
      this.logger.error(
        `Twilio signature validation threw for org ${orgSlug}: ${(e as Error).message}`,
      );
      valid = false;
    }

    if (!valid) {
      this.logger.warn(
        `Inbound SMS webhook for org ${orgSlug} rejected: bad X-Twilio-Signature (url=${url})`,
      );
      throw new ForbiddenException('Invalid Twilio signature');
    }

    const from = body?.From ?? '';
    const to = body?.To ?? '';
    const text = body?.Body ?? '';
    const sid = body?.MessageSid ?? body?.SmsSid ?? null;

    await this.sms.logInbound(org.id, {
      from,
      to,
      body: text,
      providerSid: sid,
    });

    // Twilio expects 2xx. An empty TwiML/200 means "no auto-reply".
    return { ok: true };
  }

  private reconstructUrl(req: any): string {
    const explicit =
      this.config.get<string>('SMS_WEBHOOK_BASE_URL') ||
      this.config.get<string>('APP_URL') ||
      this.config.get<string>('FRONTEND_URL');

    const path = req.url ?? req.raw?.url ?? '';

    if (explicit) {
      return `${explicit.replace(/\/+$/, '')}${path}`;
    }

    const proto =
      req.headers?.['x-forwarded-proto'] ||
      req.protocol ||
      'https';
    const host =
      req.headers?.['x-forwarded-host'] ||
      req.headers?.host ||
      req.hostname ||
      '';
    return `${proto}://${host}${path}`;
  }
}
