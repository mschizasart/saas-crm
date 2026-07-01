import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service';
import {
  ContactResolverService,
  ResolvedContact,
} from '../activity-capture/contact-resolver.service';
import { LeadsService } from '../leads/leads.service';
import { ClientsService } from '../clients/clients.service';
import {
  AddinContextDto,
  AddinLogEmailDto,
  AddinCreateLeadDto,
  AddinCreateContactDto,
} from './addin.dto';

/** Body cap mirrors the capture pipeline / calls timeline writer. */
const BODY_TRUNCATE = 4000;

/**
 * Backend for the Outlook (Office.js) taskpane add-in. Everything is
 * strictly org-scoped: the org comes from the caller's JWT
 * (request.organization → org.id in the controller), and every read /
 * write is funnelled through org-scoped services or
 * `prisma.withOrganization`. There is NO way for the add-in to reach
 * another tenant's data because `ContactResolverService.resolveByEmail`
 * filters on `organizationId` in every query (confirmed).
 */
@Injectable()
export class AddinService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly resolver: ContactResolverService,
    private readonly leads: LeadsService,
    private readonly clients: ClientsService,
  ) {}

  /**
   * Resolve the CRM context for an email's sender. Returns the matched
   * record (lead/client) plus the last 10 timeline activities, or
   * `{ found:false, canCreateLead:true }` when unmatched.
   */
  async getContext(orgId: string, dto: AddinContextDto) {
    const resolved = await this.resolver.resolveByEmail(orgId, dto.senderEmail);
    if (!resolved) {
      return { found: false as const, canCreateLead: true as const };
    }

    const record = await this.loadRecord(orgId, resolved);
    const recentActivity = await this.loadRecentActivity(orgId, resolved);

    return {
      found: true as const,
      type: resolved.relatedToType,
      relatedToId: resolved.relatedToId,
      contactId: resolved.contactId ?? null,
      record,
      recentActivity,
    };
  }

  /**
   * Log an email to the CRM timeline. When relatedToType/Id aren't
   * supplied the sender email is resolved (404 when unmatched). Mirrors
   * calls.service.writeTimelineActivity for the Activity row shape.
   */
  async logEmail(orgId: string, dto: AddinLogEmailDto) {
    let relatedToType = dto.relatedToType;
    let relatedToId = dto.relatedToId;
    let contactId: string | undefined;

    if (!relatedToType || !relatedToId) {
      if (!dto.senderEmail) {
        throw new NotFoundException(
          'Provide relatedToType + relatedToId, or a senderEmail to resolve.',
        );
      }
      const resolved = await this.resolver.resolveByEmail(
        orgId,
        dto.senderEmail,
      );
      if (!resolved) {
        throw new NotFoundException(
          'No CRM record matches this sender — create a lead first.',
        );
      }
      relatedToType = resolved.relatedToType;
      relatedToId = resolved.relatedToId;
      contactId = resolved.contactId;
    } else {
      // Client supplied relatedToType/Id directly — verify the record exists
      // in the caller's org before pinning an Activity to it (no orphan/foreign
      // pins). Reads are org-scoped, so an out-of-org id simply 404s.
      await this.assertRelatedRecord(orgId, relatedToType, relatedToId);
    }

    const direction = dto.direction ?? 'inbound';
    const occurredAt = dto.occurredAt ? new Date(dto.occurredAt) : new Date();

    return this.prisma.withOrganization(orgId, (tx) =>
      tx.activity.create({
        data: {
          organizationId: orgId,
          type: 'email',
          channel: 'email',
          direction,
          subject: dto.subject.slice(0, 500),
          body: dto.body ? dto.body.slice(0, BODY_TRUNCATE) : null,
          relatedToType: relatedToType!,
          relatedToId: relatedToId!,
          contactId: contactId ?? null,
          occurredAt,
        },
      }),
    );
  }

  /**
   * Verify a client-supplied (relatedToType, relatedToId) points to a real
   * record in the caller's org. Throws NotFoundException otherwise so the
   * add-in can't create timeline entries pinned to foreign/nonexistent ids.
   */
  private async assertRelatedRecord(
    orgId: string,
    relatedToType: string,
    relatedToId: string,
  ) {
    const exists = await this.prisma.withOrganization(orgId, async (tx) => {
      const where = { id: relatedToId, organizationId: orgId };
      if (relatedToType === 'lead') return tx.lead.findFirst({ where });
      if (relatedToType === 'client') return tx.client.findFirst({ where });
      if (relatedToType === 'contact')
        return tx.user.findFirst({ where: { ...where, type: 'contact' } });
      return null;
    });
    if (!exists) {
      throw new NotFoundException(
        `No ${relatedToType} ${relatedToId} in this organization.`,
      );
    }
  }

  /** Create a lead from the add-in, tagging its source. */
  async createLead(orgId: string, userId: string, dto: AddinCreateLeadDto) {
    return this.leads.create(
      orgId,
      {
        name: dto.name,
        email: dto.email,
        phone: dto.phone,
        company: dto.company,
        source: 'email_addin',
      },
      userId,
    );
  }

  /** Create a portal contact under an existing client. */
  async createContact(orgId: string, dto: AddinCreateContactDto) {
    return this.clients.createContact(orgId, dto.clientId, {
      email: dto.email,
      firstName: dto.firstName,
      lastName: dto.lastName,
      phone: dto.phone,
    });
  }

  // ─── helpers ────────────────────────────────────────────────

  /**
   * Load the summary of the matched record. For a client pin we return
   * the client; for a lead pin the lead; for an orphan-contact pin we
   * return a minimal contact summary from the User row.
   */
  private async loadRecord(orgId: string, resolved: ResolvedContact) {
    if (resolved.relatedToType === 'lead') {
      const lead: any = await this.leads.findOne(orgId, resolved.relatedToId);
      return {
        id: lead.id,
        name: lead.name,
        company: lead.company ?? null,
        email: lead.email ?? null,
        phone: lead.phone ?? null,
      };
    }

    if (resolved.relatedToType === 'client') {
      const client: any = await this.clients.findOne(orgId, resolved.relatedToId);
      // Client has no top-level `name`/`email` — the display name is
      // `company` and the email lives on the primary/first portal contact.
      const primaryContact =
        (client.contacts ?? []).find((c: any) => c.isPrimary) ??
        (client.contacts ?? [])[0] ??
        null;
      return {
        id: client.id,
        name: client.company,
        company: client.company,
        email: primaryContact?.email ?? null,
        phone: client.phone ?? primaryContact?.phone ?? null,
      };
    }

    // Orphaned portal contact (User type='contact' with no clientId).
    const contact = await this.prisma.withOrganization(orgId, (tx) =>
      tx.user.findFirst({
        where: { id: resolved.relatedToId, organizationId: orgId },
        select: {
          id: true,
          firstName: true,
          lastName: true,
          email: true,
          phone: true,
        },
      }),
    );
    return {
      id: resolved.relatedToId,
      name: contact
        ? `${contact.firstName ?? ''} ${contact.lastName ?? ''}`.trim()
        : null,
      company: null,
      email: contact?.email ?? null,
      phone: contact?.phone ?? null,
    };
  }

  /** Last 10 timeline activities for the matched record, org-scoped. */
  private async loadRecentActivity(orgId: string, resolved: ResolvedContact) {
    const rows = await this.prisma.withOrganization(orgId, (tx) =>
      tx.activity.findMany({
        where: {
          organizationId: orgId,
          relatedToType: resolved.relatedToType,
          relatedToId: resolved.relatedToId,
        },
        orderBy: { occurredAt: 'desc' },
        take: 10,
        select: {
          type: true,
          direction: true,
          subject: true,
          occurredAt: true,
        },
      }),
    );
    return rows;
  }
}
