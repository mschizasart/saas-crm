import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Job } from 'bullmq';
import { Logger } from '@nestjs/common';
import * as crypto from 'crypto';
import { PrismaService } from '../../database/prisma.service';
import { PublicWebhooksService } from './webhooks.service';

/**
 * Delivery worker for the `webhook-delivery` queue.
 *
 * Job payload: { deliveryId: string; organizationId: string }
 *
 * Reads the delivery row, loads the webhook (incl. decrypted secret),
 * POSTs the payload, then updates the row with the outcome.
 *
 * Backoff schedule (attempt number → delay before next try):
 *   1 → +1m, 2 → +5m, 3 → +30m, 4 → +2h, 5 → +12h. After 5 attempts the
 *   delivery is marked permanently failed (`succeeded=false`, `nextAttemptAt=null`).
 *
 * 4xx (except 408/429) is treated as PERMANENTLY broken — the consumer
 * told us the payload is bad; retrying won't help. 5xx, 408 (timeout) and
 * 429 (rate limit) plus all network errors are retried per the schedule.
 *
 * The delivery row — not BullMQ — is the source of truth. A 1-minute
 * fallback scheduler (webhook-retry.scheduler.ts) sweeps for due rows
 * the queue may have lost (process restart, redis flush, etc.).
 */
@Processor('webhook-delivery', { concurrency: 8 })
export class WebhookDeliveryProcessor extends WorkerHost {
  private readonly logger = new Logger(WebhookDeliveryProcessor.name);

  // Minutes for cleanliness — converted to ms inside scheduleRetry.
  private static readonly BACKOFF_MINUTES = [1, 5, 30, 120, 720];
  private static readonly MAX_ATTEMPTS = WebhookDeliveryProcessor.BACKOFF_MINUTES.length;
  private static readonly TIMEOUT_MS = 10_000;

  constructor(
    private readonly prisma: PrismaService,
    private readonly webhooks: PublicWebhooksService,
  ) {
    super();
  }

  async process(job: Job<{ deliveryId: string; organizationId: string }>) {
    const { deliveryId, organizationId } = job.data;
    if (!deliveryId || !organizationId) {
      this.logger.warn(`Job ${job.id} missing deliveryId/orgId — dropping`);
      return { skipped: true };
    }

    const delivery = await this.prisma.publicWebhookDelivery.findFirst({
      where: { id: deliveryId, organizationId },
      select: {
        id: true,
        webhookId: true,
        event: true,
        payload: true,
        attemptCount: true,
        organizationId: true,
        succeeded: true,
      },
    });
    if (!delivery) {
      this.logger.warn(`Delivery ${deliveryId} not found — dropping`);
      return { skipped: true };
    }
    if (delivery.succeeded) {
      // Already succeeded (race: scheduler + queue both fired). No-op.
      return { skipped: true, reason: 'already-succeeded' };
    }

    const webhook = await this.prisma.publicWebhook.findFirst({
      where: { id: delivery.webhookId, organizationId },
      select: { id: true, url: true, secret: true, active: true },
    });
    if (!webhook) {
      // The webhook was deleted between enqueue and delivery — mark the row
      // as permanently failed so it stops being picked up.
      await this.prisma.publicWebhookDelivery.update({
        where: { id: delivery.id },
        data: {
          succeeded: false,
          nextAttemptAt: null,
          responseBody: 'webhook deleted',
          lastAttemptAt: new Date(),
        },
      });
      return { skipped: true, reason: 'webhook-deleted' };
    }
    if (!webhook.active) {
      // Subscription was paused; freeze the delivery without burning an attempt.
      await this.prisma.publicWebhookDelivery.update({
        where: { id: delivery.id },
        data: { nextAttemptAt: null, responseBody: 'webhook inactive' },
      });
      return { skipped: true, reason: 'webhook-inactive' };
    }

    const attempt = (delivery.attemptCount ?? 0) + 1;
    let secret: string;
    try {
      secret = this.webhooks.decryptSecret(webhook.secret);
    } catch (e) {
      // Decryption failed (bad ENCRYPTION_KEY, corrupted ciphertext, etc.).
      // Re-trying with the same broken key won't help, so mark the row as
      // permanently failed instead of burning the retry budget. The loud
      // log line from decryptSecret already surfaces the cause.
      this.logger.error(
        `Aborting delivery ${delivery.id}: secret decryption failed: ${(e as Error).message}`,
      );
      await this.prisma.publicWebhookDelivery.update({
        where: { id: delivery.id },
        data: {
          succeeded: false,
          responseBody: 'secret decryption failed',
          attemptCount: attempt,
          lastAttemptAt: new Date(),
          nextAttemptAt: null,
        },
      });
      return { skipped: true, reason: 'secret-decryption-failed' };
    }

    // Build the EXACT body bytes we put on the wire — the HMAC must be
    // computed over the same string, otherwise the consumer's verify step
    // will silently fail on whitespace / key-order drift.
    const bodyObj = {
      id: delivery.id,
      event: delivery.event,
      created_at: new Date().toISOString(),
      data: delivery.payload ?? {},
    };
    const body = JSON.stringify(bodyObj);

    const signature = secret
      ? crypto.createHmac('sha256', secret).update(body, 'utf8').digest('hex')
      : '';

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'X-Crm-Event': delivery.event,
      'X-Crm-Delivery': delivery.id,
      ...(signature && { 'X-Crm-Signature': `sha256=${signature}` }),
      'User-Agent': 'AppoinlyCRM-Webhook/1.0',
    };

    const controller = new AbortController();
    const timeout = setTimeout(
      () => controller.abort(),
      WebhookDeliveryProcessor.TIMEOUT_MS,
    );

    let statusCode: number | null = null;
    let responseSnippet: string | null = null;
    let outcome:
      | 'success'
      | 'permanent-fail'
      | 'retry'
      | 'network-error' = 'network-error';

    try {
      const res = await fetch(webhook.url, {
        method: 'POST',
        headers,
        body,
        signal: controller.signal,
      });
      statusCode = res.status;
      try {
        const text = await res.text();
        // Keep only the first 4KB to avoid pathological payloads bloating the row.
        responseSnippet = text.slice(0, 4096);
      } catch {
        responseSnippet = null;
      }
      if (res.status >= 200 && res.status < 300) {
        outcome = 'success';
      } else if (res.status === 408 || res.status === 429 || res.status >= 500) {
        outcome = 'retry';
      } else {
        // 4xx (except 408/429): consumer says payload is bad; retrying won't help.
        outcome = 'permanent-fail';
      }
    } catch (err: any) {
      // Network / abort / DNS — treat as retryable.
      responseSnippet = `error: ${err?.message ?? String(err)}`.slice(0, 4096);
      outcome = 'retry';
    } finally {
      clearTimeout(timeout);
    }

    const now = new Date();

    if (outcome === 'success') {
      await this.prisma.publicWebhookDelivery.update({
        where: { id: delivery.id },
        data: {
          succeeded: true,
          statusCode: statusCode ?? undefined,
          responseBody: responseSnippet,
          attemptCount: attempt,
          lastAttemptAt: now,
          nextAttemptAt: null,
        },
      });
      return { done: true, statusCode };
    }

    if (outcome === 'permanent-fail') {
      await this.prisma.publicWebhookDelivery.update({
        where: { id: delivery.id },
        data: {
          succeeded: false,
          statusCode: statusCode ?? undefined,
          responseBody: responseSnippet,
          attemptCount: attempt,
          lastAttemptAt: now,
          nextAttemptAt: null,
        },
      });
      return { permanentFail: true, statusCode };
    }

    // outcome === 'retry' || 'network-error'
    if (attempt >= WebhookDeliveryProcessor.MAX_ATTEMPTS) {
      // Give up. Future redeliver() calls can still kick it back in.
      await this.prisma.publicWebhookDelivery.update({
        where: { id: delivery.id },
        data: {
          succeeded: false,
          statusCode: statusCode ?? undefined,
          responseBody: responseSnippet,
          attemptCount: attempt,
          lastAttemptAt: now,
          nextAttemptAt: null,
        },
      });
      return { exhausted: true, statusCode };
    }

    const backoffMin = WebhookDeliveryProcessor.BACKOFF_MINUTES[attempt - 1];
    const nextAttemptAt = new Date(now.getTime() + backoffMin * 60_000);

    await this.prisma.publicWebhookDelivery.update({
      where: { id: delivery.id },
      data: {
        succeeded: false,
        statusCode: statusCode ?? undefined,
        responseBody: responseSnippet,
        attemptCount: attempt,
        lastAttemptAt: now,
        nextAttemptAt,
      },
    });

    // Re-enqueue with the BullMQ delay too — belt-and-braces with the
    // 1-min scheduler. `jobId` is `deliver:<id>:<nextAttemptNumber>`, the
    // SAME formula the scheduler uses (row.attemptCount + 1). BullMQ then
    // de-dupes the scheduler's job against ours if the scheduler picks the
    // row up before our delayed job fires.
    const nextAttempt = attempt + 1;
    await job.queue.add(
      'deliver',
      { deliveryId: delivery.id, organizationId: delivery.organizationId },
      {
        delay: backoffMin * 60_000,
        jobId: `deliver:${delivery.id}:${nextAttempt}`,
        removeOnComplete: 1000,
        removeOnFail: 1000,
      },
    );

    return { retryScheduled: true, nextAttemptAt, statusCode };
  }
}
