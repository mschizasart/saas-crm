import { createMock, DeepMocked } from '@golevelup/ts-jest';
import { InboxRouterService } from './router.service';
import { PrismaService } from '../../database/prisma.service';

function makeWithOrganization(prisma: DeepMocked<PrismaService>) {
  return jest
    .fn()
    .mockImplementation(async (_orgId: string, fn: (tx: any) => any) =>
      fn(prisma as any),
    );
}

describe('InboxRouterService', () => {
  let service: InboxRouterService;
  let prisma: DeepMocked<PrismaService>;

  const ORG_ID = 'org_abc';

  beforeEach(() => {
    prisma = createMock<PrismaService>();
    (prisma.withOrganization as any) = makeWithOrganization(prisma);
    service = new InboxRouterService(prisma);

    // Most tests don't need these — provide null defaults so each step
    // continues to the next routing rule.
    (prisma.outboundMessage.findFirst as jest.Mock).mockResolvedValue(null);
    (prisma.ticket.findFirst as jest.Mock).mockResolvedValue(null);
    (prisma.lead.findFirst as jest.Mock).mockResolvedValue(null);
    (prisma.user.findFirst as jest.Mock).mockResolvedValue(null);
    (prisma.invoice.findFirst as jest.Mock).mockResolvedValue(null);
    (prisma.estimate.findFirst as jest.Mock).mockResolvedValue(null);
  });

  describe('route', () => {
    it('uses OutboundMessage reply tracking first (highest priority)', async () => {
      (prisma.outboundMessage.findFirst as jest.Mock).mockResolvedValue({
        messageId: '<abc@example>',
        routedTo: 'lead',
        routedToId: 'lead_42',
      });
      // Lead lookup would also match but reply tracking should win
      (prisma.lead.findFirst as jest.Mock).mockResolvedValue({ id: 'lead_99' });

      const r = await service.route({
        organizationId: ORG_ID,
        fromEmail: 'cust@x.com',
        subject: 'Re: Hi',
        inReplyTo: '<abc@example>',
        referenceIds: [],
      });

      expect(r.routedTo).toBe('lead');
      expect(r.routedToId).toBe('lead_42');
      // Lead lookup should not have been called
      expect(prisma.lead.findFirst).not.toHaveBeenCalled();
    });

    it('falls through to ticket subject tag when no outbound match', async () => {
      (prisma.ticket.findFirst as jest.Mock).mockResolvedValue({
        id: 'ticket_99',
      });
      const r = await service.route({
        organizationId: ORG_ID,
        fromEmail: 'cust@x.com',
        subject: '[#ticket_99] Re: Help',
        inReplyTo: null,
        referenceIds: [],
      });
      expect(r.routedTo).toBe('ticket');
      expect(r.routedToId).toBe('ticket_99');
    });

    it('routes to a Lead when its email matches (case-insensitive)', async () => {
      (prisma.lead.findFirst as jest.Mock).mockResolvedValue({ id: 'lead_1' });
      const r = await service.route({
        organizationId: ORG_ID,
        fromEmail: 'CUST@X.com',
        subject: 'New question',
        inReplyTo: null,
        referenceIds: [],
      });
      expect(r.routedTo).toBe('lead');
      expect(r.routedToId).toBe('lead_1');
      // Verify the email was normalized to lowercase before lookup
      const callArgs = (prisma.lead.findFirst as jest.Mock).mock.calls[0][0];
      expect(callArgs.where.email.equals).toBe('cust@x.com');
    });

    it('routes to a Client via contact (User type=contact) when no Lead exists', async () => {
      (prisma.user.findFirst as jest.Mock).mockResolvedValue({
        clientId: 'client_1',
      });
      const r = await service.route({
        organizationId: ORG_ID,
        fromEmail: 'sales@acme.com',
        subject: 'General question',
        inReplyTo: null,
        referenceIds: [],
      });
      expect(r.routedTo).toBe('client');
      expect(r.routedToId).toBe('client_1');
    });

    it('promotes to Invoice routing when subject contains an INV-XXXX number', async () => {
      (prisma.user.findFirst as jest.Mock).mockResolvedValue({
        clientId: 'client_1',
      });
      (prisma.invoice.findFirst as jest.Mock).mockResolvedValue({
        id: 'inv_1',
        number: 'INV-0042',
      });
      const r = await service.route({
        organizationId: ORG_ID,
        fromEmail: 'sales@acme.com',
        subject: 'About INV-0042',
        inReplyTo: null,
        referenceIds: [],
      });
      expect(r.routedTo).toBe('invoice');
      expect(r.routedToId).toBe('inv_1');
    });

    it('promotes to Estimate routing when subject contains an EST-XXXX number', async () => {
      (prisma.user.findFirst as jest.Mock).mockResolvedValue({
        clientId: 'client_1',
      });
      (prisma.estimate.findFirst as jest.Mock).mockResolvedValue({
        id: 'est_1',
        number: 'EST-0007',
      });
      const r = await service.route({
        organizationId: ORG_ID,
        fromEmail: 'sales@acme.com',
        subject: 'Re: EST-0007',
        inReplyTo: null,
        referenceIds: [],
      });
      expect(r.routedTo).toBe('estimate');
      expect(r.routedToId).toBe('est_1');
    });

    it('falls back to client when the doc number in subject does not match', async () => {
      (prisma.user.findFirst as jest.Mock).mockResolvedValue({
        clientId: 'client_1',
      });
      (prisma.invoice.findFirst as jest.Mock).mockResolvedValue(null);
      const r = await service.route({
        organizationId: ORG_ID,
        fromEmail: 'sales@acme.com',
        subject: 'About INV-9999',
        inReplyTo: null,
        referenceIds: [],
      });
      expect(r.routedTo).toBe('client');
      expect(r.routedToId).toBe('client_1');
    });

    it('returns "unmatched" when nothing matches', async () => {
      const r = await service.route({
        organizationId: ORG_ID,
        fromEmail: 'stranger@x.com',
        subject: 'Hello',
        inReplyTo: null,
        referenceIds: [],
      });
      expect(r.routedTo).toBe('unmatched');
      expect(r.routedToId).toBeNull();
    });

    it('returns "unmatched" when from email is empty', async () => {
      const r = await service.route({
        organizationId: ORG_ID,
        fromEmail: '',
        subject: 'Hello',
        inReplyTo: null,
        referenceIds: [],
      });
      expect(r.routedTo).toBe('unmatched');
      expect(r.reason).toMatch(/empty from/);
    });

    it('ignores subject tag when the ticket is from a different org (tenant isolation)', async () => {
      // Simulate tx scope returning null for cross-org lookups
      (prisma.ticket.findFirst as jest.Mock).mockResolvedValue(null);
      const r = await service.route({
        organizationId: ORG_ID,
        fromEmail: '',
        subject: '[#ticket_other_org] Hello',
        inReplyTo: null,
        referenceIds: [],
      });
      expect(r.routedTo).toBe('unmatched');
    });
  });

  describe('validateTarget', () => {
    it('routedTo=unmatched is valid only when routedToId is null', async () => {
      expect(await service.validateTarget(ORG_ID, 'unmatched', null)).toBe(true);
      expect(await service.validateTarget(ORG_ID, 'unmatched', 'x')).toBe(false);
    });

    it('returns false when routedToId is missing for any non-unmatched target', async () => {
      expect(await service.validateTarget(ORG_ID, 'lead', null)).toBe(false);
    });

    it('checks the appropriate table for each target type', async () => {
      (prisma.lead.findFirst as jest.Mock).mockResolvedValue({ id: 'l1' });
      expect(await service.validateTarget(ORG_ID, 'lead', 'l1')).toBe(true);

      (prisma.invoice.findFirst as jest.Mock).mockResolvedValue(null);
      expect(await service.validateTarget(ORG_ID, 'invoice', 'inv_x')).toBe(
        false,
      );
    });
  });
});
