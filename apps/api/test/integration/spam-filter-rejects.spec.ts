/**
 * Integration: ticket spam-filter actions (mark_spam / auto_close / reject).
 *
 * The integration boundary here is `TicketSpamFiltersService.evaluate()`
 * — same call the IMAP processor makes. We don't actually run the IMAP
 * processor (that needs a real IMAP server); we drive the service
 * directly so the rule storage + match engine are exercised end-to-end
 * against the real DB.
 */
import { tryBootApp, shutdownApp } from './_helpers';
import { seedOrg, teardownOrg } from './setup';

describe('ticket spam filters (integration)', () => {
  let ctx: Awaited<ReturnType<typeof tryBootApp>>;
  let orgId: string;
  let token: string;

  beforeAll(async () => {
    ctx = await tryBootApp();
    if (!ctx.available || !ctx.app) return;
    const seeded = await seedOrg(ctx.app);
    orgId = seeded.org.id;
    token = seeded.token;
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

  // Helper: create a rule via the controller so the full validation +
  // storage path is exercised.
  async function createRule(action: string, pattern: string) {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const supertest = require('supertest');
    const api = supertest(ctx.app!.getHttpServer());
    const res = await api
      .post('/api/v1/ticket-spam-filters')
      .set('Authorization', `Bearer ${token}`)
      .send({
        name: `Rule ${action} ${Date.now()}`,
        field: 'subject',
        operator: 'contains',
        pattern,
        action,
        isActive: true,
        priority: 1,
      });
    expect([200, 201]).toContain(res.status);
    return res.body.id as string;
  }

  itDb('reject action: evaluator returns matched + reject', async () => {
    await createRule('reject', 'cheap watches');

    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { TicketSpamFiltersService } = require('../../src/modules/ticket-spam-filters/ticket-spam-filters.service');
    const svc = ctx.app!.get(TicketSpamFiltersService);
    const result = await svc.evaluate(orgId, {
      subject: 'Buy CHEAP WATCHES now',
      fromEmail: 'spammer@example.com',
      body: '...',
    });
    expect(result.matched).toBe(true);
    expect(result.action).toBe('reject');
  });

  itDb('mark_spam action: evaluator returns matched + mark_spam', async () => {
    await createRule('mark_spam', 'limited time offer');

    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { TicketSpamFiltersService } = require('../../src/modules/ticket-spam-filters/ticket-spam-filters.service');
    const svc = ctx.app!.get(TicketSpamFiltersService);
    const result = await svc.evaluate(orgId, {
      subject: 'LIMITED TIME OFFER on hosting',
      fromEmail: 'm@example.com',
      body: '...',
    });
    expect(result.matched).toBe(true);
    expect(result.action).toBe('mark_spam');
  });

  itDb('no rule matches → matched=false', async () => {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { TicketSpamFiltersService } = require('../../src/modules/ticket-spam-filters/ticket-spam-filters.service');
    const svc = ctx.app!.get(TicketSpamFiltersService);
    const result = await svc.evaluate(orgId, {
      subject: 'Hi, how is your day?',
      fromEmail: 'friend@example.com',
      body: 'just checking in',
    });
    expect(result.matched).toBe(false);
  });

  itDb('matchCount telemetry bumps after a match', async () => {
    const id = await createRule('mark_spam', 'foobar-unique-stamp');

    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { TicketSpamFiltersService } = require('../../src/modules/ticket-spam-filters/ticket-spam-filters.service');
    const svc = ctx.app!.get(TicketSpamFiltersService);
    await svc.evaluate(orgId, { subject: 'foobar-unique-stamp', fromEmail: 'a@b.c', body: '' });

    // Update is fire-and-forget; let it land.
    await new Promise((r) => setTimeout(r, 300));

    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { PrismaService } = require('../../src/database/prisma.service');
    const prisma = ctx.app!.get(PrismaService);
    const row = await prisma.ticketSpamFilter.findUnique({ where: { id } });
    expect(row).not.toBeNull();
    expect(row.matchCount).toBeGreaterThanOrEqual(1);
    expect(row.lastMatchedAt).not.toBeNull();
  });
});
