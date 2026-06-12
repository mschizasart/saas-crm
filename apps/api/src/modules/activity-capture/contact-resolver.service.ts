import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service';

/**
 * Resolved-contact shape for the capture pipeline (Wave H2).
 *
 * `relatedToType` picks the polymorphic pin for the resulting
 * Activity row. Matching a portal contact (User type='contact') gives
 * BOTH `contactId` and the parent `clientId` so the timeline can
 * render "John (Acme) <john@acme.com>"; matching a Lead gives
 * `leadId` only.
 */
export interface ResolvedContact {
  relatedToType: 'client' | 'lead' | 'contact';
  relatedToId: string;
  /** The matched User.id when the hit was a portal contact. */
  contactId?: string;
  /** When the matched contact belongs to a client, the parent id. */
  clientId?: string;
  /** When the match was a Lead (no contact pivot). */
  leadId?: string;
}

/**
 * Maps an email address / phone number to a CRM record (Client via
 * its portal Contact, or Lead). The org-scope is non-negotiable: if
 * we skipped it, an inbound mail from john@example.com would attach
 * to the WRONG tenant's contact whenever two customers share an
 * email address. That's a cross-tenant leak by way of capture.
 *
 * "Contact" in this codebase is a `User` row with `type='contact'`
 * and a `clientId` — there is no standalone Contact model. The
 * resolver looks at portal-contacts first (richer pin) and falls
 * back to Leads.
 */
@Injectable()
export class ContactResolverService {
  private readonly logger = new Logger(ContactResolverService.name);

  constructor(private prisma: PrismaService) {}

  /**
   * Look up a CRM record by email, scoped to `orgId`. Returns null
   * when no match — the capture pipeline writes a log row with
   * reason='no_matching_contact' in that case so ops can see "this
   * inbound mail had no home".
   */
  async resolveByEmail(
    orgId: string,
    email: string,
  ): Promise<ResolvedContact | null> {
    const normalized = (email ?? '').trim().toLowerCase();
    if (!normalized) return null;

    return this.prisma.withOrganization(orgId, async (tx) => {
      // 1. Portal-contact match (User type='contact'). This is the
      //    richer hit — we pin to the contact AND to its parent Client
      //    so both show on the timeline.
      const contact = await tx.user.findFirst({
        where: {
          organizationId: orgId,
          type: 'contact',
          // Case-insensitive — RFC 5321 says the local part SHOULD be
          // case-sensitive but virtually no provider treats it that
          // way, and CRM users routinely type the wrong case.
          email: { equals: normalized, mode: 'insensitive' },
        },
        select: { id: true, clientId: true },
        orderBy: { createdAt: 'desc' },
      });
      if (contact) {
        if (contact.clientId) {
          return {
            relatedToType: 'client',
            relatedToId: contact.clientId,
            contactId: contact.id,
            clientId: contact.clientId,
          };
        }
        // Orphaned portal contact with no parent client — rare but
        // possible during import. Pin to the contact directly.
        return {
          relatedToType: 'contact',
          relatedToId: contact.id,
          contactId: contact.id,
        };
      }

      // 2. Lead match.
      const lead = await tx.lead.findFirst({
        where: {
          organizationId: orgId,
          email: { equals: normalized, mode: 'insensitive' },
        },
        select: { id: true },
        orderBy: { createdAt: 'desc' },
      });
      if (lead) {
        return {
          relatedToType: 'lead',
          relatedToId: lead.id,
          leadId: lead.id,
        };
      }

      return null;
    });
  }

  /**
   * Look up a CRM record by phone, scoped to `orgId`. Strips
   * formatting to a digits-only suffix so '+1 (415) 555-1234' and
   * '14155551234' match. Mirrors the existing SmsConfigService
   * `matchEntityByPhone` heuristic (last 8 digits) — drifting from
   * that would let an inbound SMS attach to a different record than
   * the legacy attach.
   */
  async resolveByPhone(
    orgId: string,
    phone: string,
  ): Promise<ResolvedContact | null> {
    const digits = (phone ?? '').replace(/[^0-9]/g, '');
    if (digits.length < 7) return null;
    // Last 8 digits — tolerates country-code prefix variations.
    const suffix = digits.slice(-8);

    return this.prisma.withOrganization(orgId, async (tx) => {
      // 1. Portal-contact phone match.
      const contact = await tx.user.findFirst({
        where: {
          organizationId: orgId,
          type: 'contact',
          OR: [
            { phone: { contains: suffix } },
            { phoneMobile: { contains: suffix } },
          ],
        },
        select: { id: true, clientId: true },
        orderBy: { createdAt: 'desc' },
      });
      if (contact) {
        if (contact.clientId) {
          return {
            relatedToType: 'client',
            relatedToId: contact.clientId,
            contactId: contact.id,
            clientId: contact.clientId,
          };
        }
        return {
          relatedToType: 'contact',
          relatedToId: contact.id,
          contactId: contact.id,
        };
      }

      // 2. Client.phone match (direct, not via contact).
      const client = await tx.client.findFirst({
        where: {
          organizationId: orgId,
          phone: { contains: suffix },
        },
        select: { id: true },
        orderBy: { createdAt: 'desc' },
      });
      if (client) {
        return {
          relatedToType: 'client',
          relatedToId: client.id,
          clientId: client.id,
        };
      }

      // 3. Lead phone match.
      const lead = await tx.lead.findFirst({
        where: {
          organizationId: orgId,
          phone: { contains: suffix },
        },
        select: { id: true },
        orderBy: { createdAt: 'desc' },
      });
      if (lead) {
        return {
          relatedToType: 'lead',
          relatedToId: lead.id,
          leadId: lead.id,
        };
      }

      return null;
    });
  }

  /**
   * True when `email` belongs to an active staff user in this org.
   * Used by the email capture pipeline to enforce the
   * `captureInternalEmails=false` carve-out so staff↔staff mail
   * doesn't pollute customer timelines.
   */
  async isInternalStaffEmail(orgId: string, email: string): Promise<boolean> {
    const normalized = (email ?? '').trim().toLowerCase();
    if (!normalized) return false;

    return this.prisma.withOrganization(orgId, async (tx) => {
      const u = await tx.user.findFirst({
        where: {
          organizationId: orgId,
          type: 'staff',
          active: true,
          email: { equals: normalized, mode: 'insensitive' },
        },
        select: { id: true },
      });
      return !!u;
    });
  }
}
