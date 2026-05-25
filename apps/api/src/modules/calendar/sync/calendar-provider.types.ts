/**
 * Shared types for the calendar-sync OAuth + provider API layer.
 *
 * These intentionally mirror modules/email-settings/oauth/oauth.types.ts so a
 * future refactor can hoist the common bits, but calendar sync needs extra
 * surface (list/create/update/delete remote events) that email doesn't, so it
 * lives in its own provider services with their own scopes and redirect URI.
 */

export type CalendarProvider = 'google' | 'microsoft';

export interface CalendarTokenResponse {
  accessToken: string;
  /** Present on first consent (Google: access_type=offline+prompt=consent;
   *  Microsoft: offline_access). Microsoft rotates it on every refresh. */
  refreshToken?: string;
  /** Seconds until the access token expires. */
  expiresIn: number;
  /** Consenting account email — resolved from id_token / Graph /me. */
  email?: string;
  scope?: string;
}

/** A provider-agnostic representation of a calendar event for sync. */
export interface RemoteEvent {
  /** Remote event id. */
  id: string;
  title: string;
  description?: string | null;
  /** ISO 8601 start. For all-day events this is a date (no time). */
  start: string;
  /** ISO 8601 end (optional). */
  end?: string | null;
  allDay: boolean;
  /** Remote last-modified timestamp (ISO), used for last-writer-wins. */
  updatedAt?: string | null;
  /** True if the remote considers this event cancelled/deleted. */
  cancelled?: boolean;
}

/** Fields we push from a local event to the remote calendar. */
export interface LocalEventInput {
  title: string;
  description?: string | null;
  start: string; // ISO
  end?: string | null; // ISO
  allDay: boolean;
}

export interface RemotePullResult {
  events: RemoteEvent[];
  /** Provider opaque cursor to resume next time (Graph delta link). */
  nextCursor?: string | null;
}

/**
 * Per-provider client. Auth methods build the consent URL + swap/refresh
 * tokens (scoped to calendar, distinct redirect URI). Event methods take a
 * fresh access token and talk to the provider's calendar API.
 */
export interface CalendarProviderClient {
  readonly providerName: CalendarProvider;
  isConfigured(): boolean;
  getAuthUrl(state: string): string;
  exchangeCode(code: string): Promise<CalendarTokenResponse>;
  refreshAccessToken(refreshToken: string): Promise<CalendarTokenResponse>;

  /** Pull remote events changed since `since` (ISO). `cap` limits results. */
  listEvents(
    accessToken: string,
    calendarId: string | null,
    since: Date | null,
    cap: number,
  ): Promise<RemotePullResult>;

  /** Create a remote event; returns its new remote id. */
  createEvent(
    accessToken: string,
    calendarId: string | null,
    input: LocalEventInput,
  ): Promise<string>;

  /** Update a remote event in place. */
  updateEvent(
    accessToken: string,
    calendarId: string | null,
    externalId: string,
    input: LocalEventInput,
  ): Promise<void>;
}
