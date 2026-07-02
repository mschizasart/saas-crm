/**
 * Integration: Sequences (cadences) — migration 043.
 *
 * Covers the create → add-step → activate → enroll → stats → delete lifecycle
 * against the real /sequences endpoints. Uses the seeded admin token (isAdmin
 * bypasses RbacGuard, so the granular `sequences.*` perms don't need a role).
 *
 * Skips automatically when the test DB is not available (see _helpers).
 */
import * as supertest from 'supertest';
import { tryBootApp, shutdownApp } from './_helpers';
import { seedOrg, teardownOrg } from './setup';

describe('sequences (integration)', () => {
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
    // Promote to admin so isAdmin bypasses RbacGuard (canonical pattern —
    // see permissions-rbac.spec.ts).
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

  let sequenceId: string;
  let leadId: string;

  itDb('POST /sequences → 201 draft', async () => {
    const res = await api
      .post('/api/v1/sequences')
      .set('Authorization', `Bearer ${token}`)
      .send({ name: 'Onboarding cadence' });
    expect([200, 201]).toContain(res.status);
    expect(res.body.id).toBeDefined();
    expect(res.body.name).toBe('Onboarding cadence');
    expect(res.body.status).toBe('draft');
    sequenceId = res.body.id;
  });

  itDb('GET /sequences/:id → 200 with steps array', async () => {
    if (!sequenceId) return;
    const res = await api
      .get(`/api/v1/sequences/${sequenceId}`)
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.id).toBe(sequenceId);
    expect(Array.isArray(res.body.steps)).toBe(true);
  });

  itDb('POST /sequences/:id/steps → adds an email step at position 0', async () => {
    if (!sequenceId) return;
    const res = await api
      .post(`/api/v1/sequences/${sequenceId}/steps`)
      .set('Authorization', `Bearer ${token}`)
      .send({
        type: 'email',
        delayMinutes: 0,
        emailSubject: 'Welcome',
        emailBody: '<p>Hello there</p>',
      });
    expect([200, 201]).toContain(res.status);
    expect(res.body.id).toBeDefined();
    expect(res.body.type).toBe('email');
    expect(res.body.position).toBe(0);
  });

  itDb('POST /sequences/:id/activate → 200 (a complete email step validates)', async () => {
    if (!sequenceId) return;
    const res = await api
      .post(`/api/v1/sequences/${sequenceId}/activate`)
      .set('Authorization', `Bearer ${token}`);
    // The step above has both subject + body, so activation succeeds. If the
    // content were missing the service would 400 — we assert the real success.
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('active');
  });

  itDb('activation is validated — a stepless draft cannot activate → 400', async () => {
    const created = await api
      .post('/api/v1/sequences')
      .set('Authorization', `Bearer ${token}`)
      .send({ name: 'Empty cadence' });
    const emptyId = created.body.id;
    const res = await api
      .post(`/api/v1/sequences/${emptyId}/activate`)
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(400);
    // cleanup — it's still a draft so it can be deleted.
    await api
      .delete(`/api/v1/sequences/${emptyId}`)
      .set('Authorization', `Bearer ${token}`);
  });

  itDb('POST /sequences/:id/enroll → enrolled/skipped shape', async () => {
    if (!sequenceId) return;
    // Create a lead WITH an email so it can be enrolled (recipients without an
    // email are skipped with reason 'no_email').
    const leadRes = await api
      .post('/api/v1/leads')
      .set('Authorization', `Bearer ${token}`)
      .send({ name: 'Cadence Lead', email: `cadence+${Date.now()}@example.com` });
    expect([200, 201]).toContain(leadRes.status);
    leadId = leadRes.body.id;

    const res = await api
      .post(`/api/v1/sequences/${sequenceId}/enroll`)
      .set('Authorization', `Bearer ${token}`)
      .send({ recipients: [{ type: 'lead', id: leadId }] });
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('enrolled');
    expect(res.body).toHaveProperty('skipped');
    expect(Array.isArray(res.body.skippedReasons)).toBe(true);
    expect(res.body.enrolled).toBe(1);
  });

  itDb('GET /sequences/:id/enrollments → 200 array with the lead', async () => {
    if (!sequenceId) return;
    const res = await api
      .get(`/api/v1/sequences/${sequenceId}/enrollments`)
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    expect(res.body.length).toBeGreaterThanOrEqual(1);
    expect(res.body[0].recipientType).toBe('lead');
  });

  itDb('GET /sequences/:id/stats → aggregate counters', async () => {
    if (!sequenceId) return;
    const res = await api
      .get(`/api/v1/sequences/${sequenceId}/stats`)
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      totalEnrolled: expect.any(Number),
      active: expect.any(Number),
      completed: expect.any(Number),
      emailsSent: expect.any(Number),
    });
    expect(res.body.totalEnrolled).toBeGreaterThanOrEqual(1);
  });

  itDb('DELETE /sequences/:id → only a DRAFT can be deleted (409 for active)', async () => {
    if (!sequenceId) return;
    // The main sequence is ACTIVE — the service only allows deleting drafts.
    const active = await api
      .delete(`/api/v1/sequences/${sequenceId}`)
      .set('Authorization', `Bearer ${token}`);
    expect([409, 400]).toContain(active.status);

    // A fresh draft deletes cleanly (204).
    const draft = await api
      .post('/api/v1/sequences')
      .set('Authorization', `Bearer ${token}`)
      .send({ name: 'Disposable draft' });
    const del = await api
      .delete(`/api/v1/sequences/${draft.body.id}`)
      .set('Authorization', `Bearer ${token}`);
    expect([200, 204]).toContain(del.status);
  });
});
