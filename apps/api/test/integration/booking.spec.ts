/**
 * Integration: public self-service Booking pages — migrations 047/048.
 *
 * Admin creates a booking page (authed), then the public unauthenticated
 * endpoints render the page + list slots + accept a booking request. Double
 * opt-in is active, so /book returns {status:'pending'} (we don't chase the
 * email token). Uses the seeded admin token for CRUD (isAdmin bypasses the
 * `bookingPages.*` perms); public routes need no auth.
 *
 * Skips automatically when the test DB is unavailable (see _helpers).
 */
import * as supertest from 'supertest';
import { tryBootApp, shutdownApp } from './_helpers';
import { seedOrg, teardownOrg } from './setup';

describe('booking (integration)', () => {
  let ctx: Awaited<ReturnType<typeof tryBootApp>>;
  let api: supertest.SuperTest<supertest.Test>;
  let token: string;
  let orgId: string;
  let orgSlug: string;
  let staffId: string;

  beforeAll(async () => {
    ctx = await tryBootApp();
    if (!ctx.available || !ctx.app) return;
    api = supertest(ctx.app.getHttpServer());

    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { PrismaService } = require('../../src/database/prisma.service');
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { JwtService } = require('@nestjs/jwt');
    const prisma = ctx.app.get(PrismaService);
    const jwt = ctx.app.get(JwtService);

    const seeded = await seedOrg(ctx.app);
    orgId = seeded.org.id;
    orgSlug = seeded.org.slug;
    staffId = seeded.user.id; // seedOrg creates an active type:'staff' user
    await prisma.user.update({
      where: { id: seeded.user.id },
      data: { isAdmin: true },
    });
    token = jwt.sign(
      { sub: seeded.user.id, email: seeded.user.email, orgId, type: 'staff', isAdmin: true },
      { expiresIn: '1h' },
    );
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

  const pageSlug = `demo-${Date.now()}`;
  let pageId: string;

  const workingHours = {
    mon: [{ start: '09:00', end: '17:00' }],
    tue: [{ start: '09:00', end: '17:00' }],
    wed: [{ start: '09:00', end: '17:00' }],
    thu: [{ start: '09:00', end: '17:00' }],
    fri: [{ start: '09:00', end: '17:00' }],
  };

  /** Next weekday (Mon–Fri) at least 3 days out, within the 30-day window. */
  const nextWeekdayYmd = (): string => {
    const d = new Date();
    d.setUTCDate(d.getUTCDate() + 3);
    while (d.getUTCDay() === 0 || d.getUTCDay() === 6) {
      d.setUTCDate(d.getUTCDate() + 1);
    }
    return d.toISOString().slice(0, 10);
  };

  itDb('POST /booking-pages → 201 with publicUrl', async () => {
    const res = await api
      .post('/api/v1/booking-pages')
      .set('Authorization', `Bearer ${token}`)
      .send({
        slug: pageSlug,
        title: 'Intro Call',
        staffId,
        durationMinutes: 30,
        timezone: 'UTC',
        workingHours,
        active: true,
      });
    expect([200, 201]).toContain(res.status);
    expect(res.body.id).toBeDefined();
    expect(res.body.slug).toBe(pageSlug);
    expect(res.body.publicUrl).toEqual(expect.stringContaining(pageSlug));
    pageId = res.body.id;
  });

  itDb('GET /public/booking/:orgSlug/:pageSlug → 200 {org,page} (no auth)', async () => {
    if (!pageId) return;
    const res = await api.get(`/api/v1/public/booking/${orgSlug}/${pageSlug}`);
    expect(res.status).toBe(200);
    expect(res.body.org).toHaveProperty('name');
    expect(res.body.page).toMatchObject({
      slug: pageSlug,
      title: 'Intro Call',
      durationMinutes: 30,
      timezone: 'UTC',
    });
  });

  itDb('GET /public/booking/.../slots?date=<weekday> → 200 {slots:[...]}', async () => {
    if (!pageId) return;
    const date = nextWeekdayYmd();
    const res = await api
      .get(`/api/v1/public/booking/${orgSlug}/${pageSlug}/slots`)
      .query({ date });
    expect(res.status).toBe(200);
    expect(res.body.date).toBe(date);
    expect(res.body.timezone).toBe('UTC');
    expect(Array.isArray(res.body.slots)).toBe(true);
    // A weekday inside 09:00-17:00 with 30-min slots yields availability.
    expect(res.body.slots.length).toBeGreaterThan(0);
    expect(res.body.slots[0]).toHaveProperty('start');
    expect(res.body.slots[0]).toHaveProperty('end');
  });

  itDb('POST /public/booking/.../book → {status:"pending"} (double opt-in)', async () => {
    if (!pageId) return;
    const date = nextWeekdayYmd();
    const slotsRes = await api
      .get(`/api/v1/public/booking/${orgSlug}/${pageSlug}/slots`)
      .query({ date });
    const firstSlot = slotsRes.body.slots?.[0];
    if (!firstSlot) return; // no slot to book — availability engine returned none
    const res = await api
      .post(`/api/v1/public/booking/${orgSlug}/${pageSlug}/book`)
      .send({
        name: 'Visitor Person',
        email: `visitor+${Date.now()}@example.com`,
        startTime: firstSlot.start,
      });
    // Double opt-in: creation succeeds as PENDING, email confirm required.
    expect([200, 201]).toContain(res.status);
    expect(res.body.status).toBe('pending');
  });

  itDb('DELETE /booking-pages/:id → 204', async () => {
    if (!pageId) return;
    const res = await api
      .delete(`/api/v1/booking-pages/${pageId}`)
      .set('Authorization', `Bearer ${token}`);
    expect([200, 204]).toContain(res.status);

    // Deleted (or now-inactive) page is no longer publicly resolvable.
    const after = await api.get(`/api/v1/public/booking/${orgSlug}/${pageSlug}`);
    expect(after.status).toBe(404);
  });
});
