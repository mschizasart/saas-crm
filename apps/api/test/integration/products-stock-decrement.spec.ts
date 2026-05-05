/**
 * Integration: invoice.sent → product stock auto-decrement (preferred FK path).
 *
 *   1. Create a product with stockQuantity=10, trackInventory=true.
 *   2. Create + send an invoice with a line item that has productId set.
 *   3. Wait for the @OnEvent('invoice.sent') listener to land.
 *   4. Assert: product.stockQuantity == 9, a StockMovement row exists with
 *      reason='invoice_sent', balanceAfter=9, change=-1.
 */
import * as supertest from 'supertest';
import { tryBootApp, shutdownApp } from './_helpers';
import { seedOrg, teardownOrg } from './setup';

describe('product stock auto-decrement on invoice.sent (FK path)', () => {
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

  itDb('FK-tagged invoice line decrements stock + writes a StockMovement', async () => {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { PrismaService } = require('../../src/database/prisma.service');
    const prisma = ctx.app!.get(PrismaService);

    const prodRes = await api
      .post('/api/v1/products')
      .set('Authorization', `Bearer ${token}`)
      .send({
        name: 'StockProd-FK',
        unitPrice: 25,
        stockQuantity: 10,
        trackInventory: true,
      });
    expect([200, 201]).toContain(prodRes.status);
    const productId = prodRes.body.id;

    const clientRes = await api
      .post('/api/v1/clients')
      .set('Authorization', `Bearer ${token}`)
      .send({ company: 'Stock Test Co' });
    const clientId = clientRes.body.id;

    const invRes = await api
      .post('/api/v1/invoices')
      .set('Authorization', `Bearer ${token}`)
      .send({
        clientId,
        date: new Date().toISOString(),
        items: [
          { description: 'StockProd-FK', quantity: 1, unitPrice: 25, taxRate: 0, productId },
        ],
      });
    expect([200, 201]).toContain(invRes.status);
    const invoiceId = invRes.body.id;

    await api
      .post(`/api/v1/invoices/${invoiceId}/send`)
      .set('Authorization', `Bearer ${token}`);

    // Listener is fire-and-forget; give it a brief window.
    await new Promise((r) => setTimeout(r, 500));

    const product = await prisma.product.findUnique({ where: { id: productId } });
    expect(product.stockQuantity).toBe(9);

    const movements = await prisma.stockMovement.findMany({
      where: { productId },
      orderBy: { createdAt: 'desc' },
    });
    expect(movements.length).toBeGreaterThanOrEqual(1);
    expect(movements[0].reason).toBe('invoice_sent');
    expect(Number(movements[0].balanceAfter)).toBe(9);
    // Schema field is `delta` (signed); the products service writes -qty.
    expect(Number(movements[0].delta)).toBe(-1);
  });
});
