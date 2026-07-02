/**
 * Integration: public Integration API (Zapier/Make) scope enforcement.
 *
 * The load-bearing test here is per-key SCOPE gating (ScopesGuard), NOT RBAC.
 * We mint a PublicApiKey with only `leads.read` (via the admin JWT on
 * /settings/api-keys), then hit /integration/* with that KEY as the bearer:
 *   - reads it's scoped for → 200
 *   - writes / other resources it lacks scope for → 403
 *
 * The plaintext key is returned ONCE on create (field `key`). Skips when the
 * test DB is unavailable (see _helpers).
 */
import * as supertest from 'supertest';
import { tryBootApp, shutdownApp } from './_helpers';
import { seedOrg, teardownOrg } from './setup';

describe('integration-api scopes (integration)', () => {
  let ctx: Awaited<ReturnType<typeof tryBootApp>>;
  let api: supertest.SuperTest<supertest.Test>;
  let jwtToken: string;
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
    jwtToken = jwt.sign(
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

  let apiKeyId: string;
  let apiKey: string; // the plaintext `crm_..._...` key

  itDb('POST /settings/api-keys → creates a leads.read-scoped key (plaintext once)', async () => {
    const res = await api
      .post('/api/v1/settings/api-keys')
      .set('Authorization', `Bearer ${jwtToken}`)
      .send({ name: 'Zapier test key', scopes: ['leads.read'] });
    expect([200, 201]).toContain(res.status);
    expect(res.body.id).toBeDefined();
    // The full key is returned exactly once, under `key`.
    expect(typeof res.body.key).toBe('string');
    expect(res.body.key).toMatch(/^crm_[a-f0-9]{8}_[a-f0-9]{64}$/);
    expect(res.body.scopes).toEqual(['leads.read']);
    apiKeyId = res.body.id;
    apiKey = res.body.key;
  });

  itDb('GET /integration/me with the key → 200 with scopes:[leads.read]', async () => {
    if (!apiKey) return;
    const res = await api
      .get('/api/v1/integration/me')
      .set('Authorization', `Bearer ${apiKey}`);
    expect(res.status).toBe(200);
    expect(res.body.principal.type).toBe('api-key');
    expect(res.body.scopes).toEqual(['leads.read']);
    expect(res.body.organization).toHaveProperty('id', orgId);
  });

  itDb('GET /integration/leads with the key → 200 (scope granted)', async () => {
    if (!apiKey) return;
    const res = await api
      .get('/api/v1/integration/leads')
      .set('Authorization', `Bearer ${apiKey}`);
    expect(res.status).toBe(200);
    // findAll returns a paginated envelope; just assert it resolved.
    expect(res.body).toBeDefined();
  });

  itDb('POST /integration/leads with the key → 403 (missing leads.write)', async () => {
    if (!apiKey) return;
    const res = await api
      .post('/api/v1/integration/leads')
      .set('Authorization', `Bearer ${apiKey}`)
      .send({ name: 'Should Not Be Created' });
    expect(res.status).toBe(403);
  });

  itDb('GET /integration/invoices with the key → 403 (missing invoices.read)', async () => {
    if (!apiKey) return;
    const res = await api
      .get('/api/v1/integration/invoices')
      .set('Authorization', `Bearer ${apiKey}`);
    expect(res.status).toBe(403);
  });

  itDb('DELETE /settings/api-keys/:id → revokes the key', async () => {
    if (!apiKeyId) return;
    const res = await api
      .delete(`/api/v1/settings/api-keys/${apiKeyId}`)
      .set('Authorization', `Bearer ${jwtToken}`);
    expect([200, 204]).toContain(res.status);
    if (res.status === 200) {
      expect(res.body).toMatchObject({ revoked: true });
    }
  });

  itDb('a revoked key no longer authenticates → 401', async () => {
    if (!apiKey) return;
    const res = await api
      .get('/api/v1/integration/me')
      .set('Authorization', `Bearer ${apiKey}`);
    expect(res.status).toBe(401);
  });
});
