/**
 * The closed set of event names a tenant may subscribe a webhook to.
 *
 * Adding a new event is a TWO-STEP operation:
 *   1. Append it here.
 *   2. Call `WebhookDispatcherService.emit(orgId, '<event>', payload)`
 *      from the relevant service AFTER the write commits.
 *
 * The DTO validator (CreateWebhookDto / UpdateWebhookDto) rejects any
 * `events` array that contains a value outside this list, so subscriptions
 * can never go stale relative to what the dispatcher actually emits.
 */
export const ALLOWED_EVENTS = [
  'client.created',
  'client.updated',
  'lead.created',
  'lead.updated',
  'lead.converted',
  'opportunity.created',
  'opportunity.stage_changed',
  'invoice.created',
  'invoice.sent',
  'invoice.paid',
  'ticket.created',
  'ticket.resolved',
] as const;

export type AllowedEvent = (typeof ALLOWED_EVENTS)[number];

export function isAllowedEvent(value: unknown): value is AllowedEvent {
  return typeof value === 'string' && (ALLOWED_EVENTS as readonly string[]).includes(value);
}
