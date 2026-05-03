import {
  Controller,
  Get,
  Param,
  Query,
  Req,
  Res,
  Logger,
  HttpStatus,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Public } from '../../common/decorators/permissions.decorator';
import { PrismaService } from '../../database/prisma.service';

/**
 * Tracking endpoints for outbound email — both are unauthenticated and
 * cheap by design. The `:trackingId` parameter is the unique short id we
 * generate per OutboundMessage row (see EmailsService.send / queue).
 *
 * NOTE: these routes deliberately do NOT go through PrismaService.withOrganization
 * because the request is anonymous — they look up by trackingId which is
 * globally unique (enforced via the unique index in migration 011). RLS would
 * otherwise hide every row.
 */
// 43-byte minimal transparent GIF89a — the standard tracking pixel payload.
const TRACKING_PIXEL = Buffer.from([
  0x47, 0x49, 0x46, 0x38, 0x39, 0x61, 0x01, 0x00, 0x01, 0x00, 0x80, 0x00, 0x00,
  0x00, 0x00, 0x00, 0xff, 0xff, 0xff, 0x21, 0xf9, 0x04, 0x01, 0x00, 0x00, 0x00,
  0x00, 0x2c, 0x00, 0x00, 0x00, 0x00, 0x01, 0x00, 0x01, 0x00, 0x00, 0x02, 0x02,
  0x44, 0x01, 0x00, 0x3b,
]);

const MAX_CLICKED_URLS = 50;

@ApiTags('Email Tracking')
@Controller({ version: '1', path: 'track' })
export class EmailTrackingController {
  private readonly logger = new Logger(EmailTrackingController.name);

  constructor(private readonly prisma: PrismaService) {}

  // ─── Open pixel ───────────────────────────────────────────────────────────
  // Path includes a literal `.gif` so MUAs that prefetch images don't
  // get tripped up by a bare path. We always return the GIF — even if
  // the trackingId isn't found — so we don't leak information about
  // which IDs are valid.
  @Public()
  @Get('open/:trackingId.gif')
  @ApiOperation({ summary: '1×1 transparent GIF that records an open event' })
  async open(
    @Param('trackingId') trackingId: string,
    // FastifyReply — typed loosely to match the rest of the codebase
    // (see email-settings.controller.ts) and avoid a hard dep on the
    // exact fastify type names.
    @Res() res: any,
  ) {
    // Single-round-trip update covering all three counters:
    //   - openCount += 1
    //   - lastOpenedAt := NOW()
    //   - openedAt    := NOW() ONLY if currently NULL (first-open)
    //
    // Raw SQL because Prisma can't express "set-if-null" without a
    // separate read. WHERE clause matches by trackingId only; the row
    // either exists or it doesn't (no-op, 0 rows affected). We do NOT
    // surface a 404 — that would let an attacker probe valid IDs.
    void this.prisma.$executeRaw`
      UPDATE "outbound_messages"
      SET
        "openCount"    = "openCount" + 1,
        "lastOpenedAt" = NOW(),
        "openedAt"     = COALESCE("openedAt", NOW())
      WHERE "trackingId" = ${trackingId}
    `.catch((e: any) => {
      this.logger.warn(
        `Open tracking write failed for ${trackingId}: ${e?.message ?? e}`,
      );
    });

    // Always return the pixel — never give a hint to the caller about
    // whether we actually recorded anything.
    res
      .header('Content-Type', 'image/gif')
      .header('Cache-Control', 'no-store, no-cache, must-revalidate, private')
      .header('Pragma', 'no-cache')
      .header('Expires', '0')
      .header('Content-Length', String(TRACKING_PIXEL.length))
      .status(HttpStatus.OK)
      .send(TRACKING_PIXEL);
  }

  // ─── Click redirect ───────────────────────────────────────────────────────
  // We accept the original URL via `?u=<encoded>`. Validate strictly
  // before redirecting — open redirects are a real phishing vector.
  @Public()
  @Get('click/:trackingId')
  @ApiOperation({ summary: 'Records a click event then 302-redirects' })
  async click(
    @Param('trackingId') trackingId: string,
    @Query('u') target: string | undefined,
    @Req() req: any,
    @Res() res: any,
  ) {
    const safeFallback = process.env.APP_URL ?? 'https://example.com';

    if (!target || typeof target !== 'string') {
      return res.redirect(safeFallback, HttpStatus.FOUND);
    }

    let parsed: URL;
    try {
      parsed = new URL(target);
    } catch {
      this.logger.warn(`Click tracking: invalid URL for ${trackingId}`);
      return res.redirect(safeFallback, HttpStatus.FOUND);
    }

    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      this.logger.warn(
        `Click tracking: rejected ${parsed.protocol} for ${trackingId}`,
      );
      return res.redirect(safeFallback, HttpStatus.FOUND);
    }

    // Capture click metadata BEFORE the redirect — fire-and-forget so the
    // user is not blocked if Postgres is slow.
    const ip = (req.headers['x-forwarded-for'] as string)?.split(',')[0]?.trim()
      || (req as any).ip
      || null;
    const userAgent = (req.headers['user-agent'] as string) ?? null;
    const at = new Date();
    const entry = { url: target, at: at.toISOString(), ip, userAgent };

    // Atomic JSONB push, bounded to MAX_CLICKED_URLS:
    //   COALESCE("clickedUrls", '[]') || $1
    // then trim to the last MAX_CLICKED_URLS using jsonb_path_query_array.
    // Using a single UPDATE keeps the hot path to one round trip.
    void this.prisma.$executeRaw`
      UPDATE "outbound_messages"
      SET
        "clickCount"      = "clickCount" + 1,
        "lastClickedAt"   = ${at},
        "clickedAt"       = COALESCE("clickedAt", ${at}),
        "clickedUrls"     = (
          CASE
            WHEN jsonb_array_length(COALESCE("clickedUrls", '[]'::jsonb)) >= ${MAX_CLICKED_URLS}
            THEN (COALESCE("clickedUrls", '[]'::jsonb) - 0) || ${JSON.stringify(entry)}::jsonb
            ELSE COALESCE("clickedUrls", '[]'::jsonb) || ${JSON.stringify(entry)}::jsonb
          END
        )
      WHERE "trackingId" = ${trackingId}
    `.catch((e: any) => {
      this.logger.warn(
        `Click tracking write failed for ${trackingId}: ${e?.message ?? e}`,
      );
    });

    return res.redirect(target, HttpStatus.FOUND);
  }
}
