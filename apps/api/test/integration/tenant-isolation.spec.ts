/**
 * Integration: cross-tenant access is hidden, not 403.
 *
 * Two distinct orgs (A, B) — each with its own seeded staff token.
 *  - Org A creates a client.
 *  - Org B GETs the same id with its own token  → expects 404.
 *  - Org B PATCHes the same id  → expects 404 (NOT 403 — leaking
 *    "this id exists in some other tenant" is the bug we're guarding
 *    against).
 *  - Org B DELETEs the same id  → 404.
 */
import * as supertest from 'supertest';
import { tryBootApp, shutdownApp } from './_helpers';
import { seedOrg, teardownOrg } from './setup';

describe('cross-tenant isolation (integration)', () => {
  let ctx: Awaited<ReturnType<typeof tryBootApp>>;
  let api: supertest.SuperTest<supertest.Test>;
  let tokenA: string;
  let tokenB: string;
  let orgIdA: string;
  let orgIdB: string;

  beforeAll(async () => {
    ctx = await tryBootApp();
    if (!ctx.available || !ctx.app) return;
    api = supertest(ctx.app.getHttpServer());
    const a = await seedOrg(ctx.app);
    const b = await seedOrg(ctx.app);
    tokenA = a.token;
    tokenB = b.token;
    orgIdA = a.org.id;
    orgIdB = b.org.id;
    // Promote both seeded users so RBAC permission checks short-circuit;
    // the test under exercise here is tenant isolation, not authorisation.
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { PrismaService } = require('../../src/database/prisma.service');
    const prisma = ctx.app!.get(PrismaService);
    await prisma.user.update({ where: { id: a.user.id }, data: { isAdmin: true } });
    await prisma.user.update({ where: { id: b.user.id }, data: { isAdmin: true } });
  });

  afterAll(async () => {
    if (ctx?.available && ctx.app) {
      if (orgIdA) await teardownOrg(ctx.app, orgIdA);
      if (orgIdB) await teardownOrg(ctx.app, orgIdB);
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

  let orgAClientId: string;

  itDb('org A creates a client', async () => {
    const r = await api
      .post('/api/v1/clients')
      .set('Authorization', `Bearer ${tokenA}`)
      .send({ company: 'Tenant A Client' });
    expect([200, 201]).toContain(r.status);
    orgAClientId = r.body.id;
  });

  itDb('org B GET /clients/:id of org A → 404 (hidden, not 403)', async () => {
    const r = await api
      .get(`/api/v1/clients/${orgAClientId}`)
      .set('Authorization', `Bearer ${tokenB}`);
    expect(r.status).toBe(404);
  });

  itDb('org B PATCH /clients/:id of org A → 404 (no leak via 403)', async () => {
    const r = await api
      .patch(`/api/v1/clients/${orgAClientId}`)
      .set('Authorization', `Bearer ${tokenB}`)
      .send({ company: 'Hijacked Co' });
    expect(r.status).toBe(404);
  });

  itDb('org B DELETE /clients/:id of org A → 404', async () => {
    const r = await api
      .delete(`/api/v1/clients/${orgAClientId}`)
      .set('Authorization', `Bearer ${tokenB}`);
    expect(r.status).toBe(404);
  });

  itDb('the client is still intact in org A after B tried to mess with it', async () => {
    const r = await api
      .get(`/api/v1/clients/${orgAClientId}`)
      .set('Authorization', `Bearer ${tokenA}`);
    expect(r.status).toBe(200);
    expect(r.body.company).toBe('Tenant A Client');
  });
});
