/**
 * Integration: proposal public-hash flow.
 *
 *   1. Staff creates a proposal → status='draft', hash returned
 *   2. Staff sends → status='sent'
 *   3. Public GET /proposals/view/:hash → returns the safe payload
 *   4. Public POST /proposals/view/:hash/open → status='open'
 *   5. Public POST /proposals/view/:hash/accept → status='accepted',
 *      signedAt set
 */
import * as supertest from 'supertest';
import { tryBootApp, shutdownApp } from './_helpers';
import { seedOrg, teardownOrg } from './setup';

describe('proposals public flow (integration)', () => {
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

  itDb('create → send → public view → open → accept', async () => {
    const clientRes = await api
      .post('/api/v1/clients')
      .set('Authorization', `Bearer ${token}`)
      .send({ company: 'Proposal Public Co' });
    const clientId = clientRes.body.id;

    const propRes = await api
      .post('/api/v1/proposals')
      .set('Authorization', `Bearer ${token}`)
      .send({
        subject: 'Q1 Engagement',
        clientId,
        content: '<p>Hello</p>',
        totalValue: 1000,
        currency: 'USD',
      });
    expect([200, 201]).toContain(propRes.status);
    const proposalId = propRes.body.id;
    const hash = propRes.body.hash as string;
    expect(hash).toBeDefined();
    expect(propRes.body.status).toBe('draft');

    // Send
    const sendRes = await api
      .post(`/api/v1/proposals/${proposalId}/send`)
      .set('Authorization', `Bearer ${token}`);
    expect([200, 201]).toContain(sendRes.status);
    expect(sendRes.body.status).toBe('sent');

    // Public view (no auth)
    const viewRes = await api.get(`/api/v1/proposals/view/${hash}`);
    expect(viewRes.status).toBe(200);
    expect(viewRes.body.id).toBe(proposalId);
    expect(viewRes.body.hash).toBe(hash);

    // Public open
    const openRes = await api.post(`/api/v1/proposals/view/${hash}/open`);
    expect([200, 201]).toContain(openRes.status);
    expect(openRes.body.status).toBe('open');

    // Public accept
    const acceptRes = await api.post(`/api/v1/proposals/view/${hash}/accept`);
    expect([200, 201]).toContain(acceptRes.status);
    expect(acceptRes.body.status).toBe('accepted');
    expect(acceptRes.body.signedAt).toBeDefined();
  });
});
