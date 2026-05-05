/**
 * Integration: inbound IMAP message tagged with [#<ticketId>] becomes a
 * TicketReply on the existing ticket (and bumps lastReplyAt).
 *
 * We can't easily stand up an IMAP server in CI, so we exercise the
 * relevant private path on `ImapPollProcessor` by re-implementing the
 * tag-detection branch through the public API surface — namely we
 *
 *   - Create a ticket via the API (open).
 *   - POST /tickets/:id/replies with isStaff=false → simulates the
 *     end result of an inbound email reply path (the IMAP processor
 *     calls `ticketReply.create` with isStaff:false).
 *   - Assert: the reply row exists, ticket.status='open', and
 *     ticket.lastReplyAt got bumped.
 *   - Verify the public ticket reply API does NOT close the ticket
 *     when `isStaff=false` — the regression we care about is that
 *     "answered" must not be applied to a customer reply (otherwise
 *     SLA timers stop). We separately test that a staff reply DOES
 *     flip status to 'answered'.
 */
import * as supertest from 'supertest';
import { tryBootApp, shutdownApp } from './_helpers';
import { seedOrg, teardownOrg } from './setup';

describe('ticket reply (IMAP-equivalent) flow (integration)', () => {
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

  itDb('staff reply flips ticket → answered; customer reply keeps status=open', async () => {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { PrismaService } = require('../../src/database/prisma.service');
    const prisma = ctx.app!.get(PrismaService);

    const ticketRes = await api
      .post('/api/v1/tickets')
      .set('Authorization', `Bearer ${token}`)
      .send({
        subject: 'Inbound issue',
        message: 'Initial complaint',
        priority: 'high',
        source: 'email',
      });
    expect([200, 201]).toContain(ticketRes.status);
    const ticketId = ticketRes.body.id;

    // Customer reply (simulates the IMAP path's behaviour).
    const custReply = await api
      .post(`/api/v1/tickets/${ticketId}/replies`)
      .set('Authorization', `Bearer ${token}`)
      .send({ message: 'Still broken!', isStaff: false });
    expect([200, 201]).toContain(custReply.status);

    let ticket = await prisma.ticket.findUnique({ where: { id: ticketId } });
    expect(ticket.status).toBe('open');
    expect(ticket.lastReplyAt).not.toBeNull();

    // Staff reply.
    const staffReply = await api
      .post(`/api/v1/tickets/${ticketId}/replies`)
      .set('Authorization', `Bearer ${token}`)
      .send({ message: 'Looking into it', isStaff: true });
    expect([200, 201]).toContain(staffReply.status);

    ticket = await prisma.ticket.findUnique({ where: { id: ticketId } });
    expect(ticket.status).toBe('answered');

    // Internal note must NOT change status.
    const internal = await api
      .post(`/api/v1/tickets/${ticketId}/replies`)
      .set('Authorization', `Bearer ${token}`)
      .send({ message: 'private', isInternal: true });
    expect([200, 201]).toContain(internal.status);

    ticket = await prisma.ticket.findUnique({ where: { id: ticketId } });
    expect(ticket.status).toBe('answered');

    // 3 reply rows total.
    const replies = await prisma.ticketReply.findMany({ where: { ticketId } });
    expect(replies.length).toBe(3);
  });
});
