import { Injectable, Logger, BadRequestException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  CalendarProvider,
  CalendarProviderClient,
  CalendarTokenResponse,
  LocalEventInput,
  RemoteEvent,
  RemotePullResult,
} from './calendar-provider.types';

/**
 * Google Calendar OAuth 2.0 + Events API client.
 *
 * Reuses the same GOOGLE_OAUTH_CLIENT_ID / _SECRET as the email integration
 * (modules/email-settings/oauth/google-oauth.service.ts) but with the
 * Calendar scope and a DISTINCT redirect URI (GOOGLE_CALENDAR_REDIRECT_URI),
 * because the Google app registration ties each redirect URI to the flow that
 * uses it. We fall back to deriving the calendar redirect URI from the email
 * one so a single env var is enough in simple setups.
 *
 * Scope: https://www.googleapis.com/auth/calendar (read/write events).
 *
 * Raw `fetch` only — no `googleapis` SDK (keeps the bundle small, mirrors
 * the email service).
 */
@Injectable()
export class GoogleCalendarService implements CalendarProviderClient {
  private readonly logger = new Logger(GoogleCalendarService.name);
  readonly providerName: CalendarProvider = 'google';

  private static readonly AUTH_URL =
    'https://accounts.google.com/o/oauth2/v2/auth';
  private static readonly TOKEN_URL = 'https://oauth2.googleapis.com/token';
  private static readonly API_BASE =
    'https://www.googleapis.com/calendar/v3';
  private static readonly SCOPE = 'https://www.googleapis.com/auth/calendar';

  constructor(private config: ConfigService) {}

  private get clientId(): string | undefined {
    return this.config.get<string>('GOOGLE_OAUTH_CLIENT_ID');
  }
  private get clientSecret(): string | undefined {
    return this.config.get<string>('GOOGLE_OAUTH_CLIENT_SECRET');
  }
  /**
   * Calendar-sync has its OWN redirect URI distinct from email. Prefer the
   * dedicated env var; otherwise derive it from the email redirect URI by
   * swapping the path so admins only have to register one extra URI.
   */
  private get redirectUri(): string | undefined {
    const explicit = this.config.get<string>('GOOGLE_CALENDAR_REDIRECT_URI');
    if (explicit) return explicit;
    const emailUri = this.config.get<string>('GOOGLE_OAUTH_REDIRECT_URI');
    if (emailUri) {
      return emailUri.replace(
        /\/email-settings\/oauth\/google\/callback$/,
        '/calendar-sync/google/callback',
      );
    }
    return undefined;
  }

  isConfigured(): boolean {
    return !!(this.clientId && this.clientSecret && this.redirectUri);
  }

  private requireConfig() {
    if (!this.isConfigured()) {
      throw new BadRequestException(
        'Google OAuth is not configured on this server — set GOOGLE_OAUTH_CLIENT_ID, GOOGLE_OAUTH_CLIENT_SECRET and (optionally) GOOGLE_CALENDAR_REDIRECT_URI.',
      );
    }
  }

  getAuthUrl(state: string): string {
    this.requireConfig();
    const params = new URLSearchParams({
      client_id: this.clientId!,
      redirect_uri: this.redirectUri!,
      response_type: 'code',
      scope: [GoogleCalendarService.SCOPE, 'openid', 'email'].join(' '),
      access_type: 'offline',
      prompt: 'consent',
      include_granted_scopes: 'true',
      state,
    });
    return `${GoogleCalendarService.AUTH_URL}?${params.toString()}`;
  }

  async exchangeCode(code: string): Promise<CalendarTokenResponse> {
    this.requireConfig();
    const body = new URLSearchParams({
      code,
      client_id: this.clientId!,
      client_secret: this.clientSecret!,
      redirect_uri: this.redirectUri!,
      grant_type: 'authorization_code',
    });
    const res = await fetch(GoogleCalendarService.TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body,
    });
    if (!res.ok) {
      const txt = await res.text().catch(() => '');
      this.logger.warn(`Google token exchange failed: ${res.status} ${txt}`);
      throw new BadRequestException(
        `Google token exchange failed (${res.status})`,
      );
    }
    const json = (await res.json()) as {
      access_token: string;
      refresh_token?: string;
      expires_in: number;
      id_token?: string;
      scope?: string;
    };
    return {
      accessToken: json.access_token,
      refreshToken: json.refresh_token,
      expiresIn: json.expires_in,
      email: this.emailFromIdToken(json.id_token),
      scope: json.scope,
    };
  }

  async refreshAccessToken(refreshToken: string): Promise<CalendarTokenResponse> {
    this.requireConfig();
    const body = new URLSearchParams({
      client_id: this.clientId!,
      client_secret: this.clientSecret!,
      refresh_token: refreshToken,
      grant_type: 'refresh_token',
    });
    const res = await fetch(GoogleCalendarService.TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body,
    });
    if (!res.ok) {
      const txt = await res.text().catch(() => '');
      this.logger.warn(`Google refresh failed: ${res.status} ${txt}`);
      throw new BadRequestException(
        `Google token refresh failed (${res.status})`,
      );
    }
    const json = (await res.json()) as {
      access_token: string;
      expires_in: number;
      refresh_token?: string;
      scope?: string;
    };
    return {
      accessToken: json.access_token,
      // Google only re-emits a refresh_token when the old one was revoked.
      refreshToken: json.refresh_token,
      expiresIn: json.expires_in,
      scope: json.scope,
    };
  }

  // ── Events API ──────────────────────────────────────────────

  async listEvents(
    accessToken: string,
    calendarId: string | null,
    since: Date | null,
    cap: number,
  ): Promise<RemotePullResult> {
    const cal = encodeURIComponent(calendarId || 'primary');
    const params = new URLSearchParams({
      maxResults: String(Math.min(cap, 250)),
      singleEvents: 'true',
      orderBy: 'updated',
      showDeleted: 'true',
    });
    if (since) params.set('updatedMin', since.toISOString());
    const res = await fetch(
      `${GoogleCalendarService.API_BASE}/calendars/${cal}/events?${params.toString()}`,
      { headers: { Authorization: `Bearer ${accessToken}` } },
    );
    if (!res.ok) {
      const txt = await res.text().catch(() => '');
      throw new Error(`Google events list failed (${res.status}): ${txt}`);
    }
    const json = (await res.json()) as { items?: GoogleEvent[] };
    const events = (json.items ?? [])
      .map((e) => this.toRemoteEvent(e))
      .filter((e): e is RemoteEvent => e !== null);
    return { events };
  }

  async createEvent(
    accessToken: string,
    calendarId: string | null,
    input: LocalEventInput,
  ): Promise<string> {
    const cal = encodeURIComponent(calendarId || 'primary');
    const res = await fetch(
      `${GoogleCalendarService.API_BASE}/calendars/${cal}/events`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(this.toGoogleBody(input)),
      },
    );
    if (!res.ok) {
      const txt = await res.text().catch(() => '');
      throw new Error(`Google event create failed (${res.status}): ${txt}`);
    }
    const json = (await res.json()) as { id: string };
    return json.id;
  }

  async updateEvent(
    accessToken: string,
    calendarId: string | null,
    externalId: string,
    input: LocalEventInput,
  ): Promise<void> {
    const cal = encodeURIComponent(calendarId || 'primary');
    const res = await fetch(
      `${GoogleCalendarService.API_BASE}/calendars/${cal}/events/${encodeURIComponent(externalId)}`,
      {
        method: 'PATCH',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(this.toGoogleBody(input)),
      },
    );
    if (!res.ok) {
      const txt = await res.text().catch(() => '');
      throw new Error(`Google event update failed (${res.status}): ${txt}`);
    }
  }

  private toGoogleBody(input: LocalEventInput): Record<string, unknown> {
    if (input.allDay) {
      // All-day uses `date` (YYYY-MM-DD). Google's end date is exclusive,
      // so default to start+1 day when no end provided.
      const startDate = input.start.slice(0, 10);
      const endDate = (input.end ?? this.addDay(input.start)).slice(0, 10);
      return {
        summary: input.title,
        description: input.description ?? undefined,
        start: { date: startDate },
        end: { date: endDate },
      };
    }
    const end = input.end ?? input.start;
    return {
      summary: input.title,
      description: input.description ?? undefined,
      start: { dateTime: new Date(input.start).toISOString() },
      end: { dateTime: new Date(end).toISOString() },
    };
  }

  private addDay(iso: string): string {
    const d = new Date(iso);
    d.setDate(d.getDate() + 1);
    return d.toISOString();
  }

  private toRemoteEvent(e: GoogleEvent): RemoteEvent | null {
    if (!e.id) return null;
    const cancelled = e.status === 'cancelled';
    const allDay = !!e.start?.date && !e.start?.dateTime;
    const start = e.start?.dateTime ?? e.start?.date ?? null;
    if (!start && !cancelled) return null;
    return {
      id: e.id,
      title: e.summary ?? '(no title)',
      description: e.description ?? null,
      start: start ?? new Date(0).toISOString(),
      end: e.end?.dateTime ?? e.end?.date ?? null,
      allDay,
      updatedAt: e.updated ?? null,
      cancelled,
    };
  }

  private emailFromIdToken(idToken?: string): string | undefined {
    if (!idToken) return undefined;
    const parts = idToken.split('.');
    if (parts.length !== 3) return undefined;
    try {
      const pad = 4 - (parts[1].length % 4 || 4);
      const normalized =
        parts[1].replace(/-/g, '+').replace(/_/g, '/') + '='.repeat(pad % 4);
      const payload = JSON.parse(
        Buffer.from(normalized, 'base64').toString('utf8'),
      ) as { email?: string };
      return payload.email;
    } catch {
      return undefined;
    }
  }
}

interface GoogleEvent {
  id?: string;
  status?: string;
  summary?: string;
  description?: string;
  updated?: string;
  start?: { dateTime?: string; date?: string };
  end?: { dateTime?: string; date?: string };
}
