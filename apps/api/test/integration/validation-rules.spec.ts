/**
 * Integration: Salesforce-style Validation Rules — migration 046.
 *
 * Create a rule that blocks leads named 'BLOCKME', then prove the save-time hook
 * fires on POST /leads (400 with body.errors) while a non-matching lead saves
 * fine. Also proves a non-matching operator/value does NOT block.
 *
 * Uses the seeded admin token (isAdmin bypasses RbacGuard's `settings.edit`
 * and `leads.create` perms). Skips when the test DB is unavailable.
 */
import * as supertest from 'supertest';
import { tryBootApp, shutdownApp } from './_helpers';
import { seedOrg, teardownOrg } from './setup';

describe('validation-rules (integration)', () => {
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

  let ruleId: string;

  itDb('POST /validation-rules → 201 creates a blocking rule for leads', async () => {
    const res = await api
      .post('/api/v1/validation-rules')
      .set('Authorization', `Bearer ${token}`)
      .send({
        fieldTo: 'lead',
        name: 'Block BLOCKME leads',
        conditionLogic: 'AND',
        conditions: [{ field: 'name', operator: 'equals', value: 'BLOCKME' }],
        errorMessage: 'blocked',
      });
    expect([200, 201]).toContain(res.status);
    expect(res.body.id).toBeDefined();
    expect(res.body.fieldTo).toBe('lead');
    expect(res.body.errorMessage).toBe('blocked');
    expect(res.body.active).toBe(true);
    ruleId = res.body.id;
  });

  itDb('POST /leads {name:"BLOCKME"} → 400, the hook blocks with errors[]', async () => {
    if (!ruleId) return;
    const res = await api
      .post('/api/v1/leads')
      .set('Authorization', `Bearer ${token}`)
      .send({ name: 'BLOCKME' });
    expect(res.status).toBe(400);
    // Service throws BadRequestException({ message:'Validation failed', errors })
    expect(Array.isArray(res.body.errors)).toBe(true);
    expect(res.body.errors).toContain('blocked');
  });

  itDb('POST /leads {name:"Fine"} → 201, a non-matching lead is NOT blocked', async () => {
    if (!ruleId) return;
    const res = await api
      .post('/api/v1/leads')
      .set('Authorization', `Bearer ${token}`)
      .send({ name: 'Fine' });
    expect([200, 201]).toContain(res.status);
    expect(res.body.id).toBeDefined();
    expect(res.body.name).toBe('Fine');
  });

  itDb('a non-matching value on the same operator does NOT block', async () => {
    if (!ruleId) return;
    // 'equals BLOCKME' should not fire for a different name.
    const res = await api
      .post('/api/v1/leads')
      .set('Authorization', `Bearer ${token}`)
      .send({ name: 'Totally Allowed' });
    expect([200, 201]).toContain(res.status);
    expect(res.body.id).toBeDefined();
  });

  itDb('DELETE /validation-rules/:id → 204, and leads save freely afterwards', async () => {
    if (!ruleId) return;
    const del = await api
      .delete(`/api/v1/validation-rules/${ruleId}`)
      .set('Authorization', `Bearer ${token}`);
    expect([200, 204]).toContain(del.status);

    // With the rule gone, even a 'BLOCKME' lead now saves.
    const res = await api
      .post('/api/v1/leads')
      .set('Authorization', `Bearer ${token}`)
      .send({ name: 'BLOCKME' });
    expect([200, 201]).toContain(res.status);
    expect(res.body.id).toBeDefined();
  });
});
