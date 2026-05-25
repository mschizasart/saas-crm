import {
  Injectable,
  Logger,
  BadRequestException,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as crypto from 'crypto';
import { PrismaService } from '../../../database/prisma.service';
import { decrypt, encrypt, isEncrypted } from '../../../common/crypto/encrypt';
import { signOAuthState, verifyOAuthState } from '../../email-settings/oauth/oauth-state';
import { GoogleCalendarService } from './google-calendar.service';
import { MicrosoftCalendarService } from './microsoft-calendar.service';
import {
  CalendarProvider,
  CalendarProviderClient,
  LocalEventInput,
  RemoteEvent,
} from './calendar-provider.types';

/** Hard caps so a single sync run can't go runaway. */
const MAX_EVENTS_PER_SYNC = 200;
const MAX_SYNC_MS = 60_000;
/** Refresh the access token when it has under this much life left. */
const TOKEN_REFRESH_SKEW_MS = 60_000;

interface CalendarSyncRow {
  id: string;
  organizationId: string;
  userId: string;
  provider: string;
  refreshToken: string;
  accessToken: string | null;
  tokenExpiresAt: Date | null;
  externalCalendarId: string | null;
  syncEnabled: boolean;
  syncDirection: string;
  lastSyncedAt: Date | null;
  lastSyncError: string | null;
  connectedEmail: string | null;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * Orchestrates the per-user, per-provider 2-way calendar sync.
 *
 * Storage: `calendar_syncs` (migration 025) has NO RLS — tenant isolation is
 * enforced here by scoping every query on organizationId + userId. Local
 * events live in `events`, which IS service-layer tenant-scoped, so those
 * reads/writes go through prisma.withOrganization().
 *
 * ── Echo-loop guard & conflict resolution ──────────────────────────────
 * Each local event carries `externalId` (the remote id), `lastSyncedAt`
 * (when we last reconciled it) and `syncHash` (a hash of its sync-relevant
 * fields at the moment we last wrote/read it).
 *
 *  - PULL writes the remote event into `events`, sets externalId +
 *    externalProvider, stamps lastSyncedAt, and stores syncHash = hash of
 *    the values we just wrote. Because the hash matches the stored row, the
 *    subsequent PUSH pass sees "hash unchanged since last sync" and does NOT
 *    re-push it → no echo.
 *  - PUSH only fires for a row when it has no externalId (never synced) OR
 *    its current syncHash differs from the stored one (locally edited since
 *    last sync). After pushing, we re-stamp syncHash so the next pull pass
 *    won't treat the remote's mirror of our push as a fresh remote change
 *    worth pulling back (last-writer-wins handles the timestamp tie).
 *  - CONFLICT (edited both sides between runs): last-writer-wins by the
 *    remote `updatedAt` vs local `updatedAt`. On pull we overwrite the local
 *    copy only when remote.updatedAt >= local.updatedAt; on push we always
 *    send local→remote when the local hash changed. With a 15-min cadence
 *    true simultaneous edits are rare; the rule is documented and stable.
 */
@Injectable()
export class CalendarSyncService {
  private readonly logger = new Logger(CalendarSyncService.name);

  constructor(
    private prisma: PrismaService,
    private config: ConfigService,
    private google: GoogleCalendarService,
    private microsoft: MicrosoftCalendarService,
  ) {}

  private encKey(): string | undefined {
    return this.config.get<string>('ENCRYPTION_KEY');
  }

  private client(p: CalendarProvider): CalendarProviderClient {
    return p === 'google' ? this.google : this.microsoft;
  }

  assertProvider(p: string): CalendarProvider {
    if (p !== 'google' && p !== 'microsoft') {
      throw new BadRequestException(`Unknown calendar provider: ${p}`);
    }
    return p;
  }

  private tryDecrypt(v: string | null | undefined): string | null {
    if (!v) return null;
    try {
      return isEncrypted(v) ? decrypt(v, this.encKey()) : v;
    } catch (e) {
      this.logger.error(
        `Calendar token decrypt failed: ${(e as Error).message}`,
        JSON.stringify({ reason: 'decrypt_failure' }),
      );
      return null;
    }
  }

  // ── Connect flow ────────────────────────────────────────────

  /** Build the consent URL. State binds userId+orgId+provider, HMAC-signed. */
  getAuthUrl(orgId: string, userId: string, provider: CalendarProvider): string {
    const client = this.client(provider);
    if (!client.isConfigured()) {
      throw new BadRequestException(
        `${provider} OAuth is not configured on this server`,
      );
    }
    // Reuse the email oauth-state signer, whose payload is { orgId, provider }.
    // Calendar sync is per-USER, so we encode "orgId|userId" into the signer's
    // orgId slot. The HMAC covers the whole string, so the packed pair is
    // tamper-proof on the callback.
    const state = signOAuthState(
      { orgId: this.packState(orgId, userId), provider },
      this.encKey(),
    );
    return client.getAuthUrl(state);
  }

  /**
   * The shared oauth-state signer only carries { orgId, provider }. Calendar
   * sync is per-USER, so we pack "orgId|userId" into that field and unpack on
   * the callback. The HMAC still covers the whole thing, so it can't be
   * tampered with.
   */
  private packState(orgId: string, userId: string): string {
    return `${orgId}|${userId}`;
  }

  private unpackState(packed: string): { orgId: string; userId: string } {
    // Split on the FIRST '|' only: an orgId/userId could theoretically contain
    // the delimiter, and split('|') would mis-segment it. The HMAC already
    // guarantees `packed` is exactly what we signed, so a single split point
    // is unambiguous.
    const idx = packed.indexOf('|');
    const orgId = idx >= 0 ? packed.slice(0, idx) : '';
    const userId = idx >= 0 ? packed.slice(idx + 1) : '';
    if (!orgId || !userId) {
      throw new BadRequestException('State payload incomplete');
    }
    return { orgId, userId };
  }

  /**
   * Handle the provider redirect: verify state, swap code→tokens, persist
   * encrypted. Returns enough for the controller to redirect the browser.
   */
  async handleCallback(
    provider: CalendarProvider,
    code: string,
    state: string,
  ): Promise<{ connectedEmail?: string }> {
    if (!code) throw new BadRequestException('Missing authorization code');
    const decoded = verifyOAuthState(state, this.encKey());
    if (decoded.provider !== provider) {
      throw new BadRequestException('State provider mismatch');
    }
    const { orgId, userId } = this.unpackState(decoded.orgId);

    const client = this.client(provider);
    const tokens = await client.exchangeCode(code);
    if (!tokens.refreshToken) {
      throw new BadRequestException(
        'Provider did not return a refresh_token — revoke access in your account and try again.',
      );
    }

    const encryptedRefresh = encrypt(tokens.refreshToken, this.encKey());
    const encryptedAccess = encrypt(tokens.accessToken, this.encKey());
    const expiresAt = new Date(Date.now() + tokens.expiresIn * 1000);

    // calendar_syncs has no RLS — scope explicitly by (userId, provider).
    await (this.prisma as any).calendarSync.upsert({
      where: { userId_provider: { userId, provider } },
      create: {
        organizationId: orgId,
        userId,
        provider,
        refreshToken: encryptedRefresh,
        accessToken: encryptedAccess,
        tokenExpiresAt: expiresAt,
        connectedEmail: tokens.email ?? null,
        syncEnabled: true,
        syncDirection: 'both',
        lastSyncError: null,
      },
      update: {
        organizationId: orgId,
        refreshToken: encryptedRefresh,
        accessToken: encryptedAccess,
        tokenExpiresAt: expiresAt,
        connectedEmail: tokens.email ?? null,
        syncEnabled: true,
        lastSyncError: null,
      },
    });

    return { connectedEmail: tokens.email };
  }

  /** Disconnect: clear tokens and disable sync (keep the row for history). */
  async disconnect(
    orgId: string,
    userId: string,
    provider: CalendarProvider,
  ): Promise<void> {
    await (this.prisma as any).calendarSync.updateMany({
      where: { organizationId: orgId, userId, provider },
      data: {
        syncEnabled: false,
        accessToken: null,
        tokenExpiresAt: null,
        // Drop the refresh token so a stale credential can't be reused; the
        // schema requires non-null, so store an empty encrypted marker.
        refreshToken: encrypt('', this.encKey()),
      },
    });
  }

  /** Redacted status list for the current user (NO tokens). */
  async getStatus(orgId: string, userId: string) {
    const rows: CalendarSyncRow[] = await (this.prisma as any).calendarSync.findMany({
      where: { organizationId: orgId, userId },
      orderBy: { provider: 'asc' },
    });
    return {
      config: {
        google: this.google.isConfigured(),
        microsoft: this.microsoft.isConfigured(),
      },
      connections: rows.map((r) => ({
        provider: r.provider,
        connectedEmail: r.connectedEmail,
        syncEnabled: r.syncEnabled,
        syncDirection: r.syncDirection,
        externalCalendarId: r.externalCalendarId,
        lastSyncedAt: r.lastSyncedAt,
        lastSyncError: r.lastSyncError,
      })),
    };
  }

  // ── Token freshness ─────────────────────────────────────────

  /**
   * Return a fresh access token for the row, refreshing + persisting if the
   * cached one is missing or within the skew window of expiry. Persists a
   * rotated refresh token when the provider returns one (Microsoft).
   */
  private async ensureAccessToken(row: CalendarSyncRow): Promise<string> {
    const provider = this.assertProvider(row.provider);
    const client = this.client(provider);
    if (!client.isConfigured()) {
      throw new Error(`${provider} OAuth not configured on this server`);
    }
    const refreshPlain = this.tryDecrypt(row.refreshToken);
    if (!refreshPlain) {
      throw new Error('Refresh token missing or undecryptable — reconnect.');
    }

    const now = Date.now();
    const exp = row.tokenExpiresAt
      ? new Date(row.tokenExpiresAt).getTime()
      : 0;
    const fresh = exp - now > TOKEN_REFRESH_SKEW_MS;
    const cached = fresh ? this.tryDecrypt(row.accessToken) : null;
    if (cached) return cached;

    const t = await client.refreshAccessToken(refreshPlain);
    const newExpiry = new Date(Date.now() + t.expiresIn * 1000);
    // Microsoft refresh tokens are one-time-use: a successful refresh is
    // supposed to return a NEW refresh_token that replaces the old one. If it
    // doesn't, we have no choice but to keep reusing the existing token — but
    // that path leads to a silent `invalid_grant` ~90 days out. We can't fix it
    // without a token, so we keep the fallback AND log a structured warning so
    // an operator can spot the silent-death path before it expires.
    if (provider === 'microsoft' && !t.refreshToken) {
      this.logger.warn(
        `Microsoft refresh did not return a new refresh_token — reusing the existing one (one-time-use; risks invalid_grant ~90d out).`,
        JSON.stringify({
          reason: 'missing_refresh_token',
          provider,
          syncId: row.id,
          userId: row.userId,
          organizationId: row.organizationId,
        }),
      );
    }
    const nextRefreshEncrypted = t.refreshToken
      ? encrypt(t.refreshToken, this.encKey())
      : row.refreshToken;
    await (this.prisma as any).calendarSync.update({
      where: { id: row.id },
      data: {
        accessToken: encrypt(t.accessToken, this.encKey()),
        refreshToken: nextRefreshEncrypted,
        tokenExpiresAt: newExpiry,
      },
    });
    return t.accessToken;
  }

  // ── Sync engine ─────────────────────────────────────────────

  /**
   * Manual trigger entrypoint used by the controller. `orgId` is REQUIRED:
   * calendar_syncs has no RLS, so omitting the organization filter would let a
   * lookup cross tenants. Every caller has the org available (the controller
   * from the request context; the processor/scheduler use runSync() directly
   * with a row that already carries organizationId), so we hard-require it.
   */
  async syncForUser(
    userId: string,
    provider: CalendarProvider,
    orgId: string,
  ): Promise<{ pulled: number; pushed: number; error?: string }> {
    if (!orgId) {
      throw new BadRequestException('orgId is required to sync a calendar');
    }
    const where: any = {
      organizationId: orgId,
      userId,
      provider,
      syncEnabled: true,
    };
    const row: CalendarSyncRow | null = await (this.prisma as any).calendarSync.findFirst({
      where,
    });
    if (!row) {
      throw new NotFoundException('No active calendar connection');
    }
    return this.runSync(row);
  }

  /** Used by the scheduler — fetch all enabled rows to enqueue. */
  async listEnabledSyncs(): Promise<
    { id: string; userId: string; provider: string; organizationId: string }[]
  > {
    return (this.prisma as any).calendarSync.findMany({
      where: { syncEnabled: true },
      select: { id: true, userId: true, provider: true, organizationId: true },
    });
  }

  async getRowById(id: string): Promise<CalendarSyncRow | null> {
    return (this.prisma as any).calendarSync.findUnique({ where: { id } });
  }

  /**
   * Core reconcile. Never throws into the scheduler — on error it records
   * `lastSyncError` and returns it so the worker can log without retry storms.
   */
  async runSync(
    row: CalendarSyncRow,
  ): Promise<{ pulled: number; pushed: number; error?: string }> {
    const provider = this.assertProvider(row.provider);
    const client = this.client(provider);
    const deadline = Date.now() + MAX_SYNC_MS;
    let pulled = 0;
    let pushed = 0;

    try {
      const accessToken = await this.ensureAccessToken(row);
      const direction = row.syncDirection;

      // ── PULL ──
      const pulledExternalIds = new Set<string>();
      if (direction === 'both' || direction === 'pull') {
        const { events } = await client.listEvents(
          accessToken,
          row.externalCalendarId,
          row.lastSyncedAt ?? null,
          MAX_EVENTS_PER_SYNC,
        );
        for (const remote of events.slice(0, MAX_EVENTS_PER_SYNC)) {
          if (Date.now() > deadline) break;
          pulledExternalIds.add(remote.id);
          const changed = await this.applyRemote(row, provider, remote);
          if (changed) pulled++;
        }
      }

      // ── PUSH ──
      if (direction === 'both' || direction === 'push') {
        const pushable = await this.findPushableEvents(row.organizationId, row.userId);
        for (const ev of pushable) {
          if (Date.now() > deadline) break;
          if (pushed >= MAX_EVENTS_PER_SYNC) break;
          // Echo-loop guard: never re-push an event we pulled this run.
          if (ev.externalId && pulledExternalIds.has(ev.externalId)) continue;
          const did = await this.pushLocal(row, provider, client, accessToken, ev);
          if (did) pushed++;
        }
      }

      await (this.prisma as any).calendarSync.update({
        where: { id: row.id },
        data: { lastSyncedAt: new Date(), lastSyncError: null },
      });
      return { pulled, pushed };
    } catch (e) {
      const error = (e as Error).message || 'Calendar sync failed';
      this.logger.warn(
        `Calendar sync failed for user=${row.userId} provider=${provider}: ${error}`,
      );
      // Record the error but DO NOT throw — the scheduler must not retry-storm.
      await (this.prisma as any).calendarSync
        .update({
          where: { id: row.id },
          data: { lastSyncError: error.slice(0, 1000) },
        })
        .catch(() => undefined);
      return { pulled, pushed, error };
    }
  }

  // ── Pull side ───────────────────────────────────────────────

  /**
   * Upsert one remote event into `events`, matched by (userId,
   * externalProvider, externalId). A synced event belongs to the connecting
   * user, so EVERY lookup/write here is scoped by userId in addition to org:
   * two users in the same org could otherwise reuse/share an externalId and
   * one would silently overwrite the other's event. Returns true if a row was
   * created/updated/deleted.
   */
  private async applyRemote(
    row: CalendarSyncRow,
    provider: CalendarProvider,
    remote: RemoteEvent,
  ): Promise<boolean> {
    return this.prisma.withOrganization(row.organizationId, async (tx) => {
      const existing = await (tx as any).event.findFirst({
        where: {
          organizationId: row.organizationId,
          userId: row.userId,
          externalProvider: provider,
          externalId: remote.id,
        },
      });

      // Remote deletion → delete the local mirror (only if it's a synced one).
      if (remote.cancelled) {
        if (existing) {
          // Scope the delete by org+user as defense-in-depth (existing.id is
          // already user-scoped via the findFirst above).
          await (tx as any).event.deleteMany({
            where: {
              id: existing.id,
              organizationId: row.organizationId,
              userId: row.userId,
            },
          });
          return true;
        }
        return false;
      }

      const input = this.remoteToLocal(remote);
      const hash = this.hashLocal(input);

      if (!existing) {
        await (tx as any).event.create({
          data: {
            organizationId: row.organizationId,
            userId: row.userId,
            title: input.title,
            description: input.description ?? null,
            startDate: new Date(input.start),
            endDate: input.end ? new Date(input.end) : null,
            allDay: input.allDay,
            type: 'event',
            externalId: remote.id,
            externalProvider: provider,
            lastSyncedAt: new Date(),
            syncHash: hash,
            createdBy: row.userId,
          },
        });
        return true;
      }

      // Last-writer-wins: only overwrite when the remote is at least as new
      // as our local copy. Avoids clobbering a local edit made since the
      // last sync that hasn't been pushed yet.
      const remoteUpdated = remote.updatedAt
        ? new Date(remote.updatedAt).getTime()
        : Date.now();
      const localUpdated = existing.updatedAt
        ? new Date(existing.updatedAt).getTime()
        : 0;
      if (remoteUpdated < localUpdated && existing.syncHash !== hash) {
        // Local is newer AND locally changed → leave it for the push pass.
        return false;
      }
      if (existing.syncHash === hash) {
        // Nothing materially changed — just stamp lastSyncedAt.
        await (tx as any).event.updateMany({
          where: {
            id: existing.id,
            organizationId: row.organizationId,
            userId: row.userId,
          },
          data: { lastSyncedAt: new Date() },
        });
        return false;
      }
      await (tx as any).event.updateMany({
        where: {
          id: existing.id,
          organizationId: row.organizationId,
          userId: row.userId,
        },
        data: {
          title: input.title,
          description: input.description ?? null,
          startDate: new Date(input.start),
          endDate: input.end ? new Date(input.end) : null,
          allDay: input.allDay,
          lastSyncedAt: new Date(),
          syncHash: hash,
        },
      });
      return true;
    });
  }

  // ── Push side ───────────────────────────────────────────────

  /**
   * Local events worth pushing: those owned by this user that either have no
   * externalId (never pushed) OR whose current content hash differs from the
   * stored syncHash (locally edited since last sync). We compute the hash in
   * JS rather than SQL, so fetch a bounded window of the user's events.
   */
  private async findPushableEvents(orgId: string, userId: string) {
    return this.prisma.withOrganization(orgId, async (tx) => {
      const rows = await (tx as any).event.findMany({
        where: {
          organizationId: orgId,
          userId,
          // Only forward-looking events to bound the work; past events rarely
          // change and we don't want to backfill years of history.
          startDate: { gte: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000) },
        },
        orderBy: { updatedAt: 'desc' },
        take: MAX_EVENTS_PER_SYNC * 2,
      });
      return rows.filter((ev: any) => {
        const currentHash = this.hashLocal(this.eventToInput(ev));
        // Never pushed yet, OR content changed since last sync.
        return !ev.externalId || ev.syncHash !== currentHash;
      });
    });
  }

  /** Push one local event to the remote, then re-stamp its sync state. */
  private async pushLocal(
    row: CalendarSyncRow,
    provider: CalendarProvider,
    client: CalendarProviderClient,
    accessToken: string,
    ev: any,
  ): Promise<boolean> {
    const input = this.eventToInput(ev);
    const hash = this.hashLocal(input);
    let externalId = ev.externalId as string | null;

    if (externalId) {
      await client.updateEvent(
        accessToken,
        row.externalCalendarId,
        externalId,
        input,
      );
    } else {
      externalId = await client.createEvent(
        accessToken,
        row.externalCalendarId,
        input,
      );
    }

    await this.prisma.withOrganization(row.organizationId, async (tx) => {
      // Scope by org+user as defense-in-depth, independent of RLS state.
      // updateMany lets us apply the compound filter (update requires a unique
      // where, which can't express org+user).
      await (tx as any).event.updateMany({
        where: {
          id: ev.id,
          organizationId: row.organizationId,
          userId: row.userId,
        },
        data: {
          externalId,
          externalProvider: provider,
          lastSyncedAt: new Date(),
          syncHash: hash,
        },
      });
    });
    return true;
  }

  // ── Mapping + hashing ───────────────────────────────────────

  private remoteToLocal(remote: RemoteEvent): LocalEventInput {
    return {
      title: remote.title,
      description: remote.description ?? null,
      start: remote.start,
      end: remote.end ?? null,
      allDay: remote.allDay,
    };
  }

  private eventToInput(ev: any): LocalEventInput {
    return {
      title: ev.title,
      description: ev.description ?? null,
      start: new Date(ev.startDate).toISOString(),
      end: ev.endDate ? new Date(ev.endDate).toISOString() : null,
      allDay: !!ev.allDay,
    };
  }

  /**
   * Stable hash over the sync-relevant fields. Used to detect local edits and
   * to suppress echo: a freshly pulled event's stored hash matches its remote
   * values, so the push pass skips it.
   */
  private hashLocal(input: LocalEventInput): string {
    const canonical = JSON.stringify({
      t: input.title ?? '',
      d: input.description ?? '',
      s: input.start ? new Date(input.start).toISOString() : '',
      e: input.end ? new Date(input.end).toISOString() : '',
      a: !!input.allDay,
    });
    return crypto.createHash('sha256').update(canonical).digest('hex');
  }
}
