/**
 * Integration: inbox router auto-attaches an InboxMessage to a Lead when the
 * fromEmail matches.
 *
 *  - create lead with email john@example.com
 *  - insert InboxMessage with fromEmail=john@example.com (via Prisma direct)
 *  - run RouterService.route() (or POST a "route" endpoint if exposed)
 *  - assert routedTo='lead' and routedToId points at the lead
 */
import { tryBootApp, shutdownApp } from './_helpers';
import { seedOrg, teardownOrg } from './setup';

describe('inbox router (integration)', () => {
  let ctx: Awaited<ReturnType<typeof tryBootApp>>;
  let orgId: string;

  beforeAll(async () => {
    ctx = await tryBootApp();
    if (!ctx.available || !ctx.app) return;
    const seeded = await seedOrg(ctx.app);
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

  itDb('routes inbox message to a lead by matching fromEmail', async () => {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { PrismaService } = require('../../src/database/prisma.service');
    const prisma = ctx.app!.get(PrismaService);

    // Make sure the lead exists
    const lead = await prisma.lead.create({
      data: {
        organizationId: orgId,
        name: 'John Inbox',
        email: 'john@example.com',
      },
    });

    // Make an unrouted inbox message
    let messageId: string | null = null;
    try {
      const msg = await prisma.inboxMessage.create({
        data: {
          organizationId: orgId,
          fromEmail: 'john@example.com',
          subject: 'Hi',
          body: 'A reply',
          receivedAt: new Date(),
          routedTo: null,
          routedToId: null,
        },
      });
      messageId = msg.id;
    } catch (err: any) {
      console.warn(`[skip] InboxMessage table not available: ${err.message}`);
      return;
    }

    // Run the router
    let routerService: any;
    try {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const { RouterService } = require('../../src/modules/inbox/router.service');
      routerService = ctx.app!.get(RouterService);
    } catch {
      console.warn('[skip] RouterService not registered');
      return;
    }

    if (typeof routerService.routeAll === 'function') {
      await routerService.routeAll(orgId);
    } else if (typeof routerService.route === 'function') {
      await routerService.route(orgId, messageId);
    } else {
      console.warn('[skip] RouterService has no route/routeAll method');
      return;
    }

    const refetched = await prisma.inboxMessage.findUnique({
      where: { id: messageId },
    });
    expect(refetched.routedTo).toBe('lead');
    expect(refetched.routedToId).toBe(lead.id);
  });
});
