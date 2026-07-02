/**
 * Integration: Outlook add-in backend (/addin/*).
 *
 * Resolve CRM context by sender email, log an email to the timeline, and create
 * a lead — plus the in-org validation guard that rejects a log pinned to a
 * bogus relatedToId (404). The controller uses JwtAuthGuard only (no RBAC), so
 * the seeded staff token suffices; we promote to admin for consistency.
 *
 * Skips automatically when the test DB is unavailable (see _helpers).
 */
import * as supertest from 'supertest';
import { tryBootApp, shutdownApp } from './_helpers';
import { seedOrg, teardownOrg } from './setup';

describe('addin (integration)', () => {
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

  const prospectEmail = `addintest+${Date.now()}@example.com`;
  let leadId: string;

  itDb('seed a lead with a known email', async () => {
    const res = await api
      .post('/api/v1/leads')
      .set('Authorization', `Bearer ${token}`)
      .send({ name: 'Addin Prospect', email: prospectEmail });
    expect([200, 201]).toContain(res.status);
    leadId = res.body.id;
    expect(leadId).toBeDefined();
  });

  itDb('POST /addin/context (known sender) → {found:true, type:"lead", record}', async () => {
    if (!leadId) return;
    const res = await api
      .post('/api/v1/addin/context')
      .set('Authorization', `Bearer ${token}`)
      .send({ senderEmail: prospectEmail });
    expect([200, 201]).toContain(res.status);
    expect(res.body.found).toBe(true);
    expect(res.body.type).toBe('lead');
    expect(res.body.record).toMatchObject({ id: leadId });
    expect(Array.isArray(res.body.recentActivity)).toBe(true);
  });

  itDb('POST /addin/context (unknown sender) → {found:false, canCreateLead:true}', async () => {
    const res = await api
      .post('/api/v1/addin/context')
      .set('Authorization', `Bearer ${token}`)
      .send({ senderEmail: 'nobody@nowhere.test' });
    expect([200, 201]).toContain(res.status);
    expect(res.body.found).toBe(false);
    expect(res.body.canCreateLead).toBe(true);
  });

  itDb('POST /addin/log-email (resolve by sender) → creates an email Activity', async () => {
    if (!leadId) return;
    const res = await api
      .post('/api/v1/addin/log-email')
      .set('Authorization', `Bearer ${token}`)
      .send({ senderEmail: prospectEmail, subject: 'Hi', direction: 'inbound' });
    expect([200, 201]).toContain(res.status);
    expect(res.body.id).toBeDefined();
    expect(res.body.type).toBe('email');
    expect(res.body.direction).toBe('inbound');
    expect(res.body.relatedToType).toBe('lead');
    expect(res.body.relatedToId).toBe(leadId);
  });

  itDb('POST /addin/log-email with a bogus relatedToId → 404 (in-org guard)', async () => {
    const res = await api
      .post('/api/v1/addin/log-email')
      .set('Authorization', `Bearer ${token}`)
      .send({
        relatedToType: 'lead',
        relatedToId: '00000000-0000-0000-0000-000000000000',
        subject: 'x',
      });
    expect(res.status).toBe(404);
  });

  itDb('POST /addin/create-lead → 201 creates a lead', async () => {
    const res = await api
      .post('/api/v1/addin/create-lead')
      .set('Authorization', `Bearer ${token}`)
      .send({ name: 'From Addin', email: `fromaddin+${Date.now()}@example.com` });
    expect([200, 201]).toContain(res.status);
    expect(res.body.id).toBeDefined();
    expect(res.body.name).toBe('From Addin');
  });
});
