import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service';

export type RoutedTarget =
  | 'lead'
  | 'client'
  | 'invoice'
  | 'estimate'
  | 'ticket'
  | 'unmatched';

export interface RoutingInput {
  organizationId: string;
  fromEmail: string;
  subject: string;
  inReplyTo: string | null;
  referenceIds: string[];
}

export interface RoutingResult {
  routedTo: RoutedTarget;
  routedToId: string | null;
  /** Free-text reason for debugging — not persisted, just logged. */
  reason: string;
}

/**
 * Decides which CRM record an inbound message belongs to.
 *
 * Order (first match wins):
 *   1. Reply tracking — In-Reply-To / References header references one of
 *      our previously-sent OutboundMessage rows. We inherit the routing
 *      of that outbound mail.
 *   2. Existing ticket flagged in the subject as `[#<ticketId>]` (the
 *      tickets module's existing convention). Stays in inbox AND in the
 *      ticket — see deconfliction note in inbox.module.ts.
 *   3. Direct email match against:
 *        a. Lead.email
 *        b. Client.users (contacts where type='contact').email,
 *           then Client.contacts → Client itself
 *      For invoices/estimates we only attach if subject contains the
 *      doc number; otherwise stick at client level.
 *   4. Default → 'unmatched'.
 *
 * Every lookup is scoped via PrismaService.withOrganization() — the
 * router NEVER cross-tenants.
 */
@Injectable()
export class InboxRouterService {
  private readonly logger = new Logger(InboxRouterService.name);

  constructor(private readonly prisma: PrismaService) {}

  async route(input: RoutingInput): Promise<RoutingResult> {
    const { organizationId, fromEmail, subject } = input;
    const fromNorm = (fromEmail || '').toLowerCase().trim();
    const refs = [
      ...(input.inReplyTo ? [input.inReplyTo] : []),
      ...input.referenceIds,
    ]
      .map((r) => (r || '').trim())
      .filter((r) => r.length > 0);

    return this.prisma.withOrganization(organizationId, async (tx: any) => {
      // ── 1. Reply tracking via OutboundMessage ─────────────────────
      if (refs.length > 0) {
        const out = await tx.outboundMessage.findFirst({
          where: { organizationId, messageId: { in: refs } },
          orderBy: { sentAt: 'desc' },
        });
        if (out) {
          return {
            routedTo: out.routedTo as RoutedTarget,
            routedToId: out.routedToId,
            reason: `reply-to outbound ${out.messageId} (${out.routedTo}:${out.routedToId})`,
          };
        }
      }

      // ── 2. Subject-tagged ticket: [#<id>] ─────────────────────────
      const tagMatch = (subject || '').match(/\[#([a-zA-Z0-9_-]+)\]/);
      if (tagMatch?.[1]) {
        const ticket = await tx.ticket.findFirst({
          where: { id: tagMatch[1], organizationId },
          select: { id: true },
        });
        if (ticket) {
          return {
            routedTo: 'ticket',
            routedToId: ticket.id,
            reason: `subject tag [#${ticket.id}]`,
          };
        }
      }

      if (!fromNorm) {
        return { routedTo: 'unmatched', routedToId: null, reason: 'empty from' };
      }

      // ── 3a. Lead by email ─────────────────────────────────────────
      const lead = await tx.lead.findFirst({
        where: {
          organizationId,
          email: { equals: fromNorm, mode: 'insensitive' },
        },
        select: { id: true },
      });
      if (lead) {
        return {
          routedTo: 'lead',
          routedToId: lead.id,
          reason: `lead email match ${fromNorm}`,
        };
      }

      // ── 3b. Client via contact (User type='contact') ──────────────
      // The schema has no `client_contacts` table; contacts live in `users`
      // with type='contact' and a clientId pointer.
      const contact = await tx.user.findFirst({
        where: {
          organizationId,
          type: 'contact',
          email: { equals: fromNorm, mode: 'insensitive' },
          clientId: { not: null },
        },
        select: { clientId: true },
      });
      const clientId = contact?.clientId ?? null;

      // ── 3c. Invoice / Estimate by doc number in subject ───────────
      if (clientId) {
        const subj = subject || '';
        const invMatch = subj.match(/\b(INV-[A-Z0-9-]+|\d{4,})\b/i);
        const estMatch = subj.match(/\b(EST-[A-Z0-9-]+)\b/i);

        if (invMatch) {
          const invoice = await tx.invoice.findFirst({
            where: {
              organizationId,
              clientId,
              number: { contains: invMatch[1], mode: 'insensitive' },
            },
            select: { id: true, number: true },
          });
          if (invoice) {
            return {
              routedTo: 'invoice',
              routedToId: invoice.id,
              reason: `invoice ${invoice.number} matched in subject`,
            };
          }
        }
        if (estMatch) {
          const estimate = await tx.estimate.findFirst({
            where: {
              organizationId,
              clientId,
              number: { contains: estMatch[1], mode: 'insensitive' },
            },
            select: { id: true, number: true },
          });
          if (estimate) {
            return {
              routedTo: 'estimate',
              routedToId: estimate.id,
              reason: `estimate ${estimate.number} matched in subject`,
            };
          }
        }

        return {
          routedTo: 'client',
          routedToId: clientId,
          reason: `client contact email match ${fromNorm}`,
        };
      }

      // ── 3d. Default → unmatched ───────────────────────────────────
      return {
        routedTo: 'unmatched',
        routedToId: null,
        reason: `no match for ${fromNorm}`,
      };
    });
  }

  /**
   * Validate that a (routedTo, routedToId) pair refers to a real record
   * in this org. Used by the manual re-route endpoint.
   */
  async validateTarget(
    orgId: string,
    routedTo: RoutedTarget,
    routedToId: string | null,
  ): Promise<boolean> {
    if (routedTo === 'unmatched') return routedToId === null;
    if (!routedToId) return false;

    return this.prisma.withOrganization(orgId, async (tx: any) => {
      switch (routedTo) {
        case 'lead':
          return !!(await tx.lead.findFirst({
            where: { id: routedToId, organizationId: orgId },
            select: { id: true },
          }));
        case 'client':
          return !!(await tx.client.findFirst({
            where: { id: routedToId, organizationId: orgId },
            select: { id: true },
          }));
        case 'invoice':
          return !!(await tx.invoice.findFirst({
            where: { id: routedToId, organizationId: orgId },
            select: { id: true },
          }));
        case 'estimate':
          return !!(await tx.estimate.findFirst({
            where: { id: routedToId, organizationId: orgId },
            select: { id: true },
          }));
        case 'ticket':
          return !!(await tx.ticket.findFirst({
            where: { id: routedToId, organizationId: orgId },
            select: { id: true },
          }));
        default:
          return false;
      }
    });
  }
}
