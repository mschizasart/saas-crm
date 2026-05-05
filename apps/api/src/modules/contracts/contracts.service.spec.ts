import { BadRequestException, NotFoundException } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { createMock, DeepMocked } from '@golevelup/ts-jest';
import { ContractsService } from './contracts.service';
import { PrismaService } from '../../database/prisma.service';

function makeWithOrganization(prisma: DeepMocked<PrismaService>) {
  return jest
    .fn()
    .mockImplementation(async (_orgId: string, fn: (tx: any) => any) =>
      fn(prisma as any),
    );
}

describe('ContractsService', () => {
  let service: ContractsService;
  let prisma: DeepMocked<PrismaService>;
  let events: DeepMocked<EventEmitter2>;

  const ORG_ID = 'org_abc';
  const USER_ID = 'user_123';

  beforeEach(() => {
    prisma = createMock<PrismaService>();
    events = createMock<EventEmitter2>();
    (prisma.withOrganization as any) = makeWithOrganization(prisma);
    service = new ContractsService(prisma, events);
  });

  describe('static merge fields', () => {
    it('exposes the canonical placeholder list', () => {
      const fields = ContractsService.getAvailableMergeFields().map((f) => f.key);
      expect(fields).toEqual(
        expect.arrayContaining([
          '{client_name}',
          '{contact_name}',
          '{contract_value}',
          '{start_date}',
          '{end_date}',
          '{today}',
          '{organization_name}',
          '{organization_address}',
        ]),
      );
    });
  });

  describe('create', () => {
    it('creates with sane defaults and emits contract.created', async () => {
      const created = { id: 'ctr_1', subject: 'MSA', status: 'draft' };
      (prisma.contract.create as jest.Mock).mockResolvedValue(created);

      await service.create(ORG_ID, { subject: 'MSA' }, USER_ID);

      expect(prisma.contract.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            subject: 'MSA',
            status: 'draft',
            signatureRequired: false,
            createdBy: USER_ID,
          }),
        }),
      );
      expect(events.emit).toHaveBeenCalledWith(
        'contract.created',
        expect.objectContaining({ contract: created }),
      );
    });
  });

  describe('update', () => {
    it('refuses to edit a non-draft contract', async () => {
      (prisma.contract.findFirst as jest.Mock).mockResolvedValue({
        id: 'ctr_1',
        status: 'active',
        comments: [],
      });
      await expect(
        service.update(ORG_ID, 'ctr_1', { subject: 'X' }),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('sendForSigning', () => {
    it('refuses for non-draft contracts', async () => {
      (prisma.contract.findFirst as jest.Mock).mockResolvedValue({
        id: 'ctr_1',
        status: 'active',
        comments: [],
      });
      await expect(service.sendForSigning(ORG_ID, 'ctr_1')).rejects.toThrow(
        BadRequestException,
      );
    });

    it('flips draft → pending_signature and emits contract.sent_for_signing', async () => {
      const updated = { id: 'ctr_1', status: 'pending_signature' };
      (prisma.contract.findFirst as jest.Mock).mockResolvedValue({
        id: 'ctr_1',
        status: 'draft',
        comments: [],
      });
      (prisma.contract.update as jest.Mock).mockResolvedValue({});
      (prisma.contract.findUnique as jest.Mock).mockResolvedValue(updated);

      await service.sendForSigning(ORG_ID, 'ctr_1');

      expect(prisma.contract.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'ctr_1' },
          data: { status: 'pending_signature' },
        }),
      );
      expect(events.emit).toHaveBeenCalledWith(
        'contract.sent_for_signing',
        expect.objectContaining({ contract: updated }),
      );
    });
  });

  describe('sign (public)', () => {
    it('throws NotFoundException for a missing hash', async () => {
      (prisma.contract.findUnique as jest.Mock).mockResolvedValue(null);
      await expect(service.sign('h', 'png', 'A', 'a@x.com')).rejects.toThrow(
        NotFoundException,
      );
    });

    it('refuses to sign a contract not awaiting signature', async () => {
      (prisma.contract.findUnique as jest.Mock).mockResolvedValue({
        id: 'ctr_1',
        status: 'draft',
      });
      await expect(service.sign('h', 'png', 'A', 'a@x.com')).rejects.toThrow(
        /not awaiting a signature/,
      );
    });

    it('persists signature payload + emits contract.signed', async () => {
      (prisma.contract.findUnique as jest.Mock).mockResolvedValue({
        id: 'ctr_1',
        status: 'pending_signature',
      });
      const signed = {
        id: 'ctr_1',
        status: 'active',
        organizationId: ORG_ID,
        signedAt: new Date(),
      };
      (prisma.contract.update as jest.Mock).mockResolvedValue(signed);

      await service.sign('h', 'pngdata', 'Alice', 'a@x.com');

      expect(prisma.contract.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { hash: 'h' },
          data: expect.objectContaining({
            status: 'active',
            signatureData: 'pngdata',
            signedByName: 'Alice',
            signedByEmail: 'a@x.com',
          }),
        }),
      );
      expect(events.emit).toHaveBeenCalledWith(
        'contract.signed',
        expect.objectContaining({ contract: signed, orgId: ORG_ID }),
      );
    });
  });

  describe('getByHash', () => {
    it('omits the organizationId from the public payload', async () => {
      (prisma.contract.findUnique as jest.Mock).mockResolvedValue({
        id: 'ctr_1',
        subject: 'X',
        organizationId: 'leak',
        status: 'sent',
        signatureRequired: true,
        client: { id: 'c1', company: 'Acme' },
      });
      const r: any = await service.getByHash('h');
      expect(r.organizationId).toBeUndefined();
      expect(r.client.company).toBe('Acme');
    });
  });

  describe('renderContent', () => {
    it('substitutes merge fields with client/contact/org data', async () => {
      (prisma.contract.findFirst as jest.Mock).mockResolvedValue({
        id: 'ctr_1',
        content:
          'Client: {client_name}; Contact: {contact_name}; Email: {contact_email}; Value: {contract_value}; Org: {organization_name}',
        value: 5000,
        startDate: null,
        endDate: null,
        client: {
          company: 'Acme',
          contacts: [
            { firstName: 'Alice', lastName: 'Anderson', email: 'a@acme.com' },
          ],
        },
        organization: { name: 'Globex Corp', address: '1 Main St' },
      });

      const { content } = await service.renderContent(ORG_ID, 'ctr_1');
      expect(content).toContain('Client: Acme');
      expect(content).toContain('Contact: Alice Anderson');
      expect(content).toContain('Email: a@acme.com');
      expect(content).toContain('Value: 5000');
      expect(content).toContain('Org: Globex Corp');
      expect(content).not.toContain('{');
    });

    it('throws NotFoundException for an unknown contract', async () => {
      (prisma.contract.findFirst as jest.Mock).mockResolvedValue(null);
      await expect(service.renderContent(ORG_ID, 'missing')).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('renew', () => {
    it('clones the source contract as draft with +1y endDate and emits contract.renewed', async () => {
      const src = {
        id: 'ctr_old',
        clientId: 'c1',
        subject: 'MSA',
        content: '<p/>',
        type: 'general',
        value: 1000,
        createdBy: USER_ID,
        comments: [],
      };
      (prisma.contract.findFirst as jest.Mock).mockResolvedValue(src);
      const renewed = {
        id: 'ctr_new',
        subject: 'MSA (Renewed)',
        status: 'draft',
      };
      (prisma.contract.create as jest.Mock).mockResolvedValue(renewed);

      const r = await service.renew(ORG_ID, 'ctr_old');

      const callArgs = (prisma.contract.create as jest.Mock).mock.calls[0][0];
      expect(callArgs.data.subject).toBe('MSA (Renewed)');
      expect(callArgs.data.status).toBe('draft');
      // start +1y endDate
      const start = callArgs.data.startDate as Date;
      const end = callArgs.data.endDate as Date;
      expect(end.getFullYear() - start.getFullYear()).toBe(1);

      expect(events.emit).toHaveBeenCalledWith(
        'contract.renewed',
        expect.objectContaining({ contract: renewed, renewedFrom: 'ctr_old' }),
      );
      expect(r).toBe(renewed);
    });
  });

  describe('delete', () => {
    it('refuses to delete an active contract', async () => {
      (prisma.contract.findFirst as jest.Mock).mockResolvedValue({
        id: 'ctr_1',
        status: 'active',
        comments: [],
      });
      await expect(service.delete(ORG_ID, 'ctr_1')).rejects.toThrow(
        BadRequestException,
      );
    });
  });
});
