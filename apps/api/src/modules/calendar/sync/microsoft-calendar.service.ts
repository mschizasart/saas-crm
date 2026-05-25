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
 * Microsoft Outlook / Microsoft 365 calendar OAuth 2.0 + Graph API client.
 *
 * Reuses MICROSOFT_OAUTH_CLIENT_ID / _SECRET as the email integration but
 * with the Graph Calendars.ReadWrite scope and a DISTINCT redirect URI
 * (MICROSOFT_CALENDAR_REDIRECT_URI), falling back to deriving it from the
 * email redirect URI.
 *
 * Scopes: https://graph.microsoft.com/Calendars.ReadWrite offline_access
 *         (+ openid email profile to resolve the connected mailbox).
 *
 * "Delta" pull: we use Graph's $filter on lastModifiedDateTime instead of the
 * stateful delta endpoint to stay symmetric with Google's updatedMin and keep
 * the engine simple. The conflict rule (last-writer-wins by updatedAt) makes
 * occasional re-fetches harmless.
 */
@Injectable()
export class MicrosoftCalendarService implements CalendarProviderClient {
  private readonly logger = new Logger(MicrosoftCalendarService.name);
  readonly providerName: CalendarProvider = 'microsoft';

  private static readonly AUTH_URL =
    'https://login.microsoftonline.com/common/oauth2/v2.0/authorize';
  private static readonly TOKEN_URL =
    'https://login.microsoftonline.com/common/oauth2/v2.0/token';
  private static readonly GRAPH_BASE = 'https://graph.microsoft.com/v1.0';

  private static readonly SCOPE = [
    'https://graph.microsoft.com/Calendars.ReadWrite',
    'offline_access',
    'openid',
    'email',
    'profile',
  ].join(' ');

  constructor(private config: ConfigService) {}

  private get clientId(): string | undefined {
    return this.config.get<string>('MICROSOFT_OAUTH_CLIENT_ID');
  }
  private get clientSecret(): string | undefined {
    return this.config.get<string>('MICROSOFT_OAUTH_CLIENT_SECRET');
  }
  private get redirectUri(): string | undefined {
    const explicit = this.config.get<string>('MICROSOFT_CALENDAR_REDIRECT_URI');
    if (explicit) return explicit;
    const emailUri = this.config.get<string>('MICROSOFT_OAUTH_REDIRECT_URI');
    if (emailUri) {
      return emailUri.replace(
        /\/email-settings\/oauth\/microsoft\/callback$/,
        '/calendar-sync/microsoft/callback',
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
        'Microsoft OAuth is not configured on this server — set MICROSOFT_OAUTH_CLIENT_ID, MICROSOFT_OAUTH_CLIENT_SECRET and (optionally) MICROSOFT_CALENDAR_REDIRECT_URI.',
      );
    }
  }

  getAuthUrl(state: string): string {
    this.requireConfig();
    const params = new URLSearchParams({
      client_id: this.clientId!,
      redirect_uri: this.redirectUri!,
      response_type: 'code',
      response_mode: 'query',
      scope: MicrosoftCalendarService.SCOPE,
      prompt: 'select_account',
      state,
    });
    return `${MicrosoftCalendarService.AUTH_URL}?${params.toString()}`;
  }

  async exchangeCode(code: string): Promise<CalendarTokenResponse> {
    this.requireConfig();
    const body = new URLSearchParams({
      code,
      client_id: this.clientId!,
      client_secret: this.clientSecret!,
      redirect_uri: this.redirectUri!,
      grant_type: 'authorization_code',
      scope: MicrosoftCalendarService.SCOPE,
    });
    const res = await fetch(MicrosoftCalendarService.TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body,
    });
    if (!res.ok) {
      const txt = await res.text().catch(() => '');
      this.logger.warn(`Microsoft token exchange failed: ${res.status} ${txt}`);
      throw new BadRequestException(
        `Microsoft token exchange failed (${res.status})`,
      );
    }
    const json = (await res.json()) as {
      access_token: string;
      refresh_token?: string;
      expires_in: number;
      scope?: string;
      id_token?: string;
    };
    let email = this.emailFromIdToken(json.id_token);
    if (!email) {
      email = await this.emailFromGraph(json.access_token).catch(
        () => undefined,
      );
    }
    return {
      accessToken: json.access_token,
      refreshToken: json.refresh_token,
      expiresIn: json.expires_in,
      email,
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
      scope: MicrosoftCalendarService.SCOPE,
    });
    const res = await fetch(MicrosoftCalendarService.TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body,
    });
    if (!res.ok) {
      const txt = await res.text().catch(() => '');
      this.logger.warn(`Microsoft refresh failed: ${res.status} ${txt}`);
      throw new BadRequestException(
        `Microsoft token refresh failed (${res.status})`,
      );
    }
    const json = (await res.json()) as {
      access_token: string;
      refresh_token?: string;
      expires_in: number;
      scope?: string;
    };
    return {
      accessToken: json.access_token,
      // Microsoft rotates the refresh token — keep the new one.
      refreshToken: json.refresh_token,
      expiresIn: json.expires_in,
      scope: json.scope,
    };
  }

  // ── Graph Calendar API ──────────────────────────────────────

  async listEvents(
    accessToken: string,
    calendarId: string | null,
    since: Date | null,
    cap: number,
  ): Promise<RemotePullResult> {
    const path = calendarId
      ? `/me/calendars/${encodeURIComponent(calendarId)}/events`
      : '/me/events';
    const params = new URLSearchParams({
      $top: String(Math.min(cap, 100)),
      $orderby: 'lastModifiedDateTime desc',
      $select:
        'id,subject,bodyPreview,start,end,isAllDay,isCancelled,lastModifiedDateTime',
    });
    if (since) {
      params.set('$filter', `lastModifiedDateTime ge ${since.toISOString()}`);
    }
    const res = await fetch(
      `${MicrosoftCalendarService.GRAPH_BASE}${path}?${params.toString()}`,
      {
        headers: {
          Authorization: `Bearer ${accessToken}`,
          Prefer: 'outlook.timezone="UTC"',
        },
      },
    );
    if (!res.ok) {
      const txt = await res.text().catch(() => '');
      throw new Error(`Microsoft events list failed (${res.status}): ${txt}`);
    }
    const json = (await res.json()) as { value?: GraphEvent[] };
    const events = (json.value ?? [])
      .map((e) => this.toRemoteEvent(e))
      .filter((e): e is RemoteEvent => e !== null);
    return { events };
  }

  async createEvent(
    accessToken: string,
    calendarId: string | null,
    input: LocalEventInput,
  ): Promise<string> {
    const path = calendarId
      ? `/me/calendars/${encodeURIComponent(calendarId)}/events`
      : '/me/events';
    const res = await fetch(`${MicrosoftCalendarService.GRAPH_BASE}${path}`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(this.toGraphBody(input)),
    });
    if (!res.ok) {
      const txt = await res.text().catch(() => '');
      throw new Error(`Microsoft event create failed (${res.status}): ${txt}`);
    }
    const json = (await res.json()) as { id: string };
    return json.id;
  }

  async updateEvent(
    accessToken: string,
    _calendarId: string | null,
    externalId: string,
    input: LocalEventInput,
  ): Promise<void> {
    // Graph PATCH targets the event by id directly under /me/events.
    const res = await fetch(
      `${MicrosoftCalendarService.GRAPH_BASE}/me/events/${encodeURIComponent(externalId)}`,
      {
        method: 'PATCH',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(this.toGraphBody(input)),
      },
    );
    if (!res.ok) {
      const txt = await res.text().catch(() => '');
      throw new Error(`Microsoft event update failed (${res.status}): ${txt}`);
    }
  }

  private toGraphBody(input: LocalEventInput): Record<string, unknown> {
    const end = input.end ?? input.start;
    if (input.allDay) {
      // Graph all-day events require date-only start/end with end exclusive.
      const startDate = input.start.slice(0, 10);
      const endDate = (input.end ?? this.addDay(input.start)).slice(0, 10);
      return {
        subject: input.title,
        isAllDay: true,
        body: input.description
          ? { contentType: 'text', content: input.description }
          : undefined,
        start: { dateTime: `${startDate}T00:00:00`, timeZone: 'UTC' },
        end: { dateTime: `${endDate}T00:00:00`, timeZone: 'UTC' },
      };
    }
    return {
      subject: input.title,
      body: input.description
        ? { contentType: 'text', content: input.description }
        : undefined,
      start: {
        dateTime: new Date(input.start).toISOString(),
        timeZone: 'UTC',
      },
      end: { dateTime: new Date(end).toISOString(), timeZone: 'UTC' },
    };
  }

  private addDay(iso: string): string {
    const d = new Date(iso);
    d.setDate(d.getDate() + 1);
    return d.toISOString();
  }

  private toRemoteEvent(e: GraphEvent): RemoteEvent | null {
    if (!e.id) return null;
    const start = e.start?.dateTime
      ? this.graphTimeToIso(e.start.dateTime)
      : null;
    if (!start && !e.isCancelled) return null;
    return {
      id: e.id,
      title: e.subject ?? '(no title)',
      description: e.bodyPreview ?? null,
      start: start ?? new Date(0).toISOString(),
      end: e.end?.dateTime ? this.graphTimeToIso(e.end.dateTime) : null,
      allDay: !!e.isAllDay,
      updatedAt: e.lastModifiedDateTime ?? null,
      cancelled: !!e.isCancelled,
    };
  }

  /** Graph returns naive UTC datetimes (no Z) when Prefer UTC is set. */
  private graphTimeToIso(dt: string): string {
    const hasTz = /[zZ]|[+-]\d{2}:\d{2}$/.test(dt);
    return new Date(hasTz ? dt : `${dt}Z`).toISOString();
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
      ) as { email?: string; preferred_username?: string; upn?: string };
      return payload.email ?? payload.preferred_username ?? payload.upn;
    } catch {
      return undefined;
    }
  }

  private async emailFromGraph(accessToken: string): Promise<string | undefined> {
    const res = await fetch(`${MicrosoftCalendarService.GRAPH_BASE}/me`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (!res.ok) return undefined;
    const json = (await res.json()) as {
      mail?: string;
      userPrincipalName?: string;
    };
    return json.mail ?? json.userPrincipalName;
  }
}

interface GraphEvent {
  id?: string;
  subject?: string;
  bodyPreview?: string;
  isAllDay?: boolean;
  isCancelled?: boolean;
  lastModifiedDateTime?: string;
  start?: { dateTime?: string; timeZone?: string };
  end?: { dateTime?: string; timeZone?: string };
}
