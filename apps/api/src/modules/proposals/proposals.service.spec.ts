import { BadRequestException, NotFoundException } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { createMock, DeepMocked } from '@golevelup/ts-jest';
import { ProposalsService } from './proposals.service';
import { PrismaService } from '../../database/prisma.service';

function makeWithOrganization(prisma: DeepMocked<PrismaService>) {
  return jest
    .fn()
    .mockImplementation(async (_orgId: string, fn: (tx: any) => any) =>
      fn(prisma as any),
    );
}

describe('ProposalsService', () => {
  let service: ProposalsService;
  let prisma: DeepMocked<PrismaService>;
  let events: DeepMocked<EventEmitter2>;

  const ORG_ID = 'org_abc';
  const USER_ID = 'user_123';

  beforeEach(() => {
    prisma = createMock<PrismaService>();
    events = createMock<EventEmitter2>();
    (prisma.withOrganization as any) = makeWithOrganization(prisma);
    service = new ProposalsService(prisma, events);
  });

  describe('create', () => {
    it('creates a draft, generates a hash, and emits proposal.created', async () => {
      const created = { id: 'p1', subject: 'Q4 Proposal', status: 'draft' };
      (prisma.proposal.create as jest.Mock).mockResolvedValue(created);

      await service.create(ORG_ID, { subject: 'Q4 Proposal' }, USER_ID);

      expect(prisma.proposal.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            subject: 'Q4 Proposal',
            status: 'draft',
            allowComments: true,
            signatureRequired: false,
            hash: expect.stringMatching(/^[0-9a-f-]{36}$/i),
          }),
        }),
      );
      expect(events.emit).toHaveBeenCalledWith(
        'proposal.created',
        expect.objectContaining({ proposal: created }),
      );
    });

    it('rejects items with productIds outside the org', async () => {
      (prisma.product.findMany as jest.Mock).mockResolvedValue([]);
      await expect(
        service.create(
          ORG_ID,
          {
            subject: 'X',
            items: [{ description: 'a', productId: 'prod_x' }],
          },
          USER_ID,
        ),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('update', () => {
    it('refuses to edit a sent proposal', async () => {
      (prisma.proposal.findFirst as jest.Mock).mockResolvedValue({
        id: 'p1',
        status: 'sent',
        items: [],
        comments: [],
      });
      await expect(
        service.update(ORG_ID, 'p1', { subject: 'New' }),
      ).rejects.toThrow(/draft or revising/);
    });

    it('allows editing a revising proposal', async () => {
      (prisma.proposal.findFirst as jest.Mock).mockResolvedValue({
        id: 'p1',
        status: 'revising',
        items: [],
        comments: [],
      });
      (prisma.proposal.update as jest.Mock).mockResolvedValue({ id: 'p1' });
      const r = await service.update(ORG_ID, 'p1', { subject: 'New' });
      expect(r).toEqual({ id: 'p1' });
    });
  });

  describe('updateStatus', () => {
    it('normalises "revised" → "revising" before persisting', async () => {
      (prisma.proposal.findFirst as jest.Mock).mockResolvedValue({
        id: 'p1',
        status: 'sent',
        items: [],
        comments: [],
      });
      (prisma.proposal.update as jest.Mock).mockResolvedValue({
        id: 'p1',
        status: 'revising',
      });

      await service.updateStatus(ORG_ID, 'p1', 'revised', USER_ID);

      expect(prisma.proposal.update).toHaveBeenCalledWith({
        where: { id: 'p1' },
        data: { status: 'revising' },
      });
      expect(events.emit).toHaveBeenCalledWith(
        'proposal.status_changed',
        expect.objectContaining({ newStatus: 'revising' }),
      );
    });

    it('rejects an unknown status', async () => {
      await expect(
        service.updateStatus(ORG_ID, 'p1', 'frobnicated'),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('bulkUpdateStatus', () => {
    it('refuses to reverse accepted/declined except to revising', async () => {
      (prisma.proposal.findMany as jest.Mock).mockResolvedValue([
        { id: 'p1', status: 'accepted' },
        { id: 'p2', status: 'declined' },
      ]);
      const r = await service.bulkUpdateStatus(ORG_ID, ['p1', 'p2'], 'sent');
      expect(r.updated).toBe(0);
      expect(r.skipped).toHaveLength(2);
    });

    it('allows accepted → revising (re-open path)', async () => {
      (prisma.proposal.findMany as jest.Mock).mockResolvedValue([
        { id: 'p1', status: 'accepted' },
      ]);
      (prisma.proposal.update as jest.Mock).mockResolvedValue({});
      const r = await service.bulkUpdateStatus(ORG_ID, ['p1'], 'revised');
      expect(r.updated).toBe(1);
    });
  });

  describe('public sign flow', () => {
    it('markOpen no-ops when proposal is already past sent', async () => {
      const proposal = { id: 'p1', status: 'open' };
      (prisma.proposal.findUnique as jest.Mock).mockResolvedValue(proposal);

      const r = await service.markOpen('hash_xyz');
      expect(r).toBe(proposal);
      expect(prisma.proposal.update).not.toHaveBeenCalled();
    });

    it('markOpen flips sent → open and emits proposal.opened', async () => {
      (prisma.proposal.findUnique as jest.Mock).mockResolvedValue({
        id: 'p1',
        status: 'sent',
      });
      const opened = { id: 'p1', status: 'open' };
      (prisma.proposal.update as jest.Mock).mockResolvedValue(opened);

      const r = await service.markOpen('hash_xyz');
      expect(r).toBe(opened);
      expect(events.emit).toHaveBeenCalledWith(
        'proposal.opened',
        expect.objectContaining({ proposal: opened }),
      );
    });

    it('accept refuses if the status is not sent/open', async () => {
      (prisma.proposal.findUnique as jest.Mock).mockResolvedValue({
        id: 'p1',
        status: 'declined',
      });
      await expect(service.accept('h')).rejects.toThrow(BadRequestException);
    });

    it('accept stamps signedAt and emits proposal.accepted', async () => {
      (prisma.proposal.findUnique as jest.Mock).mockResolvedValue({
        id: 'p1',
        status: 'sent',
      });
      (prisma.proposal.update as jest.Mock).mockResolvedValue({
        id: 'p1',
        status: 'accepted',
        signedAt: new Date(),
      });

      await service.accept('hash_xyz');
      expect(prisma.proposal.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { hash: 'hash_xyz' },
          data: expect.objectContaining({
            status: 'accepted',
            signedAt: expect.any(Date),
          }),
        }),
      );
      expect(events.emit).toHaveBeenCalledWith(
        'proposal.accepted',
        expect.any(Object),
      );
    });

    it('decline refuses for terminal statuses', async () => {
      (prisma.proposal.findUnique as jest.Mock).mockResolvedValue({
        id: 'p1',
        status: 'accepted',
      });
      await expect(service.decline('h')).rejects.toThrow(BadRequestException);
    });
  });

  describe('addComment', () => {
    it('rejects when comments are disabled (admin path)', async () => {
      (prisma.proposal.findFirst as jest.Mock).mockResolvedValue({
        id: 'p1',
        allowComments: false,
      });
      await expect(
        service.addComment('p1', 'hi', true, USER_ID, ORG_ID),
      ).rejects.toThrow(/Comments are disabled/);
    });

    it('rejects when comments are disabled (public path)', async () => {
      (prisma.proposal.findUnique as jest.Mock).mockResolvedValue({
        id: 'p1',
        allowComments: false,
      });
      await expect(
        service.addComment('p1', 'hi', false, USER_ID),
      ).rejects.toThrow(/Comments are disabled/);
    });

    it('throws NotFoundException when the proposal is missing (org-scoped path)', async () => {
      (prisma.proposal.findFirst as jest.Mock).mockResolvedValue(null);
      await expect(
        service.addComment('p1', 'hi', true, USER_ID, ORG_ID),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('getByHash', () => {
    it('omits organizationId from the public response', async () => {
      (prisma.proposal.findUnique as jest.Mock).mockResolvedValue({
        id: 'p1',
        organizationId: 'leak_me_not',
        subject: 'Public',
        status: 'open',
      });
      const r = (await service.getByHash('h')) as any;
      expect(r.organizationId).toBeUndefined();
      expect(r.subject).toBe('Public');
    });
  });
});
