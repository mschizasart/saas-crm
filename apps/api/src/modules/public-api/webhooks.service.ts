import {
  BadRequestException,
  Injectable,
  InternalServerErrorException,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import * as crypto from 'crypto';
import { PrismaService } from '../../database/prisma.service';
import { encrypt, decrypt, isEncrypted } from '../../common/crypto/encrypt';
import { ALLOWED_EVENTS, isAllowedEvent } from './webhook-events';
import { CreateWebhookDto, UpdateWebhookDto } from './public-api.dto';

/**
 * Webhook subscription + delivery-history management.
 *
 * Secrets are AES-256-GCM-encrypted at rest with ENCRYPTION_KEY (the same
 * envelope email_settings.smtpPassword uses). The plaintext secret is
 * shown to the operator EXACTLY ONCE — at creation and at
 * `rotate-secret` time — and then decrypted only inside the delivery
 * processor when signing the outgoing payload.
 *
 * Delivery rows are the source of truth for "did event X go out?" — the
 * BullMQ queue is only the scheduler; the row is written BEFORE
 * enqueueing in `WebhookDispatcherService.emit`.
 */
@Injectable()
export class PublicWebhooksService {
  private readonly logger = new Logger(PublicWebhooksService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    @InjectQueue('webhook-delivery') private readonly queue: Queue,
  ) {}

  private encKey(): string {
    const key = this.config.get<string>('ENCRYPTION_KEY');
    if (!key) {
      // Refuse to operate without a key — silently signing with `''` would
      // produce trivially forgeable HMAC signatures. The startup validator
      // in onModuleInit catches the missing env at boot; this is the
      // request-time fail-safe.
      throw new InternalServerErrorException(
        'ENCRYPTION_KEY env var is required for webhook secrets',
      );
    }
    return key;
  }

  // ─── Helpers ──────────────────────────────────────────────────

  private validateEvents(events: string[]): void {
    if (!Array.isArray(events) || events.length === 0) {
      throw new BadRequestException('At least one event must be selected');
    }
    const bad = events.filter((e) => !isAllowedEvent(e));
    if (bad.length > 0) {
      throw new BadRequestException(
        `Unknown event(s): ${bad.join(', ')}. Allowed: ${ALLOWED_EVENTS.join(', ')}`,
      );
    }
  }

  /** Belt-and-braces on top of the DTO IsUrl validator. */
  private validateUrl(url: string): void {
    if (typeof url !== 'string' || !/^https:\/\//i.test(url)) {
      throw new BadRequestException('Webhook URL must use https://');
    }
  }

  private generateSecret(): string {
    return crypto.randomBytes(32).toString('hex');
  }

  /** Strip the encrypted secret before returning to the caller. */
  private redact<T extends { secret?: string }>(row: T): Omit<T, 'secret'> & {
    secretSet: boolean;
  } {
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { secret, ...rest } = row;
    return { ...rest, secretSet: !!secret };
  }

  /**
   * Internal — read the plaintext secret for a webhook row. Tolerates legacy
   * unencrypted values so a partial backfill doesn't break delivery.
   *
   * THROWS on decryption failure. The processor catches and marks the
   * delivery as permanently failed — silently returning `''` here would
   * cause the worker to sign payloads with an empty HMAC key, producing
   * trivially-forgeable signatures.
   */
  decryptSecret(stored: string): string {
    if (!stored) return '';
    if (!isEncrypted(stored)) return stored;
    try {
      return decrypt(stored, this.encKey());
    } catch (e) {
      this.logger.error(
        `Failed to decrypt webhook secret — aborting delivery (no silent fallback to unsigned): ${(e as Error).message}`,
      );
      throw e;
    }
  }

  // ─── CRUD ─────────────────────────────────────────────────────

  async list(orgId: string) {
    const rows = await this.prisma.publicWebhook.findMany({
      where: { organizationId: orgId },
      orderBy: { createdAt: 'desc' },
    });
    return rows.map((r) => this.redact(r));
  }

  async findOne(orgId: string, id: string) {
    const row = await this.prisma.publicWebhook.findFirst({
      where: { id, organizationId: orgId },
    });
    if (!row) throw new NotFoundException('Webhook not found');
    return this.redact(row);
  }

  async create(orgId: string, userId: string | null, dto: CreateWebhookDto) {
    this.validateUrl(dto.url);
    this.validateEvents(dto.events);

    const plaintextSecret = this.generateSecret();
    const stored = encrypt(plaintextSecret, this.encKey());

    const row = await this.prisma.publicWebhook.create({
      data: {
        organizationId: orgId,
        url: dto.url,
        events: dto.events,
        secret: stored,
        active: dto.active ?? true,
        createdById: userId ?? null,
      },
    });

    // ⚠ Plaintext secret returned ONCE — surface in the UI with a copy box.
    return { ...this.redact(row), secret: plaintextSecret };
  }

  async update(orgId: string, id: string, dto: UpdateWebhookDto) {
    const existing = await this.prisma.publicWebhook.findFirst({
      where: { id, organizationId: orgId },
      select: { id: true },
    });
    if (!existing) throw new NotFoundException('Webhook not found');

    if (dto.url !== undefined) this.validateUrl(dto.url);
    if (dto.events !== undefined) this.validateEvents(dto.events);

    const row = await this.prisma.publicWebhook.update({
      where: { id },
      data: {
        ...(dto.url !== undefined && { url: dto.url }),
        ...(dto.events !== undefined && { events: dto.events }),
        ...(dto.active !== undefined && { active: dto.active }),
      },
    });
    return this.redact(row);
  }

  async rotateSecret(orgId: string, id: string) {
    const existing = await this.prisma.publicWebhook.findFirst({
      where: { id, organizationId: orgId },
      select: { id: true },
    });
    if (!existing) throw new NotFoundException('Webhook not found');

    const plaintextSecret = this.generateSecret();
    const stored = encrypt(plaintextSecret, this.encKey());

    const row = await this.prisma.publicWebhook.update({
      where: { id },
      data: { secret: stored },
    });
    // ⚠ Plaintext secret returned ONCE.
    return { ...this.redact(row), secret: plaintextSecret };
  }

  async remove(orgId: string, id: string) {
    const existing = await this.prisma.publicWebhook.findFirst({
      where: { id, organizationId: orgId },
      select: { id: true },
    });
    if (!existing) throw new NotFoundException('Webhook not found');
    await this.prisma.publicWebhook.delete({ where: { id } });
    return { id, deleted: true };
  }

  // ─── Deliveries ───────────────────────────────────────────────

  async listDeliveries(
    orgId: string,
    webhookId: string,
    query: { page?: number; limit?: number; succeeded?: boolean },
  ) {
    // Tenant-validate the webhook id (otherwise an attacker who guessed an id
    // could enumerate deliveries by org).
    const wh = await this.prisma.publicWebhook.findFirst({
      where: { id: webhookId, organizationId: orgId },
      select: { id: true },
    });
    if (!wh) throw new NotFoundException('Webhook not found');

    const page = Math.max(1, query.page ?? 1);
    const limit = Math.min(100, Math.max(1, query.limit ?? 25));
    const skip = (page - 1) * limit;

    const where: any = { organizationId: orgId, webhookId };
    if (query.succeeded !== undefined) where.succeeded = query.succeeded;

    const [data, total] = await Promise.all([
      this.prisma.publicWebhookDelivery.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip,
        take: limit,
      }),
      this.prisma.publicWebhookDelivery.count({ where }),
    ]);
    return { data, total, page, limit, totalPages: Math.ceil(total / limit) };
  }

  /**
   * Re-queue a single delivery. Tenant-guards the row to prevent cross-org
   * theft (an admin in org A must not be able to redeliver a row owned by
   * org B even if they guess the id). Also asserts that the delivery
   * belongs to the webhookId in the URL — protects against an attacker who
   * swaps the path's webhookId for one they own to operate on someone
   * else's delivery row.
   */
  async redeliver(orgId: string, webhookId: string, deliveryId: string) {
    const row = await this.prisma.publicWebhookDelivery.findFirst({
      where: { id: deliveryId, organizationId: orgId },
      select: {
        id: true,
        organizationId: true,
        webhookId: true,
        attemptCount: true,
      },
    });
    if (!row) throw new NotFoundException('Delivery not found');
    if (row.webhookId !== webhookId) {
      // Don't disclose existence — 404 to match the unknown-id path.
      throw new NotFoundException('Delivery not found');
    }

    // Reset retry bookkeeping so the worker treats this as a fresh attempt.
    await this.prisma.publicWebhookDelivery.update({
      where: { id: row.id },
      data: {
        succeeded: false,
        nextAttemptAt: new Date(),
        // Don't zero attemptCount — keep the retry-history visible.
      },
    });

    await this.queue.add(
      'deliver',
      { deliveryId: row.id, organizationId: row.organizationId },
      {
        jobId: `redeliver:${row.id}:${Date.now()}`,
        removeOnComplete: 100,
        removeOnFail: 100,
      },
    );

    return { id: row.id, requeued: true };
  }
}
