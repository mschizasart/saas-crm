/**
 * Integration: built-in call logging — migration 044.
 *
 * Log → list (paginated) → settings → update → delete against the real /calls
 * endpoints. The list endpoint's page+limit pagination regressed once, so this
 * suite asserts the {data,total,page,limit,totalPages} envelope explicitly.
 *
 * Uses the seeded admin token (isAdmin bypasses RbacGuard's `calls.*` perms).
 * Skips automatically when the test DB is not available (see _helpers).
 */
import * as supertest from 'supertest';
import { tryBootApp, shutdownApp } from './_helpers';
import { seedOrg, teardownOrg } from './setup';

describe('calls (integration)', () => {
  let ctx: Awaited<ReturnType<typeof tryBootApp>>;
  let api: supertest.SuperTest<supertest.Test>;
  let token: string;
  let orgId: string;

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

  let callId: string;

  itDb('POST /calls → 201 logs an outbound call', async () => {
    const res = await api
      .post('/api/v1/calls')
      .set('Authorization', `Bearer ${token}`)
      .send({
        direction: 'outbound',
        toNumber: '+14155550100',
        outcome: 'connected',
        notes: 'Discussed pricing',
      });
    expect([200, 201]).toContain(res.status);
    expect(res.body.id).toBeDefined();
    expect(res.body.direction).toBe('outbound');
    expect(res.body.toNumber).toBe('+14155550100');
    expect(res.body.outcome).toBe('connected');
    expect(res.body.status).toBe('logged');
    callId = res.body.id;
  });

  itDb('GET /calls?page=1&limit=10 → 200 with pagination envelope', async () => {
    const res = await api
      .get('/api/v1/calls')
      .query({ page: 1, limit: 10 })
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    // The pagination path — assert every documented envelope field.
    expect(Array.isArray(res.body.data)).toBe(true);
    expect(res.body).toMatchObject({
      total: expect.any(Number),
      page: 1,
      limit: 10,
      totalPages: expect.any(Number),
    });
    expect(res.body.total).toBeGreaterThanOrEqual(1);
    expect(res.body.data.some((c: any) => c.id === callId)).toBe(true);
  });

  itDb('GET /calls/settings → telephony status (no secrets)', async () => {
    const res = await api
      .get('/api/v1/calls/settings')
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('configured');
    expect(typeof res.body.configured).toBe('boolean');
    expect(res.body).toHaveProperty('source');
    // Auth token must never be returned by settings.
    expect(res.body).not.toHaveProperty('authToken');
  });

  itDb('PUT /calls/:id → updates outcome + notes', async () => {
    if (!callId) return;
    const res = await api
      .put(`/api/v1/calls/${callId}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ outcome: 'voicemail', notes: 'Left a voicemail' });
    expect(res.status).toBe(200);
    expect(res.body.outcome).toBe('voicemail');
    expect(res.body.notes).toBe('Left a voicemail');
  });

  itDb('DELETE /calls/:id → 204', async () => {
    if (!callId) return;
    const res = await api
      .delete(`/api/v1/calls/${callId}`)
      .set('Authorization', `Bearer ${token}`);
    expect([200, 204]).toContain(res.status);

    const after = await api
      .get(`/api/v1/calls/${callId}`)
      .set('Authorization', `Bearer ${token}`);
    expect(after.status).toBe(404);
  });
});
