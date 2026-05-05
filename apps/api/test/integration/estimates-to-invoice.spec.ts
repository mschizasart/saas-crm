/**
 * Integration: estimate → accept → convert-to-invoice.
 *
 * Verifies that:
 *   1. An estimate with a productId-bearing line item can be created.
 *   2. The estimate can be accepted via POST /accept (status='accepted').
 *   3. POST /convert-to-invoice creates a new draft invoice with a
 *      matching number, the same totals, and ALL line items copied —
 *      including the productId FK (the regression that motivated
 *      manual-migration 004).
 *   4. The original estimate is left in `accepted` status with
 *      `convertedToInvoiceId` pointing at the new invoice.
 */
import * as supertest from 'supertest';
import { tryBootApp, shutdownApp } from './_helpers';
import { seedOrg, teardownOrg } from './setup';

describe('estimate → invoice conversion (integration)', () => {
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
    // The seeded user has no role attached, so per-route RBAC would 403
    // every permission-gated endpoint. Promote to super-admin so the
    // RbacGuard's `if (user?.isAdmin) return true` short-circuits.
    // The JwtStrategy re-fetches the user on each request so the JWT
    // payload doesn't need to be re-signed.
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

  itDb('creates → accepts → converts estimate; items + productId FK preserved', async () => {
    // Client
    const clientRes = await api
      .post('/api/v1/clients')
      .set('Authorization', `Bearer ${token}`)
      .send({ company: 'Estimate Convert Co' });
    expect([200, 201]).toContain(clientRes.status);
    const clientId = clientRes.body.id;

    // Product (so the estimate line can reference a productId)
    const prodRes = await api
      .post('/api/v1/products')
      .set('Authorization', `Bearer ${token}`)
      .send({
        name: 'Convertible Widget',
        unitPrice: 75,
        stockQuantity: 50,
        trackInventory: false,
      });
    expect([200, 201]).toContain(prodRes.status);
    const productId = prodRes.body.id;

    // Estimate with two line items, one with productId, one without.
    const estRes = await api
      .post('/api/v1/estimates')
      .set('Authorization', `Bearer ${token}`)
      .send({
        clientId,
        date: new Date().toISOString(),
        items: [
          {
            description: 'Convertible Widget',
            quantity: 4,
            unitPrice: 75,
            taxRate: 0,
            productId,
          },
          {
            description: 'Consulting hours',
            quantity: 1,
            unitPrice: 200,
            taxRate: 10,
          },
        ],
      });
    expect([200, 201]).toContain(estRes.status);
    const estimateId = estRes.body.id;
    expect(Number(estRes.body.subTotal)).toBe(500);

    // Accept the estimate.
    const accRes = await api
      .post(`/api/v1/estimates/${estimateId}/accept`)
      .set('Authorization', `Bearer ${token}`);
    expect([200, 201]).toContain(accRes.status);
    expect(accRes.body.status).toBe('accepted');

    // Convert.
    const convRes = await api
      .post(`/api/v1/estimates/${estimateId}/convert-to-invoice`)
      .set('Authorization', `Bearer ${token}`);
    expect([200, 201]).toContain(convRes.status);
    const invoiceId = convRes.body.id;
    expect(invoiceId).toBeDefined();
    expect(convRes.body.status).toBe('draft');
    expect(convRes.body.number).toMatch(/^INV-/);
    expect(Number(convRes.body.subTotal)).toBe(500);

    // Verify items were copied with productId FK preserved.
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { PrismaService } = require('../../src/database/prisma.service');
    const prisma = ctx.app!.get(PrismaService);
    const items = await prisma.invoiceItem.findMany({
      where: { invoiceId },
      orderBy: { order: 'asc' },
    });
    expect(items).toHaveLength(2);
    const productItem = items.find((i: any) => i.productId === productId);
    expect(productItem).toBeDefined();
    expect(productItem.description).toBe('Convertible Widget');
    expect(Number(productItem.qty)).toBe(4);
    expect(Number(productItem.rate)).toBe(75);

    // Estimate should now point at the new invoice.
    const estimateRow = await prisma.estimate.findUnique({
      where: { id: estimateId },
    });
    expect(estimateRow.status).toBe('accepted');
    expect(estimateRow.convertedToInvoiceId).toBe(invoiceId);
  });
});
