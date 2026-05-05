/**
 * Integration: web push subscription lifecycle.
 *
 *   1. POST /push/subscribe with a fake VAPID-like endpoint + keys → 201.
 *   2. Assert PushSubscription row exists with the right userId / endpoint.
 *   3. POST /push/test → returns { sent, failed, removed }. With VAPID
 *      not configured in the test env it'll be {0,0,0}; we still verify
 *      the route returns the well-formed shape.
 *   4. DELETE /push/subscribe with the same endpoint → row removed.
 */
import * as supertest from 'supertest';
import { tryBootApp, shutdownApp } from './_helpers';
import { seedOrg, teardownOrg } from './setup';

describe('web push subscribe / test / unsubscribe (integration)', () => {
  let ctx: Awaited<ReturnType<typeof tryBootApp>>;
  let token: string;
  let userId: string;
  let orgId: string;
  let api: supertest.SuperTest<supertest.Test>;

  beforeAll(async () => {
    ctx = await tryBootApp();
    if (!ctx.available || !ctx.app) return;
    api = supertest(ctx.app.getHttpServer());
    const seeded = await seedOrg(ctx.app);
    token = seeded.token;
    userId = seeded.user.id;
    orgId = seeded.org.id;
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

  itDb('subscribe → row exists → test → delete → row gone', async () => {
    const endpoint = `https://fcm.googleapis.com/fake-${Date.now()}`;

    const subRes = await api
      .post('/api/v1/push/subscribe')
      .set('Authorization', `Bearer ${token}`)
      .send({
        endpoint,
        keys: {
          p256dh: 'BFakeP256dhKeyDataForTest_______________________________',
          auth: 'FakeAuthSecret___________',
        },
        userAgent: 'Jest test runner',
      });
    expect([200, 201]).toContain(subRes.status);
    expect(subRes.body.success).toBe(true);

    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { PrismaService } = require('../../src/database/prisma.service');
    const prisma = ctx.app!.get(PrismaService);
    const stored = await prisma.pushSubscription.findUnique({
      where: { endpoint },
    });
    expect(stored).not.toBeNull();
    expect(stored.userId).toBe(userId);
    expect(stored.organizationId).toBe(orgId);

    // /test — VAPID likely not configured in the test env. The route still
    // returns a well-formed result.
    const testRes = await api
      .post('/api/v1/push/test')
      .set('Authorization', `Bearer ${token}`);
    expect([200, 201]).toContain(testRes.status);
    expect(testRes.body).toEqual(
      expect.objectContaining({
        sent: expect.any(Number),
        failed: expect.any(Number),
        removed: expect.any(Number),
      }),
    );

    const delRes = await api
      .delete('/api/v1/push/subscribe')
      .set('Authorization', `Bearer ${token}`)
      .send({ endpoint });
    expect([200, 204]).toContain(delRes.status);

    const after = await prisma.pushSubscription.findUnique({ where: { endpoint } });
    expect(after).toBeNull();
  });
});
