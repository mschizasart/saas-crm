import { BadRequestException, NotFoundException } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { createMock, DeepMocked } from '@golevelup/ts-jest';
import { TicketsService } from './tickets.service';
import { PrismaService } from '../../database/prisma.service';

function makeWithOrganization(prisma: DeepMocked<PrismaService>) {
  return jest
    .fn()
    .mockImplementation(async (_orgId: string, fn: (tx: any) => any) =>
      fn(prisma as any),
    );
}

describe('TicketsService', () => {
  let service: TicketsService;
  let prisma: DeepMocked<PrismaService>;
  let events: DeepMocked<EventEmitter2>;

  const ORG_ID = 'org_abc';
  const USER_ID = 'user_123';

  beforeEach(() => {
    prisma = createMock<PrismaService>();
    events = createMock<EventEmitter2>();
    (prisma.withOrganization as any) = makeWithOrganization(prisma);
    service = new TicketsService(prisma, events);
  });

  describe('create', () => {
    it('defaults priority to medium and assigns to creator; emits ticket.created', async () => {
      const created = {
        id: 't1',
        subject: 'Help',
        status: 'open',
        priority: 'medium',
        assignedTo: USER_ID,
      };
      (prisma.ticket.create as jest.Mock).mockResolvedValue(created);

      await service.create(ORG_ID, { subject: 'Help' }, USER_ID);

      expect(prisma.ticket.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            subject: 'Help',
            priority: 'medium',
            status: 'open',
            assignedTo: USER_ID,
          }),
        }),
      );
      expect(events.emit).toHaveBeenCalledWith(
        'ticket.created',
        expect.objectContaining({ ticket: created }),
      );
    });
  });

  describe('reply', () => {
    it('staff reply flips status to "answered" and bumps lastReplyAt', async () => {
      (prisma.ticket.findFirst as jest.Mock).mockResolvedValue({
        id: 't1',
        status: 'open',
        replies: [],
      });
      (prisma.ticketReply.create as jest.Mock).mockResolvedValue({ id: 'r1' });
      (prisma.ticket.update as jest.Mock).mockResolvedValue({});

      await service.reply(ORG_ID, 't1', { message: 'Hi' }, USER_ID);

      expect(prisma.ticket.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 't1' },
          data: expect.objectContaining({
            status: 'answered',
            lastReplyAt: expect.any(Date),
          }),
        }),
      );
    });

    it('client reply (isStaff=false) puts ticket back to "open"', async () => {
      (prisma.ticket.findFirst as jest.Mock).mockResolvedValue({
        id: 't1',
        status: 'answered',
        replies: [],
      });
      (prisma.ticketReply.create as jest.Mock).mockResolvedValue({ id: 'r1' });
      (prisma.ticket.update as jest.Mock).mockResolvedValue({});

      await service.reply(
        ORG_ID,
        't1',
        { message: 'Thanks', isStaff: false },
        USER_ID,
      );

      expect(prisma.ticket.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ status: 'open' }),
        }),
      );
    });

    it('internal note does NOT change ticket status', async () => {
      (prisma.ticket.findFirst as jest.Mock).mockResolvedValue({
        id: 't1',
        status: 'open',
        replies: [],
      });
      (prisma.ticketReply.create as jest.Mock).mockResolvedValue({ id: 'r1' });
      (prisma.ticket.update as jest.Mock).mockResolvedValue({});

      await service.reply(
        ORG_ID,
        't1',
        { message: 'private', isInternal: true },
        USER_ID,
      );

      const updateCall = (prisma.ticket.update as jest.Mock).mock.calls[0][0];
      expect(updateCall.data.status).toBeUndefined();
      expect(updateCall.data.lastReplyAt).toBeInstanceOf(Date);
    });

    it('emits ticket.replied with reply payload', async () => {
      (prisma.ticket.findFirst as jest.Mock).mockResolvedValue({
        id: 't1',
        status: 'open',
        replies: [],
      });
      const reply = { id: 'r1' };
      (prisma.ticketReply.create as jest.Mock).mockResolvedValue(reply);
      (prisma.ticket.update as jest.Mock).mockResolvedValue({});

      await service.reply(ORG_ID, 't1', { message: 'hi' }, USER_ID);
      expect(events.emit).toHaveBeenCalledWith(
        'ticket.replied',
        expect.objectContaining({ reply, ticketId: 't1' }),
      );
    });
  });

  describe('updateStatus', () => {
    it('stamps closedAt when transitioning to closed', async () => {
      (prisma.ticket.findFirst as jest.Mock).mockResolvedValue({
        id: 't1',
        status: 'open',
        replies: [],
      });
      (prisma.ticket.update as jest.Mock).mockResolvedValue({
        id: 't1',
        status: 'closed',
        client: null,
      });
      (prisma.organization.findUnique as jest.Mock).mockResolvedValue({
        settings: {},
      });

      await service.updateStatus(ORG_ID, 't1', 'closed');

      expect(prisma.ticket.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 't1' },
          data: expect.objectContaining({
            status: 'closed',
            closedAt: expect.any(Date),
          }),
        }),
      );
    });

    it('emits ticket.satisfaction_survey when org has the setting + closed + has contact email', async () => {
      (prisma.ticket.findFirst as jest.Mock).mockResolvedValue({
        id: 't1',
        status: 'open',
        replies: [],
      });
      (prisma.ticket.update as jest.Mock).mockResolvedValue({
        id: 't1',
        status: 'closed',
        client: { contacts: [{ email: 'cust@x.com' }] },
      });
      (prisma.organization.findUnique as jest.Mock).mockResolvedValue({
        name: 'Acme',
        settings: { ticketSatisfactionSurvey: true },
      });

      await service.updateStatus(ORG_ID, 't1', 'closed');
      expect(events.emit).toHaveBeenCalledWith(
        'ticket.satisfaction_survey',
        expect.objectContaining({
          orgId: ORG_ID,
          contactEmail: 'cust@x.com',
        }),
      );
    });

    it('does NOT emit satisfaction survey when org disables the setting', async () => {
      (prisma.ticket.findFirst as jest.Mock).mockResolvedValue({
        id: 't1',
        status: 'open',
        replies: [],
      });
      (prisma.ticket.update as jest.Mock).mockResolvedValue({
        id: 't1',
        status: 'closed',
        client: { contacts: [{ email: 'cust@x.com' }] },
      });
      (prisma.organization.findUnique as jest.Mock).mockResolvedValue({
        settings: {},
      });

      await service.updateStatus(ORG_ID, 't1', 'closed');
      const survey = events.emit.mock.calls.find(
        (c) => c[0] === 'ticket.satisfaction_survey',
      );
      expect(survey).toBeUndefined();
    });
  });

  describe('assign', () => {
    it('updates assignedTo and emits ticket.assigned', async () => {
      (prisma.ticket.findFirst as jest.Mock).mockResolvedValue({
        id: 't1',
        replies: [],
      });
      const updated = { id: 't1', assignedTo: 'agent_2' };
      (prisma.ticket.update as jest.Mock).mockResolvedValue(updated);

      await service.assign(ORG_ID, 't1', 'agent_2');

      expect(prisma.ticket.update).toHaveBeenCalledWith({
        where: { id: 't1' },
        data: { assignedTo: 'agent_2' },
      });
      expect(events.emit).toHaveBeenCalledWith(
        'ticket.assigned',
        expect.objectContaining({ assignedTo: 'agent_2' }),
      );
    });
  });

  describe('merge', () => {
    it('refuses to merge a ticket with itself', async () => {
      (prisma.ticket.findFirst as jest.Mock).mockResolvedValue({
        id: 't1',
        organizationId: ORG_ID,
      });
      await expect(service.merge(ORG_ID, 't1', 't1')).rejects.toThrow(
        BadRequestException,
      );
    });

    it('refuses if either side is missing', async () => {
      (prisma.ticket.findFirst as jest.Mock)
        .mockResolvedValueOnce({ id: 't1', organizationId: ORG_ID })
        .mockResolvedValueOnce(null);
      await expect(service.merge(ORG_ID, 't1', 't2')).rejects.toThrow(
        NotFoundException,
      );
    });

    it('moves replies, posts a system note, and closes the source', async () => {
      (prisma.ticket.findFirst as jest.Mock)
        .mockResolvedValueOnce({
          id: 'target',
          organizationId: ORG_ID,
          assignedTo: 'agent_1',
        })
        .mockResolvedValueOnce({
          id: 'source',
          organizationId: ORG_ID,
          subject: 'Old issue',
        });
      (prisma.ticketReply.updateMany as jest.Mock).mockResolvedValue({});
      (prisma.ticketReply.create as jest.Mock).mockResolvedValue({});
      (prisma.ticket.update as jest.Mock).mockResolvedValue({});

      await service.merge(ORG_ID, 'target', 'source');

      expect(prisma.ticketReply.updateMany).toHaveBeenCalledWith({
        where: { ticketId: 'source' },
        data: { ticketId: 'target' },
      });
      // System note created on target
      expect(prisma.ticketReply.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            ticketId: 'target',
            message: expect.stringContaining('Merged from'),
          }),
        }),
      );
      // Source closed
      expect(prisma.ticket.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'source' },
          data: expect.objectContaining({ status: 'closed' }),
        }),
      );
    });
  });

  describe('SLA enrichment', () => {
    it('flags tickets that have not received first reply within SLA', async () => {
      const createdAt = new Date(Date.now() - 5 * 3600 * 1000); // 5h ago
      (prisma.ticket.findMany as jest.Mock).mockResolvedValue([
        {
          id: 't1',
          status: 'open',
          createdAt,
          closedAt: null,
          department: { slaResponseHours: 1, slaResolutionHours: null },
          replies: [],
        },
      ]);
      (prisma.ticket.count as jest.Mock).mockResolvedValue(1);

      const r = await service.findAll(ORG_ID, {});
      expect(r.data[0].slaResponseStatus).toBe('breached');
    });

    it('marks SLA "ok" when first reply landed within window', async () => {
      const createdAt = new Date('2025-01-01T00:00:00Z');
      const replyAt = new Date('2025-01-01T00:30:00Z'); // 30m later
      (prisma.ticket.findMany as jest.Mock).mockResolvedValue([
        {
          id: 't1',
          status: 'answered',
          createdAt,
          closedAt: null,
          department: { slaResponseHours: 4, slaResolutionHours: null },
          replies: [{ createdAt: replyAt }],
        },
      ]);
      (prisma.ticket.count as jest.Mock).mockResolvedValue(1);

      const r = await service.findAll(ORG_ID, {});
      expect(r.data[0].slaResponseStatus).toBe('ok');
    });
  });

  describe('delete', () => {
    it('removes replies before deleting the ticket', async () => {
      (prisma.ticket.findFirst as jest.Mock).mockResolvedValue({
        id: 't1',
        replies: [],
      });
      (prisma.ticketReply.deleteMany as jest.Mock).mockResolvedValue({});
      (prisma.ticket.delete as jest.Mock).mockResolvedValue({});

      await service.delete(ORG_ID, 't1');

      expect(prisma.ticketReply.deleteMany).toHaveBeenCalledWith({
        where: { ticketId: 't1' },
      });
      expect(prisma.ticket.delete).toHaveBeenCalledWith({
        where: { id: 't1' },
      });
      expect(events.emit).toHaveBeenCalledWith('ticket.deleted', {
        id: 't1',
        orgId: ORG_ID,
      });
    });
  });

  describe('getSlaReport', () => {
    it('computes response/resolution compliance percentages', async () => {
      const t0 = new Date('2025-01-01T00:00:00Z');
      const t1 = new Date('2025-01-01T01:00:00Z');
      const t4 = new Date('2025-01-01T04:00:00Z');
      (prisma.ticket.findMany as jest.Mock).mockResolvedValue([
        {
          createdAt: t0,
          closedAt: t4, // 4h resolution, SLA 8h → ok
          department: { slaResponseHours: 2, slaResolutionHours: 8 },
          replies: [{ createdAt: t1 }], // 1h reply, SLA 2h → ok
        },
        {
          createdAt: t0,
          closedAt: t4,
          department: { slaResponseHours: null, slaResolutionHours: 1 }, // 4h > 1h breached
          replies: [],
        },
      ]);

      const r = await service.getSlaReport(ORG_ID);
      // 1/1 response (only ticket #1 had SLA + reply)
      expect(r.responseCompliance).toBe(100);
      // 1 in / 2 with resolution SLA → 50%
      expect(r.resolutionCompliance).toBe(50);
      expect(r.totalTickets).toBe(2);
    });
  });
});
