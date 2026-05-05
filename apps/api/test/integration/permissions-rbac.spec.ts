/**
 * Integration: per-route permissions are enforced.
 *
 *  - Seed two staff users in the same org:
 *      A) given a Role whose permissions JSON does NOT include
 *         `invoices.delete` (just `invoices.view`).
 *      B) given isAdmin=true (super-admin bypass in RbacGuard).
 *  - User A's DELETE /invoices/:id → 403 with "Insufficient permissions".
 *  - User B's DELETE /invoices/:id → 204.
 */
import * as supertest from 'supertest';
import { tryBootApp, shutdownApp } from './_helpers';
import { seedOrg, teardownOrg } from './setup';

describe('RBAC route enforcement (integration)', () => {
  let ctx: Awaited<ReturnType<typeof tryBootApp>>;
  let api: supertest.SuperTest<supertest.Test>;
  let orgId: string;
  let viewerToken: string;
  let adminToken: string;

  beforeAll(async () => {
    ctx = await tryBootApp();
    if (!ctx.available || !ctx.app) return;
    api = supertest(ctx.app.getHttpServer());

    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { PrismaService } = require('../../src/database/prisma.service');
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { JwtService } = require('@nestjs/jwt');
    const prisma = ctx.app!.get(PrismaService);
    const jwt = ctx.app!.get(JwtService);

    // Org + admin
    const seeded = await seedOrg(ctx.app);
    orgId = seeded.org.id;
    await prisma.user.update({
      where: { id: seeded.user.id },
      data: { isAdmin: true },
    });
    adminToken = jwt.sign(
      { sub: seeded.user.id, email: seeded.user.email, orgId, type: 'staff', isAdmin: true },
      { expiresIn: '1h' },
    );

    // View-only role (no `invoices.delete`)
    const viewRole = await prisma.role.create({
      data: {
        organizationId: orgId,
        name: 'Viewer Only',
        permissions: { invoices: { view: true, create: true, send: true, edit: true } },
      },
    });

    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const bcrypt = require('bcryptjs');
    const password = await bcrypt.hash('test-password', 10);
    const viewer = await prisma.user.create({
      data: {
        organizationId: orgId,
        email: `viewer+${Date.now()}@jest.local`,
        password,
        passwordFormat: 'bcrypt',
        firstName: 'View',
        lastName: 'Er',
        type: 'staff',
        active: true,
        isAdmin: false,
        roleId: viewRole.id,
      },
    });
    viewerToken = jwt.sign(
      { sub: viewer.id, email: viewer.email, orgId, type: 'staff', roleId: viewRole.id },
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

  itDb('viewer cannot DELETE an invoice → 403; admin can → 204', async () => {
    // Admin creates a client + invoice.
    const clientRes = await api
      .post('/api/v1/clients')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ company: 'Rbac Co' });
    const clientId = clientRes.body.id;

    const invRes = await api
      .post('/api/v1/invoices')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        clientId,
        date: new Date().toISOString(),
        items: [{ description: 'A', quantity: 1, unitPrice: 10, taxRate: 0 }],
      });
    const invoiceId = invRes.body.id;
    expect(invoiceId).toBeDefined();

    // Viewer tries — must be 403, with Nest's ForbiddenException shape.
    const denied = await api
      .delete(`/api/v1/invoices/${invoiceId}`)
      .set('Authorization', `Bearer ${viewerToken}`);
    expect(denied.status).toBe(403);
    expect(denied.body.message).toMatch(/insufficient permissions/i);

    // Admin succeeds.
    const ok = await api
      .delete(`/api/v1/invoices/${invoiceId}`)
      .set('Authorization', `Bearer ${adminToken}`);
    expect([200, 204]).toContain(ok.status);
  });
});
