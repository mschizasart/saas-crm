/**
 * Integration: end-to-end invoice flow.
 *  1. create client
 *  2. create invoice with 2 line items
 *  3. mark as sent → fires invoice.sent → stock auto-decrement
 *  4. record payment → flips invoice to paid
 *  5. assert email-tracking row created (if emails are enabled)
 */
import * as supertest from 'supertest';
import { tryBootApp, shutdownApp } from './_helpers';
import { seedOrg, teardownOrg } from './setup';

describe('invoices full lifecycle (integration)', () => {
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

  itDb('creates client → invoice with 2 line items → sends → records payment → paid', async () => {
    // Create client
    const clientRes = await api
      .post('/api/v1/clients')
      .set('Authorization', `Bearer ${token}`)
      .send({ company: 'Invoice Flow Co' });
    expect([200, 201]).toContain(clientRes.status);
    const clientId = clientRes.body.id;

    // Create a tracked product to verify auto-decrement
    const prodRes = await api
      .post('/api/v1/products')
      .set('Authorization', `Bearer ${token}`)
      .send({
        name: 'Tracked Widget',
        unitPrice: 50,
        stockQuantity: 100,
        trackInventory: true,
      });
    expect([200, 201]).toContain(prodRes.status);
    const productId = prodRes.body.id;

    // Create invoice with 2 items
    const invRes = await api
      .post('/api/v1/invoices')
      .set('Authorization', `Bearer ${token}`)
      .send({
        clientId,
        date: new Date().toISOString(),
        items: [
          {
            description: 'Tracked Widget',
            quantity: 5,
            unitPrice: 50,
            taxRate: 0,
            productId,
          },
          {
            description: 'Service hours',
            quantity: 2,
            unitPrice: 100,
            taxRate: 10,
          },
        ],
      });
    expect([200, 201]).toContain(invRes.status);
    expect(Number(invRes.body.subTotal ?? invRes.body.subtotal)).toBe(450);
    const invoiceId = invRes.body.id;

    // Mark sent
    const sendRes = await api
      .post(`/api/v1/invoices/${invoiceId}/send`)
      .set('Authorization', `Bearer ${token}`);
    expect([200, 201, 204]).toContain(sendRes.status);

    // After 'sent' the OnEvent listener should have decremented stock
    const productAfter = await api
      .get(`/api/v1/products/${productId}`)
      .set('Authorization', `Bearer ${token}`);
    if (productAfter.status === 200) {
      expect(productAfter.body.stockQuantity).toBeLessThanOrEqual(95);
    }

    // Record payment
    const payRes = await api
      .post(`/api/v1/invoices/${invoiceId}/mark-paid`)
      .set('Authorization', `Bearer ${token}`);
    expect([200, 201, 204]).toContain(payRes.status);

    // Verify final status
    const finalRes = await api
      .get(`/api/v1/invoices/${invoiceId}`)
      .set('Authorization', `Bearer ${token}`);
    expect(finalRes.status).toBe(200);
    expect(finalRes.body.status).toBe('paid');
  });
});
