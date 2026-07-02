/**
 * Integration: duplicate detection + merge — migration 045.
 *
 * Creates two near-identical leads (same email), detects the pair, merges the
 * loser into the winner, and asserts the loser drops out of the leads list
 * (mergedIntoId set) while the winner remains. Also checks the self-merge guard.
 *
 * NOTE: detection uses pg_trgm `similarity()`; the raw query references it
 * unconditionally, so the pg_trgm extension must exist in the test DB. When the
 * DB is unavailable the whole suite skips via itDb.
 *
 * Uses the seeded admin token (isAdmin bypasses RbacGuard's `leads.*` perms).
 */
import * as supertest from 'supertest';
import { tryBootApp, shutdownApp } from './_helpers';
import { seedOrg, teardownOrg } from './setup';

describe('dedup (integration)', () => {
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

  let leadAId: string;
  let leadBId: string;
  const sharedEmail = `dupe+${Date.now()}@example.com`;

  itDb('seed two similar leads (same email)', async () => {
    const a = await api
      .post('/api/v1/leads')
      .set('Authorization', `Bearer ${token}`)
      .send({ name: 'John Smith', email: sharedEmail });
    const b = await api
      .post('/api/v1/leads')
      .set('Authorization', `Bearer ${token}`)
      .send({ name: 'Jon Smith', email: sharedEmail });
    expect([200, 201]).toContain(a.status);
    expect([200, 201]).toContain(b.status);
    leadAId = a.body.id;
    leadBId = b.body.id;
    expect(leadAId).toBeDefined();
    expect(leadBId).toBeDefined();
  });

  itDb('GET /dedup/leads/candidates → returns the pair with score/matchedOn/a/b', async () => {
    if (!leadAId || !leadBId) return;
    const res = await api
      .get('/api/v1/dedup/leads/candidates')
      .query({ threshold: 0.5 })
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.pairs)).toBe(true);

    const ids = new Set([leadAId, leadBId]);
    const pair = res.body.pairs.find(
      (p: any) => ids.has(p.a.id) && ids.has(p.b.id),
    );
    expect(pair).toBeDefined();
    expect(pair.score).toBeGreaterThan(0);
    expect(Array.isArray(pair.matchedOn)).toBe(true);
    // Same email → email is one of the matched signals and the score is 1.
    expect(pair.matchedOn).toContain('email');
    expect(pair.score).toBe(1);
    expect(pair.a).toHaveProperty('id');
    expect(pair.b).toHaveProperty('id');
  });

  itDb('POST /dedup/leads/merge with winnerId===loserId → 400 (self-merge guard)', async () => {
    if (!leadAId) return;
    const res = await api
      .post('/api/v1/dedup/leads/merge')
      .set('Authorization', `Bearer ${token}`)
      .send({ winnerId: leadAId, loserId: leadAId });
    expect(res.status).toBe(400);
  });

  itDb('POST /dedup/leads/merge → {merged:true, repointed}', async () => {
    if (!leadAId || !leadBId) return;
    const res = await api
      .post('/api/v1/dedup/leads/merge')
      .set('Authorization', `Bearer ${token}`)
      .send({ winnerId: leadAId, loserId: leadBId });
    expect(res.status).toBe(200);
    expect(res.body.merged).toBe(true);
    expect(res.body.winnerId).toBe(leadAId);
    expect(res.body.loserId).toBe(leadBId);
    expect(res.body).toHaveProperty('repointed');
    expect(typeof res.body.repointed).toBe('object');
  });

  itDb('after merge, loser is excluded from GET /leads and winner remains', async () => {
    if (!leadAId || !leadBId) return;
    const res = await api
      .get('/api/v1/leads')
      .query({ limit: 100 })
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    const list = res.body.data ?? res.body;
    const listIds = new Set((list as any[]).map((l) => l.id));
    expect(listIds.has(leadBId)).toBe(false); // loser hidden (mergedIntoId set)
    expect(listIds.has(leadAId)).toBe(true); // winner still present
  });

  itDb('re-merging an already-merged loser → 400', async () => {
    if (!leadAId || !leadBId) return;
    const res = await api
      .post('/api/v1/dedup/leads/merge')
      .set('Authorization', `Bearer ${token}`)
      .send({ winnerId: leadAId, loserId: leadBId });
    expect(res.status).toBe(400);
  });
});
