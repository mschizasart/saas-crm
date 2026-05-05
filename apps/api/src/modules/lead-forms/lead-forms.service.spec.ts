import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { createMock, DeepMocked } from '@golevelup/ts-jest';
import { LeadFormsService } from './lead-forms.service';
import { PrismaService } from '../../database/prisma.service';
import { EmailsService } from '../emails/emails.service';

describe('LeadFormsService', () => {
  let service: LeadFormsService;
  let prisma: DeepMocked<PrismaService>;
  let events: DeepMocked<EventEmitter2>;
  let emails: DeepMocked<EmailsService>;

  const ORG_ID = 'org_abc';

  beforeEach(() => {
    prisma = createMock<PrismaService>();
    events = createMock<EventEmitter2>();
    emails = createMock<EmailsService>();
    service = new LeadFormsService(prisma, events, emails);
  });

  describe('create', () => {
    it('rejects when no fields are provided', async () => {
      await expect(
        service.create(ORG_ID, { slug: 's', name: 'N', title: 'T', fields: [] }),
      ).rejects.toThrow(/At least one field/);
    });

    it('rejects duplicate field keys', async () => {
      await expect(
        service.create(ORG_ID, {
          slug: 's',
          name: 'N',
          title: 'T',
          fields: [
            { key: 'email', label: 'A', type: 'email' },
            { key: 'email', label: 'B', type: 'text' },
          ],
        }),
      ).rejects.toThrow(/Duplicate field key/);
    });

    it('rejects a select field with no options', async () => {
      await expect(
        service.create(ORG_ID, {
          slug: 's',
          name: 'N',
          title: 'T',
          fields: [{ key: 'plan', label: 'Plan', type: 'select' }],
        }),
      ).rejects.toThrow(/at least one option/);
    });

    it('rejects when the slug already exists for the org', async () => {
      (prisma.leadForm.findFirst as jest.Mock).mockResolvedValue({ id: 'f1' });
      await expect(
        service.create(ORG_ID, {
          slug: 'contact',
          name: 'N',
          title: 'T',
          fields: [{ key: 'email', label: 'Email', type: 'email' }],
        }),
      ).rejects.toThrow(ConflictException);
    });
  });

  describe('submit', () => {
    const ORG = { id: ORG_ID, slug: 'acme', name: 'Acme' };
    const FORM = {
      id: 'form_1',
      slug: 'contact',
      name: 'Contact us',
      fields: [
        { key: 'email', label: 'Email', type: 'email', required: true },
        { key: 'name', label: 'Full Name', type: 'text', required: true },
        { key: 'plan', label: 'Plan', type: 'select', options: ['Free', 'Pro'] },
        { key: 'message', label: 'Message', type: 'textarea' },
      ],
      isActive: true,
      assignToUserId: null,
      notifyEmail: null,
      redirectUrl: null,
    };

    beforeEach(() => {
      // resolvePublicForm: org first, then form
      (prisma.organization.findFirst as jest.Mock).mockResolvedValue(ORG);
      (prisma.leadForm.findFirst as jest.Mock).mockResolvedValue(FORM);
      (prisma.leadStatus.findFirst as jest.Mock).mockResolvedValue({
        id: 'status_default',
      });
      (prisma.leadSource.findFirst as jest.Mock).mockResolvedValue({
        id: 'source_existing',
      });
      (prisma.lead.create as jest.Mock).mockResolvedValue({ id: 'lead_1' });
      (prisma.leadForm.update as jest.Mock).mockResolvedValue({});
    });

    afterEach(() => {
      jest.useRealTimers();
    });

    it('rejects on missing required field', async () => {
      await expect(
        service.submit('acme', 'contact', { email: 'a@b.com' }, '1.1.1.1'),
      ).rejects.toThrow(/required/);
    });

    it('rejects on invalid email format', async () => {
      await expect(
        service.submit(
          'acme',
          'contact',
          { email: 'not-an-email', name: 'A' },
          '1.1.1.2',
        ),
      ).rejects.toThrow(/valid email/);
    });

    it('rejects on a select value not in the option list', async () => {
      await expect(
        service.submit(
          'acme',
          'contact',
          { email: 'a@b.com', name: 'A', plan: 'Enterprise' },
          '1.1.1.3',
        ),
      ).rejects.toThrow(/must be one of/);
    });

    it('silently accepts a honeypot submission and does NOT create a lead', async () => {
      const r = await service.submit(
        'acme',
        'contact',
        { email: 'a@b.com', name: 'A', website: 'http://spammy.com' },
        '1.1.1.4',
      );
      expect(r).toEqual({ ok: true });
      expect(prisma.lead.create).not.toHaveBeenCalled();
    });

    it('rate-limits a second submission from the same IP/form within the window', async () => {
      await service.submit(
        'acme',
        'contact',
        { email: 'a@b.com', name: 'A' },
        '9.9.9.9',
      );
      await expect(
        service.submit(
          'acme',
          'contact',
          { email: 'b@b.com', name: 'B' },
          '9.9.9.9',
        ),
      ).rejects.toThrow(/Too many submissions/);
    });

    it('creates a lead, increments submissionCount, and emits lead.created', async () => {
      const r = await service.submit(
        'acme',
        'contact',
        { email: 'new@cust.com', name: 'New Cust', message: 'Hello!' },
        '1.2.3.4',
      );

      expect(prisma.lead.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            organizationId: ORG_ID,
            email: 'new@cust.com',
            name: 'New Cust',
            description: 'Hello!',
            statusId: 'status_default',
            sourceId: 'source_existing',
          }),
        }),
      );
      expect(prisma.leadForm.update).toHaveBeenCalledWith({
        where: { id: 'form_1' },
        data: { submissionCount: { increment: 1 } },
      });
      expect(events.emit).toHaveBeenCalledWith(
        'lead.created',
        expect.objectContaining({
          orgId: ORG_ID,
          createdBy: 'web_form',
          source: 'lead_form',
          formId: 'form_1',
        }),
      );
      expect(r).toEqual({ ok: true, redirectUrl: undefined });
    });

    it('queues the notify email when the form has notifyEmail configured', async () => {
      (prisma.leadForm.findFirst as jest.Mock).mockResolvedValue({
        ...FORM,
        notifyEmail: 'sales@acme.com',
      });

      await service.submit(
        'acme',
        'contact',
        { email: 'lead@cust.com', name: 'A New Lead' },
        '5.5.5.5',
      );

      expect(emails.queue).toHaveBeenCalledWith(
        expect.objectContaining({
          to: 'sales@acme.com',
          subject: expect.stringContaining('A New Lead'),
        }),
      );
    });

    it('throws NotFoundException when org/form is unknown', async () => {
      (prisma.organization.findFirst as jest.Mock).mockResolvedValue(null);
      await expect(
        service.submit(
          'unknown-org',
          'contact',
          { email: 'a@b.com', name: 'A' },
          '7.7.7.7',
        ),
      ).rejects.toThrow(NotFoundException);
    });

    it('throws NotFoundException when the form is inactive', async () => {
      (prisma.leadForm.findFirst as jest.Mock).mockResolvedValue(null);
      await expect(
        service.submit(
          'acme',
          'contact',
          { email: 'a@b.com', name: 'A' },
          '8.8.8.8',
        ),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('getPublic', () => {
    it('omits internal fields like notifyEmail and assignToUserId', async () => {
      (prisma.organization.findFirst as jest.Mock).mockResolvedValue({
        id: ORG_ID,
        slug: 'acme',
        name: 'Acme',
      });
      (prisma.leadForm.findFirst as jest.Mock).mockResolvedValue({
        id: 'f1',
        name: 'Contact',
        title: 'Contact us',
        description: null,
        fields: [{ key: 'email', label: 'Email', type: 'email' }],
        captchaEnabled: true,
        redirectUrl: null,
        notifyEmail: 'leak@x.com',
        assignToUserId: 'user_secret',
        isActive: true,
      });

      const r: any = await service.getPublic('acme', 'contact');
      expect(r.notifyEmail).toBeUndefined();
      expect(r.assignToUserId).toBeUndefined();
      expect(r.fields).toBeDefined();
    });
  });
});
