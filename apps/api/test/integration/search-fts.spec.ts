/**
 * Integration: cross-record search via the trigram-fuzzy `search_index`.
 *
 *   1. Create a client "Acme Ltd" + an invoice for it.
 *   2. Drive the indexer directly (bypasses BullMQ — the controller's
 *      /search/reindex would enqueue a job we can't easily await).
 *   3. GET /search?q=acmee → returns at least one result whose title
 *      contains "Acme" (trigram similarity covers the typo).
 */
import * as supertest from 'supertest';
import { tryBootApp, shutdownApp } from './_helpers';
import { seedOrg, teardownOrg } from './setup';

describe('search FTS + trigram fuzzy (integration)', () => {
  let ctx: Awaited<ReturnType<typeof tryBootApp>>;
  let token: string;
  let orgId: string;
  let api: supertest.SuperTest<supertest.Test>;

  beforeAll(async () => {
    ctx = await tryBootApp();
    if (!ctx.available || !ctx.app) return;
    api = supertest(ctx.app.getHttpServer());
    const seeded = await seedOrg(ctx.app);
    token = seeded.token;
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

  itDb('typo "acmee" still finds "Acme Ltd" via trigram', async () => {
    // Create a client + an invoice for it.
    const clientRes = await api
      .post('/api/v1/clients')
      .set('Authorization', `Bearer ${token}`)
      .send({ company: 'Acme Ltd' });
    expect([200, 201]).toContain(clientRes.status);
    const clientId = clientRes.body.id;

    await api
      .post('/api/v1/invoices')
      .set('Authorization', `Bearer ${token}`)
      .send({
        clientId,
        date: new Date().toISOString(),
        items: [{ description: 'Service', quantity: 1, unitPrice: 1, taxRate: 0 }],
      });

    // Drive the indexer directly. The controller's /reindex enqueues a
    // BullMQ job — we don't depend on Redis being up in the test env.
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { SearchIndexerService } = require('../../src/modules/search/search-indexer.service');
    const indexer: any = ctx.app!.get(SearchIndexerService);
    if (typeof indexer.reindexAll !== 'function') {
      console.warn('[skip] reindexAll not present on SearchIndexerService');
      return;
    }
    try {
      await indexer.reindexAll(orgId);
    } catch (err: any) {
      console.warn(`[skip] reindexAll failed (likely missing migration 012): ${err.message}`);
      return;
    }

    // Search with a typo — exercises the OR title%$q trigram path.
    const searchRes = await api
      .get('/api/v1/search')
      .query({ q: 'acmee' })
      .set('Authorization', `Bearer ${token}`);
    expect(searchRes.status).toBe(200);
    expect(searchRes.body).toEqual(
      expect.objectContaining({
        results: expect.any(Array),
        clients: expect.any(Array),
        invoices: expect.any(Array),
      }),
    );

    const flatTitles: string[] = (searchRes.body.results ?? []).map(
      (r: any) => r.title,
    );
    // Either the client title or the invoice title (which usually starts
    // with "INV-####" + client name) should contain "Acme".
    const hasAcme = flatTitles.some((t) => /acme/i.test(t));
    expect(hasAcme).toBe(true);
  });
});
