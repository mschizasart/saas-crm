import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as webPush from 'web-push';
import { PrismaService } from '../../database/prisma.service';

export interface PushPayload {
  /** Notification title — keep ≤ 60 chars for iOS / Android display. */
  title: string;
  /** Notification body / preview text. */
  body?: string;
  /**
   * Deep-link URL the SW will navigate to on click. Same-origin path
   * preferred (e.g. "/invoices/abc") so we focus an existing tab.
   */
  url?: string;
  /**
   * Notification tag — if two pushes share a tag the newer one replaces
   * the older one in the tray (instead of stacking). Useful for
   * collapsing "ticket reply" repeats.
   */
  tag?: string;
  /** Optional icon URL — falls back to the manifest icon in the SW. */
  icon?: string;
}

interface SendResult {
  sent: number;
  failed: number;
  removed: number;
}

/**
 * Web push delivery service.
 *
 * VAPID config is read from env at module init. If the keys are missing
 * the service stays usable but every send becomes a no-op (and logs a
 * warning once) — that lets dev environments run without VAPID set up.
 */
@Injectable()
export class PushService implements OnModuleInit {
  private readonly log = new Logger(PushService.name);
  private configured = false;
  private warnedNotConfigured = false;
  private publicKey = '';

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
  ) {}

  onModuleInit() {
    const publicKey = this.config.get<string>('VAPID_PUBLIC_KEY');
    const privateKey = this.config.get<string>('VAPID_PRIVATE_KEY');
    const subject =
      this.config.get<string>('VAPID_SUBJECT') ?? 'mailto:admin@appoinlycrm.net';

    if (!publicKey || !privateKey) {
      this.log.warn(
        'VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY not set — web push is disabled. ' +
          'Generate keys with: npx web-push generate-vapid-keys',
      );
      return;
    }

    webPush.setVapidDetails(subject, publicKey, privateKey);
    this.publicKey = publicKey;
    this.configured = true;
    this.log.log('Web push configured');
  }

  /** Returns the VAPID public key for clients to pass into PushManager.subscribe(). */
  getPublicKey(): string {
    return this.publicKey;
  }

  isConfigured(): boolean {
    return this.configured;
  }

  /**
   * Upsert (insert-or-update) a subscription. We key by endpoint because
   * a re-subscribe from the same browser yields an identical endpoint.
   */
  async saveSubscription(args: {
    organizationId: string;
    userId: string;
    endpoint: string;
    p256dh: string;
    auth: string;
    userAgent?: string;
  }) {
    const { organizationId, userId, endpoint, p256dh, auth, userAgent } = args;

    return this.prisma.pushSubscription.upsert({
      where: { endpoint },
      create: {
        organizationId,
        userId,
        endpoint,
        p256dh,
        auth,
        userAgent: userAgent ?? '',
      },
      update: {
        // The same endpoint may now belong to a different user (rare —
        // shared device, account swap). Re-bind on update.
        organizationId,
        userId,
        p256dh,
        auth,
        userAgent: userAgent ?? '',
        lastUsedAt: new Date(),
      },
    });
  }

  async deleteSubscription(userId: string, endpoint: string) {
    // Constrain by userId so a user can only delete their own subscription.
    await this.prisma.pushSubscription.deleteMany({
      where: { userId, endpoint },
    });
  }

  async deleteSubscriptionByEndpoint(endpoint: string) {
    await this.prisma.pushSubscription.deleteMany({ where: { endpoint } });
  }

  /**
   * Send a push to every subscription belonging to a single user.
   * No-op (returns zero counters) if VAPID isn't configured — callers
   * still get a well-formed result so they can render UI feedback.
   */
  async sendToUser(userId: string, payload: PushPayload): Promise<SendResult> {
    if (!this.configured) {
      this.warnNotConfigured();
      return { sent: 0, failed: 0, removed: 0 };
    }

    const subs = await this.prisma.pushSubscription.findMany({
      where: { userId },
    });
    return this.dispatch(subs, payload);
  }

  /**
   * Send to every subscription in an organization. Optional filter
   * function lets callers skip particular users (e.g. don't notify the
   * actor who triggered the event).
   */
  async sendToOrg(
    organizationId: string,
    payload: PushPayload,
    filterFn?: (sub: { userId: string; endpoint: string }) => boolean,
  ): Promise<SendResult> {
    if (!this.configured) {
      this.warnNotConfigured();
      return { sent: 0, failed: 0, removed: 0 };
    }

    const subs = await this.prisma.pushSubscription.findMany({
      where: { organizationId },
    });
    const filtered = filterFn ? subs.filter(filterFn) : subs;
    return this.dispatch(filtered, payload);
  }

  // ─── Internals ─────────────────────────────────────────────────────

  private async dispatch(
    subs: Array<{
      endpoint: string;
      p256dh: string;
      auth: string;
    }>,
    payload: PushPayload,
  ): Promise<SendResult> {
    if (subs.length === 0) return { sent: 0, failed: 0, removed: 0 };

    // Cap payload at ~3 KB — most push services reject anything larger.
    const body = JSON.stringify({
      title: payload.title.slice(0, 200),
      body: payload.body?.slice(0, 1000),
      url: payload.url,
      tag: payload.tag,
      icon: payload.icon,
    });

    const expiredEndpoints: string[] = [];
    let sent = 0;
    let failed = 0;

    await Promise.all(
      subs.map(async (s) => {
        try {
          await webPush.sendNotification(
            {
              endpoint: s.endpoint,
              keys: { p256dh: s.p256dh, auth: s.auth },
            },
            body,
            { TTL: 60 * 60 * 24 }, // 24h: push services drop after this if undelivered
          );
          sent += 1;
        } catch (err: any) {
          // 404 / 410 → subscription is dead. Remove it.
          if (err?.statusCode === 404 || err?.statusCode === 410) {
            expiredEndpoints.push(s.endpoint);
          } else {
            this.log.warn(
              `Push send failed (status=${err?.statusCode ?? '?'}): ${
                err?.body ?? err?.message ?? 'unknown'
              }`,
            );
            failed += 1;
          }
        }
      }),
    );

    let removed = 0;
    if (expiredEndpoints.length > 0) {
      const result = await this.prisma.pushSubscription.deleteMany({
        where: { endpoint: { in: expiredEndpoints } },
      });
      removed = result.count;
    }

    // Touch lastUsedAt for survivors (best-effort, non-blocking).
    if (sent > 0) {
      const aliveEndpoints = subs
        .map((s) => s.endpoint)
        .filter((e) => !expiredEndpoints.includes(e));
      this.prisma.pushSubscription
        .updateMany({
          where: { endpoint: { in: aliveEndpoints } },
          data: { lastUsedAt: new Date() },
        })
        .catch(() => {
          /* swallow — non-critical */
        });
    }

    return { sent, failed, removed };
  }

  private warnNotConfigured() {
    if (this.warnedNotConfigured) return;
    this.warnedNotConfigured = true;
    this.log.warn('sendToUser/sendToOrg called but VAPID not configured');
  }
}
