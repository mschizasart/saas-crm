import {
  Body,
  Controller,
  ForbiddenException,
  Header,
  HttpCode,
  HttpStatus,
  Logger,
  NotFoundException,
  Param,
  Post,
  Query,
  Req,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { PrismaService } from '../../database/prisma.service';
import { CallsService } from './calls.service';
import { CallsConfigService } from './calls-config.service';
import { Public } from '../../common/decorators/permissions.decorator';

/**
 * Public, signature-validated Twilio voice webhooks for the calling feature.
 *
 * Each route is @Public() (JwtAuthGuard skips) and its `/public/` path is in
 * the TenantInterceptor skip-list, so the org is resolved here from :orgSlug.
 *
 * Twilio request-signature validation IS enforced (NOT stubbed), exactly like
 * SmsWebhookController: recompute the signature with the org's auth token over
 * the EXACT public URL Twilio called + the POSTed params and reject (403) on
 * mismatch. The URL is reconstructed from SMS_WEBHOOK_BASE_URL → APP_URL →
 * FRONTEND_URL → proxy hints, plus the original request path (same base-URL
 * logic the dial flow used to BUILD the URLs, so they match byte-for-byte).
 *
 * The status + recording callbacks NEVER throw 500 for a missing row — a
 * stray callback returns 200 quietly so Twilio doesn't retry forever.
 */
@ApiTags('Calls')
@Controller({ version: '1' })
export class PublicCallsController {
  private readonly logger = new Logger(PublicCallsController.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    private readonly calls: CallsService,
    private readonly callsConfig: CallsConfigService,
  ) {}

  @Post('public/calls/twiml/:orgSlug')
  @Public()
  @Header('Content-Type', 'text/xml')
  @ApiOperation({
    summary:
      'Twilio TwiML for click-to-call — dials the customer once the agent answers (public, signature-validated)',
  })
  async twiml(
    @Param('orgSlug') orgSlug: string,
    @Query('to') to: string,
    @Req() req: any,
    @Body() body: Record<string, string>,
  ): Promise<string> {
    const org = await this.resolveOrgOrThrow(orgSlug);
    await this.validateSignature(orgSlug, org.id, req, body);

    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const twilio = require('twilio');
    const VoiceResponse = twilio.twiml.VoiceResponse;
    const response = new VoiceResponse();
    const customer = (to ?? '').trim();

    if (!customer) {
      response.say('No destination number was provided. Goodbye.');
      response.hangup();
      return response.toString();
    }

    const base = this.reconstructBase(req);
    const recordingCallback = `${base}/api/v1/public/calls/recording/${orgSlug}`;

    const dial = response.dial({
      record: 'record-from-answer',
      recordingStatusCallback: recordingCallback,
      recordingStatusCallbackMethod: 'POST',
    });
    dial.number(customer);

    return response.toString();
  }

  @Post('public/calls/status/:orgSlug')
  @Public()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Twilio call status callback (public, signature-validated)' })
  async status(
    @Param('orgSlug') orgSlug: string,
    @Req() req: any,
    @Body() body: Record<string, string>,
  ): Promise<{ ok: boolean }> {
    const org = await this.prisma.organization.findUnique({
      where: { slug: orgSlug },
      select: { id: true },
    });
    // Quietly 200 for an unknown org — never make Twilio retry.
    if (!org) return { ok: true };

    const valid = await this.signatureValid(org.id, req, body);
    if (!valid) {
      this.logger.warn(`Call status callback for ${orgSlug} rejected: bad signature`);
      return { ok: true };
    }

    await this.calls.handleStatusCallback(org.id, body || {});
    return { ok: true };
  }

  @Post('public/calls/recording/:orgSlug')
  @Public()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Twilio recording status callback (public, signature-validated)' })
  async recording(
    @Param('orgSlug') orgSlug: string,
    @Req() req: any,
    @Body() body: Record<string, string>,
  ): Promise<{ ok: boolean }> {
    const org = await this.prisma.organization.findUnique({
      where: { slug: orgSlug },
      select: { id: true },
    });
    if (!org) return { ok: true };

    const valid = await this.signatureValid(org.id, req, body);
    if (!valid) {
      this.logger.warn(`Call recording callback for ${orgSlug} rejected: bad signature`);
      return { ok: true };
    }

    await this.calls.handleRecordingCallback(org.id, body || {});
    return { ok: true };
  }

  // ─── Signature validation ─────────────────────────────────────

  private async resolveOrgOrThrow(orgSlug: string): Promise<{ id: string }> {
    const org = await this.prisma.organization.findUnique({
      where: { slug: orgSlug },
      select: { id: true },
    });
    if (!org) throw new NotFoundException('Organization not found');
    return org;
  }

  /** Throwing variant — used by the TwiML route which must hard-reject. */
  private async validateSignature(
    orgSlug: string,
    orgId: string,
    req: any,
    body: Record<string, string>,
  ): Promise<void> {
    const signature =
      req.headers?.['x-twilio-signature'] ||
      req.headers?.['X-Twilio-Signature'];
    if (!signature) {
      this.logger.warn(`Call webhook for ${orgSlug} rejected: missing signature`);
      throw new ForbiddenException('Missing Twilio signature');
    }
    const valid = await this.signatureValid(orgId, req, body);
    if (!valid) {
      this.logger.warn(`Call webhook for ${orgSlug} rejected: bad signature`);
      throw new ForbiddenException('Invalid Twilio signature');
    }
  }

  /** Non-throwing variant — used by the status/recording callbacks. */
  private async signatureValid(
    orgId: string,
    req: any,
    body: Record<string, string>,
  ): Promise<boolean> {
    const signature =
      req.headers?.['x-twilio-signature'] ||
      req.headers?.['X-Twilio-Signature'];
    if (!signature) return false;

    const authToken = await this.callsConfig.getAuthTokenForOrg(orgId);
    if (!authToken) return false;

    const url = this.reconstructUrl(req);
    try {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const twilio = require('twilio');
      return twilio.validateRequest(authToken, signature, url, body || {});
    } catch (e) {
      this.logger.error(
        `Twilio signature validation threw: ${(e as Error).message}`,
      );
      return false;
    }
  }

  private reconstructBase(req: any): string {
    const explicit =
      this.config.get<string>('SMS_WEBHOOK_BASE_URL') ||
      this.config.get<string>('APP_URL') ||
      this.config.get<string>('FRONTEND_URL');
    if (explicit) return explicit.replace(/\/+$/, '');

    const proto = req.headers?.['x-forwarded-proto'] || req.protocol || 'https';
    const host =
      req.headers?.['x-forwarded-host'] ||
      req.headers?.host ||
      req.hostname ||
      '';
    return `${proto}://${host}`;
  }

  private reconstructUrl(req: any): string {
    const path = req.url ?? req.raw?.url ?? '';
    return `${this.reconstructBase(req)}${path}`;
  }
}
