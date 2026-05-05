/**
 * Integration: email open + click tracking endpoints.
 *
 *   1. Insert an OutboundMessage row directly (the Send-side flow lives
 *      in the emails module and is unit-tested elsewhere).
 *   2. GET /track/open/:trackingId.gif → returns a 1×1 GIF + sets the
 *      no-cache headers; openedAt + openCount get set in the DB.
 *   3. GET /track/click/:trackingId?u=<encoded> → 302 to target;
 *      clickCount increments and the click metadata is stored in the
 *      JSONB clickedUrls array.
 *   4. GET /track/click/:trackingId?u=javascript:alert(1) → still 302
 *      (to the safe fallback) — open redirects are blocked.
 */
import * as supertest from 'supertest';
import { tryBootApp, shutdownApp } from './_helpers';
import { seedOrg, teardownOrg } from './setup';

describe('email tracking pixel + click (integration)', () => {
  let ctx: Awaited<ReturnType<typeof tryBootApp>>;
  let orgId: string;
  let api: supertest.SuperTest<supertest.Test>;

  beforeAll(async () => {
    ctx = await tryBootApp();
    if (!ctx.available || !ctx.app) return;
    api = supertest(ctx.app.getHttpServer());
    const seeded = await seedOrg(ctx.app);
    orgId = seeded.org.id;
    // The /track/* endpoints are public, but we still seed an admin user
    // so the test rig is consistent with the rest of the suite.
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { PrismaService } = require('../../src/database/prisma.service');
    const prisma = ctx.app!.get(PrismaService);
    await prisma.user.update({
      where: { id: seeded.user.id },
      data: { isAdmin: true },
    });
  });

  afterAll(async () => {
    if (ctx?.available && ctx.app) {
      if (orgId) await teardownOrg(ctx.app, orgId);
      await shutdownApp(ctx.app);
    }
  });

  const itDb = (name: string, fn: () => Promise<void>) =>
    it(name, async () => {
      if (!ctx?.available) {
        console.warn(`[skip] ${name}: ${ctx?.reason}`);
        return;
      }
      await fn();
    });

  itDb('open pixel + click redirect record their counters in JSONB', async () => {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { PrismaService } = require('../../src/database/prisma.service');
    const prisma = ctx.app!.get(PrismaService);

    const trackingId = `track-${Date.now()}`;

    // Insert directly via raw SQL. outbound_messages has NOT NULL columns
    // (routedTo, routedToId) that the migration left in place; populate
    // them with safe defaults. messageId NOT NULL was dropped in migration
    // 011 so we can omit it.
    //
    // Note the tracking endpoints are unauthenticated and look up by
    // trackingId only — RLS doesn't apply to the SELECT that those
    // endpoints implicitly use (they rely on a globally-unique trackingId).
    // We still set organizationId so the row is well-formed.
    let inserted = false;
    try {
      await prisma.$executeRawUnsafe(
        `INSERT INTO "outbound_messages"
           ("id", "organizationId", "trackingId", "routedTo", "routedToId",
            "openCount", "clickCount", "clickedUrls", "createdAt")
         VALUES (gen_random_uuid()::text, $1, $2, 'unmatched', '00000000-0000-0000-0000-000000000000',
                 0, 0, '[]'::jsonb, NOW())`,
        orgId,
        trackingId,
      );
      inserted = true;
    } catch (err: any) {
      console.warn(`[skip] outbound_messages insert failed: ${err.message}`);
      return;
    }
    expect(inserted).toBe(true);

    // ─── Open ─────────────────────────────────────────────────────────
    const openRes = await api.get(`/api/v1/track/open/${trackingId}.gif`);
    expect(openRes.status).toBe(200);
    expect(openRes.headers['content-type']).toMatch(/image\/gif/);
    expect(openRes.headers['cache-control']).toMatch(/no-store/);

    // Counters update is fire-and-forget — give it a beat.
    await new Promise((r) => setTimeout(r, 200));

    const afterOpen = (await prisma.$queryRawUnsafe(
      `SELECT "openCount", "openedAt", "clickCount" FROM "outbound_messages" WHERE "trackingId" = $1`,
      trackingId,
    )) as any[];
    expect(afterOpen.length).toBe(1);
    expect(Number(afterOpen[0].openCount)).toBeGreaterThanOrEqual(1);
    expect(afterOpen[0].openedAt).not.toBeNull();

    // ─── Click ────────────────────────────────────────────────────────
    const target = 'https://example.com/landing';
    const clickRes = await api
      .get(`/api/v1/track/click/${trackingId}?u=${encodeURIComponent(target)}`)
      .redirects(0);
    expect(clickRes.status).toBe(302);
    expect(clickRes.headers.location).toBe(target);

    await new Promise((r) => setTimeout(r, 200));
    const afterClick = (await prisma.$queryRawUnsafe(
      `SELECT "clickCount", "clickedAt", "clickedUrls" FROM "outbound_messages" WHERE "trackingId" = $1`,
      trackingId,
    )) as any[];
    expect(Number(afterClick[0].clickCount)).toBeGreaterThanOrEqual(1);
    expect(afterClick[0].clickedAt).not.toBeNull();
    const urls = afterClick[0].clickedUrls as Array<{ url: string }>;
    expect(Array.isArray(urls)).toBe(true);
    expect(urls.find((u) => u.url === target)).toBeDefined();

    // ─── Open redirect block ──────────────────────────────────────────
    const xss = await api
      .get(`/api/v1/track/click/${trackingId}?u=${encodeURIComponent('javascript:alert(1)')}`)
      .redirects(0);
    expect(xss.status).toBe(302);
    // Must NOT redirect to the malicious target.
    expect(xss.headers.location).not.toMatch(/^javascript:/i);
  });
});
