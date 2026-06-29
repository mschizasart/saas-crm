import { ALLOWED_EVENTS, AllowedEvent } from '../public-api/webhook-events';

/**
 * Static sample payloads for each webhook event.
 *
 * Zapier/Make use these (via GET /integration/events/:event/sample) to let
 * a user map fields when building a trigger, WITHOUT requiring a real event
 * to have fired yet. The shapes here mirror the `payload` a real delivery
 * carries; values are illustrative placeholders only.
 *
 * Keep keyed exactly by ALLOWED_EVENTS — a missing entry falls back to a
 * generic sample so the endpoint never 500s on a valid-but-unsampled event.
 */
const now = '2026-06-29T12:00:00.000Z';

export const EVENT_SAMPLES: Record<AllowedEvent, Record<string, any>> = {
  'client.created': {
    id: 'clnt_1a2b3c4d',
    company: 'Acme Corporation',
    email: 'billing@acme.example',
    phone: '+1 555 0100',
    website: 'https://acme.example',
    city: 'San Francisco',
    country: 'US',
    vat: 'US123456789',
    createdAt: now,
  },
  'client.updated': {
    id: 'clnt_1a2b3c4d',
    company: 'Acme Corporation',
    email: 'billing@acme.example',
    phone: '+1 555 0199',
    city: 'San Francisco',
    country: 'US',
    updatedAt: now,
  },
  'lead.created': {
    id: 'lead_9f8e7d6c',
    name: 'Jane Doe',
    email: 'jane.doe@example.com',
    phone: '+1 555 0123',
    company: 'Globex',
    status: 'new',
    source: 'Website',
    value: 5000,
    createdAt: now,
  },
  'lead.updated': {
    id: 'lead_9f8e7d6c',
    name: 'Jane Doe',
    email: 'jane.doe@example.com',
    company: 'Globex',
    status: 'qualified',
    value: 7500,
    updatedAt: now,
  },
  'lead.converted': {
    id: 'lead_9f8e7d6c',
    name: 'Jane Doe',
    convertedToClientId: 'clnt_5e6f7a8b',
    convertedAt: now,
  },
  'opportunity.created': {
    id: 'oppt_2c3d4e5f',
    name: 'Globex — Annual License',
    amount: 24000,
    currency: 'USD',
    stage: 'Discovery',
    ownerId: 'user_abc123',
    clientId: 'clnt_5e6f7a8b',
    closeDate: '2026-09-30',
    createdAt: now,
  },
  'opportunity.stage_changed': {
    id: 'oppt_2c3d4e5f',
    name: 'Globex — Annual License',
    previousStage: 'Discovery',
    newStage: 'Proposal',
    amount: 24000,
    currency: 'USD',
    changedAt: now,
  },
  'invoice.created': {
    id: 'inv_3d4e5f6a',
    number: 'INV-2026-0042',
    clientId: 'clnt_5e6f7a8b',
    status: 'draft',
    total: 1200.0,
    currency: 'USD',
    date: '2026-06-29',
    dueDate: '2026-07-29',
    createdAt: now,
  },
  'invoice.sent': {
    id: 'inv_3d4e5f6a',
    number: 'INV-2026-0042',
    clientId: 'clnt_5e6f7a8b',
    status: 'sent',
    total: 1200.0,
    currency: 'USD',
    sentAt: now,
  },
  'invoice.paid': {
    id: 'inv_3d4e5f6a',
    number: 'INV-2026-0042',
    clientId: 'clnt_5e6f7a8b',
    status: 'paid',
    total: 1200.0,
    amountPaid: 1200.0,
    currency: 'USD',
    paidAt: now,
  },
  'ticket.created': {
    id: 'tkt_4e5f6a7b',
    subject: 'Cannot log in to portal',
    status: 'open',
    priority: 'high',
    clientId: 'clnt_5e6f7a8b',
    createdAt: now,
  },
  'ticket.resolved': {
    id: 'tkt_4e5f6a7b',
    subject: 'Cannot log in to portal',
    status: 'resolved',
    priority: 'high',
    clientId: 'clnt_5e6f7a8b',
    resolvedAt: now,
  },
};

/** Generic fallback so the endpoint never 500s on a valid-but-unsampled event. */
function genericSample(event: string): Record<string, any> {
  return {
    event,
    id: 'sample_0000',
    organizationId: 'org_0000',
    occurredAt: now,
    data: {},
  };
}

/** Returns a sample payload for the event, or null if the event is unknown. */
export function getEventSample(event: string): Record<string, any> | null {
  if (!(ALLOWED_EVENTS as readonly string[]).includes(event)) return null;
  return EVENT_SAMPLES[event as AllowedEvent] ?? genericSample(event);
}
