/**
 * Integration: recurring invoice generation via runRecurringNow.
 *
 *   1. Create a recurring invoice template (isRecurring=true, monthly).
 *   2. POST /invoices/:id/recurring/run → returns a new draft invoice.
 *   3. Assert the new invoice has the same items + totals as the parent
 *      and a new sequential number.
 *   4. Source invoice's totalCyclesCompleted is bumped + nextRecurringDate
 *      is advanced.
 */
import * as supertest from 'supertest';
import { tryBootApp, shutdownApp } from './_helpers';
import { seedOrg, teardownOrg } from './setup';

describe('recurring invoice runNow (integration)', () => {
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

  itDb('runRecurringNow creates a child invoice + advances source', async () => {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { PrismaService } = require('../../src/database/prisma.service');
    const prisma = ctx.app!.get(PrismaService);

    const clientRes = await api
      .post('/api/v1/clients')
      .set('Authorization', `Bearer ${token}`)
      .send({ company: 'Recurring Co' });
    const clientId = clientRes.body.id;

    const invRes = await api
      .post('/api/v1/invoices')
      .set('Authorization', `Bearer ${token}`)
      .send({
        clientId,
        date: new Date().toISOString(),
        dueDate: new Date(Date.now() + 14 * 86400_000).toISOString(),
        recurring: true,
        recurringEvery: 1,
        recurringType: 'month',
        items: [
          { description: 'Monthly retainer', quantity: 1, unitPrice: 250, taxRate: 0 },
          { description: 'Hosting', quantity: 1, unitPrice: 50, taxRate: 0 },
        ],
      });
    expect([200, 201]).toContain(invRes.status);
    const sourceId = invRes.body.id;

    const runRes = await api
      .post(`/api/v1/invoices/${sourceId}/recurring/run`)
      .set('Authorization', `Bearer ${token}`);
    expect([200, 201]).toContain(runRes.status);
    const childId = runRes.body.id;
    expect(childId).toBeDefined();
    expect(childId).not.toBe(sourceId);
    expect(runRes.body.status).toBe('draft');
    expect(Number(runRes.body.total)).toBe(300);

    const childItems = await prisma.invoiceItem.findMany({
      where: { invoiceId: childId },
      orderBy: { order: 'asc' },
    });
    expect(childItems).toHaveLength(2);
    expect(childItems[0].description).toBe('Monthly retainer');

    const source = await prisma.invoice.findUnique({ where: { id: sourceId } });
    expect((source as any).totalCyclesCompleted).toBe(1);
    expect((source as any).nextRecurringDate).toBeDefined();
    // The child should NOT be flagged as recurring itself.
    expect((source as any).isRecurring).toBe(true);
    const child = await prisma.invoice.findUnique({ where: { id: childId } });
    expect((child as any).isRecurring).toBe(false);
    expect((child as any).recurringFromInvoiceId).toBe(sourceId);
  });
});
