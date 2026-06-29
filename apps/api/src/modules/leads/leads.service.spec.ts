import { BadRequestException, NotFoundException } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { createMock, DeepMocked } from '@golevelup/ts-jest';
import { LeadsService } from './leads.service';
import { PrismaService } from '../../database/prisma.service';
import { ActivityLogService } from '../activity-log/activity-log.service';
import { RecordSharingService } from '../record-sharing/record-sharing.service';
import { ValidationRulesService } from '../validation-rules/validation-rules.service';

function makeWithOrganization(prisma: DeepMocked<PrismaService>) {
  return jest
    .fn()
    .mockImplementation(async (_orgId: string, fn: (tx: any) => any) =>
      fn(prisma as any),
    );
}

describe('LeadsService', () => {
  let service: LeadsService;
  let prisma: DeepMocked<PrismaService>;
  let events: DeepMocked<EventEmitter2>;
  let activityLog: DeepMocked<ActivityLogService>;
  let recordSharing: DeepMocked<RecordSharingService>;
  let validationRules: DeepMocked<ValidationRulesService>;

  const ORG_ID = 'org_a';
  const USER_ID = 'user_a';

  beforeEach(() => {
    prisma = createMock<PrismaService>();
    events = createMock<EventEmitter2>();
    activityLog = createMock<ActivityLogService>();
    recordSharing = createMock<RecordSharingService>();
    validationRules = createMock<ValidationRulesService>();
    // Default: no rules configured → loadCustomFieldValues yields an empty map
    // and assertValid is a no-op (DeepMocked methods resolve undefined).
    (validationRules.loadCustomFieldValues as jest.Mock).mockResolvedValue({});
    (prisma.withOrganization as any) = makeWithOrganization(prisma);
    service = new LeadsService(
      prisma,
      events,
      activityLog,
      recordSharing,
      validationRules,
    );
  });

  // ─── create ───────────────────────────────────────────────────
  describe('create', () => {
    it('persists lead, resolves status to FK, emits lead.created', async () => {
      // status 'new' doesn't exist → service should create it
      (prisma.leadStatus.findFirst as jest.Mock).mockResolvedValue(null);
      (prisma.leadStatus.aggregate as jest.Mock).mockResolvedValue({
        _max: { position: 2 },
      });
      (prisma.leadStatus.create as jest.Mock).mockResolvedValue({
        id: 'st_new',
      });
      (prisma.lead.create as jest.Mock).mockResolvedValue({
        id: 'lead_1',
      });

      const out = await service.create(
        ORG_ID,
        { name: 'Jane Doe', email: 'j@d.com', status: 'new' },
        USER_ID,
      );

      expect(prisma.leadStatus.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          organizationId: ORG_ID,
          name: 'new',
          position: 3,
        }),
      });
      expect(prisma.lead.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          organizationId: ORG_ID,
          name: 'Jane Doe',
          email: 'j@d.com',
          statusId: 'st_new',
        }),
      });
      expect(events.emit).toHaveBeenCalledWith(
        'lead.created',
        expect.objectContaining({ orgId: ORG_ID, createdBy: USER_ID }),
      );
      expect(out.id).toBe('lead_1');
    });

    it('reuses an existing status (case-insensitive)', async () => {
      (prisma.leadStatus.findFirst as jest.Mock).mockResolvedValue({
        id: 'st_existing',
      });
      (prisma.lead.create as jest.Mock).mockResolvedValue({ id: 'lead_2' });

      await service.create(
        ORG_ID,
        { name: 'Foo', status: 'NEW' },
        USER_ID,
      );

      expect(prisma.leadStatus.create).not.toHaveBeenCalled();
      expect(prisma.lead.create).toHaveBeenCalledWith({
        data: expect.objectContaining({ statusId: 'st_existing' }),
      });
    });

    it('default-source resolution creates the source on first use', async () => {
      (prisma.leadSource.findFirst as jest.Mock).mockResolvedValue(null);
      (prisma.leadSource.create as jest.Mock).mockResolvedValue({
        id: 'src_new',
      });
      (prisma.lead.create as jest.Mock).mockResolvedValue({ id: 'l1' });

      await service.create(
        ORG_ID,
        { name: 'X', source: 'Website' },
        USER_ID,
      );

      expect(prisma.leadSource.create).toHaveBeenCalledWith({
        data: { organizationId: ORG_ID, name: 'Website' },
      });
      expect(prisma.lead.create).toHaveBeenCalledWith({
        data: expect.objectContaining({ sourceId: 'src_new' }),
      });
    });
  });

  // ─── update ───────────────────────────────────────────────────
  describe('update', () => {
    it('logs activity and emits status_changed when status flips to won', async () => {
      const existing = {
        id: 'l1',
        status: { name: 'qualified' },
        organizationId: ORG_ID,
      };
      (prisma.lead.findFirst as jest.Mock).mockResolvedValue(existing);
      (prisma.leadStatus.findFirst as jest.Mock).mockResolvedValue({
        id: 'st_won',
      });
      (prisma.lead.update as jest.Mock).mockResolvedValue({
        id: 'l1',
        status: { name: 'won' },
      });

      await service.update(ORG_ID, 'l1', { status: 'won' }, USER_ID);

      expect(activityLog.logEntityUpdate).toHaveBeenCalledWith(
        ORG_ID,
        USER_ID,
        'lead',
        'l1',
        existing,
        { status: 'won' },
      );
      expect(events.emit).toHaveBeenCalledWith(
        'lead.status_changed',
        expect.objectContaining({ newStatus: 'won' }),
      );
    });

    it('does NOT emit status_changed when status didn\'t actually change', async () => {
      (prisma.lead.findFirst as jest.Mock).mockResolvedValue({
        id: 'l1',
        status: { name: 'won' },
      });
      (prisma.leadStatus.findFirst as jest.Mock).mockResolvedValue({
        id: 'st_won',
      });
      (prisma.lead.update as jest.Mock).mockResolvedValue({
        id: 'l1',
      });

      await service.update(ORG_ID, 'l1', { status: 'won' }, USER_ID);

      expect(events.emit).not.toHaveBeenCalledWith(
        'lead.status_changed',
        expect.anything(),
      );
    });
  });

  // ─── updateStatus ─────────────────────────────────────────────
  describe('updateStatus', () => {
    it('rejects unknown statuses', async () => {
      await expect(
        service.updateStatus(ORG_ID, 'l1', 'banana'),
      ).rejects.toThrow(BadRequestException);
    });

    it('emits lead.status_changed with the previous status', async () => {
      (prisma.lead.findFirst as jest.Mock).mockResolvedValue({
        id: 'l1',
        status: { name: 'new' },
      });
      (prisma.leadStatus.findFirst as jest.Mock).mockResolvedValue({
        id: 'st_q',
      });
      (prisma.lead.update as jest.Mock).mockResolvedValue({
        id: 'l1',
      });

      await service.updateStatus(ORG_ID, 'l1', 'qualified');

      expect(events.emit).toHaveBeenCalledWith(
        'lead.status_changed',
        expect.objectContaining({
          previousStatus: 'new',
          newStatus: 'qualified',
        }),
      );
    });
  });

  // ─── convertToClient ──────────────────────────────────────────
  describe('convertToClient', () => {
    it('creates a client + primary contact (when email present), updates lead', async () => {
      const lead = {
        id: 'l1',
        name: 'John Smith',
        email: 'js@x.com',
        company: null,
        phone: '+1',
        website: null,
        address: null,
        city: null,
        state: null,
        zipCode: null,
        country: null,
      };
      (prisma.lead.findFirst as jest.Mock).mockResolvedValue(lead);
      (prisma.client.create as jest.Mock).mockResolvedValue({ id: 'client_new' });
      (prisma.user.findFirst as jest.Mock).mockResolvedValue(null);
      (prisma.user.create as jest.Mock).mockResolvedValue({});
      (prisma.lead.update as jest.Mock).mockResolvedValue({});

      const result = await service.convertToClient(ORG_ID, 'l1', USER_ID);

      expect(result.id).toBe('client_new');
      expect(prisma.client.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          organizationId: ORG_ID,
          company: 'John Smith', // falls back to lead.name when company is null
        }),
      });
      expect(prisma.user.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          email: 'js@x.com',
          type: 'contact',
          isPrimary: true,
          firstName: 'John',
          lastName: 'Smith',
        }),
      });
      expect(prisma.lead.update).toHaveBeenCalledWith({
        where: { id: 'l1' },
        data: expect.objectContaining({
          convertedToClientId: 'client_new',
          convertedAt: expect.any(Date),
        }),
      });
      expect(events.emit).toHaveBeenCalledWith(
        'lead.converted',
        expect.objectContaining({ clientId: 'client_new', leadId: 'l1' }),
      );
    });

    it('skips creating contact when an existing user has the same email', async () => {
      (prisma.lead.findFirst as jest.Mock).mockResolvedValue({
        id: 'l1',
        name: 'A B',
        email: 'a@b.com',
      });
      (prisma.client.create as jest.Mock).mockResolvedValue({ id: 'client_a' });
      (prisma.user.findFirst as jest.Mock).mockResolvedValue({ id: 'pre' });
      (prisma.lead.update as jest.Mock).mockResolvedValue({});

      await service.convertToClient(ORG_ID, 'l1', USER_ID);

      expect(prisma.user.create).not.toHaveBeenCalled();
    });
  });

  // ─── findOne missing ──────────────────────────────────────────
  describe('findOne', () => {
    it('throws NotFound when missing', async () => {
      (prisma.lead.findFirst as jest.Mock).mockResolvedValue(null);
      await expect(service.findOne(ORG_ID, 'nope')).rejects.toThrow(
        NotFoundException,
      );
    });
  });
});
