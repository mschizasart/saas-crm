/**
 * Integration: automation rule fires from a domain event.
 *
 *   1. Create an automation rule with trigger='invoice.sent' and a
 *      single create_task action.
 *   2. Emit invoice.sent via EventEmitter2.
 *   3. Assert a Task row exists for this org with the configured name.
 */
import * as supertest from 'supertest';
import { tryBootApp, shutdownApp } from './_helpers';
import { seedOrg, teardownOrg } from './setup';

describe('automations event → action (integration)', () => {
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

  itDb('rule(trigger=invoice.sent, action=create_task) creates a task on emit', async () => {
    const taskName = `Auto follow-up ${Date.now()}`;

    // Create the rule via the controller.
    const ruleRes = await api
      .post('/api/v1/automations')
      .set('Authorization', `Bearer ${token}`)
      .send({
        name: 'Follow up after invoice sent',
        trigger: 'invoice.sent',
        actions: [
          {
            type: 'create_task',
            config: { name: taskName },
          },
        ],
        active: true,
      });
    expect([200, 201]).toContain(ruleRes.status);

    // Emit the domain event directly via EventEmitter2 (no need to actually
    // send an invoice — automations are pure event consumers).
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { EventEmitter2 } = require('@nestjs/event-emitter');
    const emitter: any = ctx.app!.get(EventEmitter2);
    await emitter.emitAsync('invoice.sent', {
      orgId,
      invoice: { id: 'fake-invoice-id', organizationId: orgId },
    });

    // Give the async listener a beat to land its DB write.
    await new Promise((r) => setTimeout(r, 250));

    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { PrismaService } = require('../../src/database/prisma.service');
    const prisma = ctx.app!.get(PrismaService);
    const tasks = await prisma.task.findMany({
      where: { organizationId: orgId, name: taskName },
    });
    expect(tasks.length).toBeGreaterThanOrEqual(1);
    expect(tasks[0].status).toBe('not_started');
    expect(tasks[0].priority).toBe('medium');
  });
});
