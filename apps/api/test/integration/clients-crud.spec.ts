/**
 * Integration: full CRUD lifecycle against the real /clients endpoints.
 *
 * Skips automatically when the test DB is not available (see _helpers).
 */
import * as supertest from 'supertest';
import { tryBootApp, shutdownApp } from './_helpers';
import { seedOrg, teardownOrg } from './setup';

describe('clients CRUD (integration)', () => {
  let ctx: Awaited<ReturnType<typeof tryBootApp>>;
  let token: string;
  let altToken: string;
  let orgId: string;
  let altOrgId: string;
  let api: supertest.SuperTest<supertest.Test>;

  beforeAll(async () => {
    ctx = await tryBootApp();
    if (!ctx.available || !ctx.app) return;

    api = supertest(ctx.app.getHttpServer());

    const seeded = await seedOrg(ctx.app);
    token = seeded.token;
    orgId = seeded.org.id;
    const seededAlt = await seedOrg(ctx.app);
    altToken = seededAlt.token;
    altOrgId = seededAlt.org.id;
  });

  afterAll(async () => {
    if (ctx?.available && ctx.app) {
      if (orgId) await teardownOrg(ctx.app, orgId);
      if (altOrgId) await teardownOrg(ctx.app, altOrgId);
      await shutdownApp(ctx.app);
    }
  });

  // Wrapper that no-ops if the suite is skipped at runtime
  const itDb = (name: string, fn: () => Promise<void>) =>
    it(name, async () => {
      if (!ctx?.available) {
        console.warn(`[skip] ${name}: ${ctx?.reason}`);
        return;
      }
      await fn();
    });

  let createdClientId: string;

  itDb('POST /clients → 201 with created shape', async () => {
    const res = await api
      .post('/api/v1/clients')
      .set('Authorization', `Bearer ${token}`)
      .send({ company: 'Integration Acme' });
    expect([201, 200]).toContain(res.status);
    expect(res.body).toMatchObject({ company: 'Integration Acme' });
    expect(res.body.id).toBeDefined();
    createdClientId = res.body.id;
  });

  itDb('GET /clients/:id → 200 with full record', async () => {
    if (!createdClientId) return;
    const res = await api
      .get(`/api/v1/clients/${createdClientId}`)
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.id).toBe(createdClientId);
    expect(res.body.company).toBe('Integration Acme');
  });

  itDb('PATCH /clients/:id → 200 with updated fields', async () => {
    if (!createdClientId) return;
    const res = await api
      .patch(`/api/v1/clients/${createdClientId}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ company: 'Renamed Co' });
    expect(res.status).toBe(200);
    expect(res.body.company).toBe('Renamed Co');
  });

  itDb('cross-tenant token cannot see this client (RLS)', async () => {
    if (!createdClientId) return;
    const res = await api
      .get(`/api/v1/clients/${createdClientId}`)
      .set('Authorization', `Bearer ${altToken}`);
    // Either 404 (RLS hides) or 403 (route guard rejects)
    expect([403, 404]).toContain(res.status);
  });

  itDb('DELETE /clients/:id → 204', async () => {
    if (!createdClientId) return;
    const res = await api
      .delete(`/api/v1/clients/${createdClientId}`)
      .set('Authorization', `Bearer ${token}`);
    expect([200, 204]).toContain(res.status);
  });
});
