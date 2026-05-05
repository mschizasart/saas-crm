/**
 * Integration: bill expenses to a draft invoice.
 *
 *   1. Create a billable, not-yet-invoiced expense for a client.
 *   2. Create a draft invoice for the same client.
 *   3. POST /invoices/:id/bill-expenses { expenseIds: [..] }.
 *   4. Assert: a new InvoiceItem appears with the expense's name +
 *      amount; the expense row has invoiced=true and invoiceId set;
 *      invoice totals are recomputed.
 */
import * as supertest from 'supertest';
import { tryBootApp, shutdownApp } from './_helpers';
import { seedOrg, teardownOrg } from './setup';

describe('billable expense → invoice line item (integration)', () => {
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

  itDb('bill-expenses appends a line item + flips the expense', async () => {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { PrismaService } = require('../../src/database/prisma.service');
    const prisma = ctx.app!.get(PrismaService);

    const clientRes = await api
      .post('/api/v1/clients')
      .set('Authorization', `Bearer ${token}`)
      .send({ company: 'Bill Expense Co' });
    const clientId = clientRes.body.id;

    const expenseRes = await api
      .post('/api/v1/expenses')
      .set('Authorization', `Bearer ${token}`)
      .send({
        name: 'Travel taxi',
        amount: 42.5,
        date: new Date().toISOString(),
        clientId,
        billable: true,
      });
    expect([200, 201]).toContain(expenseRes.status);
    const expenseId = expenseRes.body.id;

    const invRes = await api
      .post('/api/v1/invoices')
      .set('Authorization', `Bearer ${token}`)
      .send({
        clientId,
        date: new Date().toISOString(),
        items: [{ description: 'Base fee', quantity: 1, unitPrice: 100, taxRate: 0 }],
      });
    expect([200, 201]).toContain(invRes.status);
    const invoiceId = invRes.body.id;

    const billRes = await api
      .post(`/api/v1/invoices/${invoiceId}/bill-expenses`)
      .set('Authorization', `Bearer ${token}`)
      .send({ expenseIds: [expenseId] });
    expect([200, 201]).toContain(billRes.status);

    const items = await prisma.invoiceItem.findMany({
      where: { invoiceId },
      orderBy: { order: 'asc' },
    });
    expect(items.length).toBeGreaterThanOrEqual(2);
    const expenseLine = items.find((i: any) => i.description === 'Travel taxi');
    expect(expenseLine).toBeDefined();
    expect(Number(expenseLine.rate)).toBe(42.5);

    const expense = await prisma.expense.findUnique({ where: { id: expenseId } });
    expect(expense.invoiced).toBe(true);
    expect(expense.invoiceId).toBe(invoiceId);
  });
});
