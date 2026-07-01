import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
  Optional,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { Type } from 'class-transformer';
import { PrismaService } from '../../database/prisma.service';
import { StorageService } from '../storage/storage.service';
import { CallsConfigService } from './calls-config.service';

/** Body truncation cap for the timeline Activity row (matches capture). */
const BODY_TRUNCATE = 4000;

/**
 * Coarse per-org toll-fraud backstop for click-to-call. The project has no
 * @nestjs/throttler configured, so we cap dials by counting Call rows created
 * in the last 60s. Not a precise rate limiter — just a cheap ceiling to blunt
 * a compromised/abusive account before it racks up a telephony bill.
 */
const MAX_DIALS_PER_MINUTE = 20;
const DIAL_WINDOW_MS = 60_000;

// ─── DTOs ───────────────────────────────────────────────────────

export class LogCallDto {
  @IsOptional()
  @IsIn(['lead', 'client'])
  relType?: 'lead' | 'client';

  @IsOptional()
  @IsString()
  relId?: string;

  @IsOptional()
  @IsIn(['outbound', 'inbound'])
  direction?: 'outbound' | 'inbound';

  @IsString()
  @MaxLength(40)
  @Matches(/^\+?[0-9]{7,15}$/, { message: 'Invalid phone number' })
  toNumber!: string;

  @IsOptional()
  @IsString()
  @MaxLength(40)
  fromNumber?: string;

  @IsOptional()
  @IsIn([
    'connected',
    'voicemail',
    'no_answer',
    'busy',
    'wrong_number',
    'callback_requested',
  ])
  outcome?: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(86400)
  durationSeconds?: number;

  @IsOptional()
  @IsString()
  @MaxLength(10000)
  notes?: string;

  @IsOptional()
  @IsString()
  occurredAt?: string;
}

export class UpdateCallDto {
  @IsOptional()
  @IsIn([
    'connected',
    'voicemail',
    'no_answer',
    'busy',
    'wrong_number',
    'callback_requested',
  ])
  outcome?: string;

  @IsOptional()
  @IsString()
  @MaxLength(10000)
  notes?: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(86400)
  durationSeconds?: number;
}

export class DialDto {
  @IsOptional()
  @IsIn(['lead', 'client'])
  relType?: 'lead' | 'client';

  @IsOptional()
  @IsString()
  relId?: string;

  @IsString()
  @MaxLength(40)
  @Matches(/^\+?[0-9]{7,15}$/, { message: 'Invalid phone number' })
  toNumber!: string;

  @IsOptional()
  @IsString()
  @MaxLength(40)
  @Matches(/^\+?[0-9]{7,15}$/, { message: 'Invalid phone number' })
  agentNumber?: string;
}

export class ListCallsQueryDto {
  @IsOptional()
  @IsIn(['lead', 'client'])
  relType?: 'lead' | 'client';

  @IsOptional()
  @IsString()
  relId?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(200)
  limit?: number;
}

/**
 * Built-in calling + call logging (migration 044).
 *
 * Two capabilities share the `calls` table:
 *   (A) Call logging — staff record a call after the fact (status='logged').
 *   (B) Click-to-call — an outbound Twilio call bridging agent → customer;
 *       status/recording driven by the public webhooks.
 *
 * Tenant isolation is service-layer (prisma.withOrganization + organizationId
 * in every where) — same as sms / campaigns / sequences.
 *
 * When a call is LOGGED or a click-to-call COMPLETES we write an `activities`
 * row (type 'call') pinned to the lead/client so it shows on the record's
 * timeline — reusing the Activity model the Wave-H2 capture pipeline writes to.
 */
@Injectable()
export class CallsService {
  private readonly logger = new Logger(CallsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    private readonly callsConfig: CallsConfigService,
    @Optional() private readonly storage?: StorageService,
  ) {}

  // ─── List ─────────────────────────────────────────────────────

  async list(orgId: string, query: ListCallsQueryDto) {
    const page = Math.max(1, Number(query.page) || 1);
    const limit = Math.min(200, Math.max(1, Number(query.limit) || 25));

    const where: Record<string, any> = { organizationId: orgId };
    if (query.relType) where.relType = query.relType;
    if (query.relId) where.relId = query.relId;

    const [data, total] = await this.prisma.withOrganization(orgId, (tx) =>
      Promise.all([
        tx.call.findMany({
          where,
          orderBy: { occurredAt: 'desc' },
          skip: (page - 1) * limit,
          take: limit,
        }),
        tx.call.count({ where }),
      ]),
    );

    return {
      data,
      total,
      page,
      limit,
      totalPages: Math.max(1, Math.ceil(total / limit)),
    };
  }

  // ─── Log a call ───────────────────────────────────────────────

  async logCall(orgId: string, dto: LogCallDto, userId?: string) {
    const toNumber = (dto.toNumber ?? '').trim();
    if (!toNumber) throw new BadRequestException('toNumber is required');
    if ((dto.relType && !dto.relId) || (!dto.relType && dto.relId)) {
      throw new BadRequestException(
        'relType and relId must be provided together',
      );
    }

    const occurredAt = dto.occurredAt ? new Date(dto.occurredAt) : new Date();

    const call = await this.prisma.withOrganization(orgId, async (tx) => {
      await this.assertRelatedRecord(tx, orgId, dto.relType, dto.relId);
      return tx.call.create({
        data: {
          organizationId: orgId,
          relType: dto.relType ?? null,
          relId: dto.relId ?? null,
          direction: dto.direction ?? 'outbound',
          toNumber,
          fromNumber: dto.fromNumber?.trim() || null,
          status: 'logged',
          outcome: dto.outcome ?? null,
          durationSeconds: dto.durationSeconds ?? 0,
          notes: dto.notes ?? null,
          loggedById: userId ?? null,
          occurredAt: isNaN(occurredAt.getTime()) ? new Date() : occurredAt,
        },
      });
    });

    await this.writeTimelineActivity(orgId, call);
    return call;
  }

  // ─── Get / Update / Delete ────────────────────────────────────

  async findOne(orgId: string, id: string) {
    const call = await this.prisma.withOrganization(orgId, (tx) =>
      tx.call.findFirst({ where: { id, organizationId: orgId } }),
    );
    if (!call) throw new NotFoundException('Call not found');
    return call;
  }

  async update(orgId: string, id: string, dto: UpdateCallDto) {
    await this.findOne(orgId, id);
    const data: Record<string, any> = {};
    if (dto.outcome !== undefined) data.outcome = dto.outcome;
    if (dto.notes !== undefined) data.notes = dto.notes;
    if (dto.durationSeconds !== undefined)
      data.durationSeconds = dto.durationSeconds;

    return this.prisma.withOrganization(orgId, (tx) =>
      tx.call.update({ where: { id }, data }),
    );
  }

  async remove(orgId: string, id: string) {
    await this.findOne(orgId, id);
    await this.prisma.withOrganization(orgId, (tx) =>
      tx.call.delete({ where: { id } }),
    );
  }

  // ─── Settings (for the UI to show/hide click-to-call) ─────────

  async settings(orgId: string) {
    const resolved = await this.callsConfig.resolveTwilio(orgId);
    return {
      configured: resolved.source !== 'none',
      fromNumber: resolved.fromNumber,
      source: resolved.source,
    };
  }

  // ─── Click-to-call ────────────────────────────────────────────

  async dial(
    orgId: string,
    orgSlug: string,
    dto: DialDto,
    user: any,
  ): Promise<{ callId: string; status: string }> {
    const toNumber = (dto.toNumber ?? '').trim();
    if (!toNumber) throw new BadRequestException('toNumber is required');
    if ((dto.relType && !dto.relId) || (!dto.relType && dto.relId)) {
      throw new BadRequestException(
        'relType and relId must be provided together',
      );
    }

    const agentNumber =
      dto.agentNumber?.trim() ||
      (user?.phone as string | undefined)?.trim() ||
      (user?.phoneMobile as string | undefined)?.trim() ||
      '';
    if (!agentNumber) {
      throw new BadRequestException(
        'No agent number — provide agentNumber or set a phone on your profile',
      );
    }

    // Validate the related record (if any) and enforce the toll-fraud rate
    // limit BEFORE placing the Twilio call — otherwise an abusive request
    // would still incur a billed call leg.
    await this.prisma.withOrganization(orgId, async (tx) => {
      await this.assertRelatedRecord(tx, orgId, dto.relType, dto.relId);

      const recentDials = await tx.call.count({
        where: {
          organizationId: orgId,
          createdAt: { gte: new Date(Date.now() - DIAL_WINDOW_MS) },
        },
      });
      if (recentDials >= MAX_DIALS_PER_MINUTE) {
        throw new BadRequestException(
          'Dial rate limit exceeded, try again shortly',
        );
      }
    });

    const creds = await this.callsConfig.resolveTwilio(orgId);
    if (creds.source === 'none' || !creds.fromNumber) {
      throw new BadRequestException('Telephony not configured');
    }

    const base = this.webhookBase();
    const twimlUrl = `${base}/api/v1/public/calls/twiml/${orgSlug}?to=${encodeURIComponent(
      toNumber,
    )}`;
    const statusUrl = `${base}/api/v1/public/calls/status/${orgSlug}`;

    let sid: string | null = null;
    try {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const twilio = require('twilio');
      const client = twilio(creds.accountSid, creds.authToken);
      const call = await client.calls.create({
        to: agentNumber,
        from: creds.fromNumber,
        url: twimlUrl,
        statusCallback: statusUrl,
        statusCallbackEvent: [
          'initiated',
          'ringing',
          'answered',
          'completed',
        ],
        statusCallbackMethod: 'POST',
      });
      sid = call.sid;
    } catch (e) {
      this.logger.error(
        `Twilio click-to-call failed for org ${orgId}: ${(e as Error).message}`,
      );
      throw new BadRequestException(
        `Failed to initiate call: ${(e as Error).message}`,
      );
    }

    const row = await this.prisma.withOrganization(orgId, (tx) =>
      tx.call.create({
        data: {
          organizationId: orgId,
          relType: dto.relType ?? null,
          relId: dto.relId ?? null,
          direction: 'outbound',
          toNumber,
          fromNumber: creds.fromNumber,
          status: 'queued',
          twilioCallSid: sid,
          loggedById: user?.id ?? null,
        },
        select: { id: true, status: true },
      }),
    );

    return { callId: row.id, status: row.status };
  }

  // ─── Webhook handlers (called by the public controller) ───────

  /**
   * Twilio status callback. Maps the Twilio CallStatus to our status and
   * records the duration. Writes the timeline Activity on 'completed'.
   * Never throws on a missing row — the public controller returns 200.
   */
  async handleStatusCallback(
    orgId: string,
    body: Record<string, string>,
  ): Promise<void> {
    const sid = body?.CallSid;
    if (!sid) return;

    const call = await this.prisma.withOrganization(orgId, (tx) =>
      tx.call.findFirst({
        where: { organizationId: orgId, twilioCallSid: sid },
      }),
    );
    if (!call) {
      this.logger.warn(
        `Status callback for unknown CallSid ${sid} (org ${orgId})`,
      );
      return;
    }

    const status = this.mapTwilioStatus(body?.CallStatus);
    const duration = parseInt(body?.CallDuration ?? '', 10);

    const data: Record<string, any> = {};
    if (status) data.status = status;
    if (!isNaN(duration)) data.durationSeconds = duration;

    const updated = await this.prisma.withOrganization(orgId, (tx) =>
      tx.call.update({ where: { id: call.id }, data }),
    );

    if (status === 'completed') {
      await this.writeTimelineActivity(orgId, updated);
    }
  }

  /**
   * Twilio recording callback. Attempts to download the recording and store
   * it via StorageService; on failure falls back to persisting Twilio's
   * RecordingUrl + RecordingSid. Never throws on a missing row.
   */
  async handleRecordingCallback(
    orgId: string,
    body: Record<string, string>,
  ): Promise<void> {
    const sid = body?.CallSid;
    if (!sid) return;

    const call = await this.prisma.withOrganization(orgId, (tx) =>
      tx.call.findFirst({
        where: { organizationId: orgId, twilioCallSid: sid },
      }),
    );
    if (!call) {
      this.logger.warn(
        `Recording callback for unknown CallSid ${sid} (org ${orgId})`,
      );
      return;
    }

    const recordingUrl = body?.RecordingUrl ?? null;
    const recordingSid = body?.RecordingSid ?? null;
    const recordingDuration = parseInt(body?.RecordingDuration ?? '', 10);

    let storedPath: string | null = null;
    let storedUrl: string | null = recordingUrl;

    // Best-effort download + store. Twilio recording URLs are auth-protected
    // (basic auth = accountSid:authToken). If anything fails we keep the raw
    // Twilio URL so the recording is still reachable.
    if (recordingUrl && this.storage) {
      try {
        const creds = await this.callsConfig.resolveTwilio(orgId);
        const headers: Record<string, string> = {};
        if (creds.accountSid && creds.authToken) {
          const basic = Buffer.from(
            `${creds.accountSid}:${creds.authToken}`,
          ).toString('base64');
          headers.Authorization = `Basic ${basic}`;
        }
        const res = await fetch(`${recordingUrl}.mp3`, { headers });
        if (res.ok) {
          const buf = Buffer.from(await res.arrayBuffer());
          const filename = `${recordingSid || call.id}.mp3`;
          const { path } = await this.storage.uploadFile(
            orgId,
            'call-recordings',
            filename,
            buf,
            'audio/mpeg',
          );
          storedPath = path;
          storedUrl = await this.storage.getSignedUrl(orgId, path);
        }
      } catch (e) {
        this.logger.warn(
          `Recording download/store failed for call ${call.id}: ${(e as Error).message}`,
        );
      }
    }

    const data: Record<string, any> = {
      recordingUrl: storedUrl,
      recordingPath: storedPath ?? recordingSid,
    };
    if (!isNaN(recordingDuration) && recordingDuration > 0 && !call.durationSeconds) {
      data.durationSeconds = recordingDuration;
    }

    await this.prisma.withOrganization(orgId, (tx) =>
      tx.call.update({ where: { id: call.id }, data }),
    );
  }

  // ─── Internal helpers ─────────────────────────────────────────

  /**
   * Verify a relType/relId pair references a record that exists in THIS org
   * before we pin a call/timeline activity to it. Prevents attaching calls to
   * another tenant's (or a non-existent) lead/client. No-op when unpinned.
   */
  private async assertRelatedRecord(
    tx: any,
    orgId: string,
    relType: 'lead' | 'client' | undefined,
    relId: string | undefined,
  ): Promise<void> {
    if (!relType || !relId) return;
    const where = { id: relId, organizationId: orgId };
    const found =
      relType === 'lead'
        ? await tx.lead.findFirst({ where })
        : await tx.client.findFirst({ where });
    if (!found) {
      throw new NotFoundException('Related record not found in this organization');
    }
  }

  /**
   * Map a Twilio CallStatus to our `calls.status` vocabulary. Twilio's set is
   * queued | ringing | in-progress | completed | busy | no-answer | failed |
   * canceled | initiated — all of which we accept verbatim.
   */
  private mapTwilioStatus(s: string | undefined): string | null {
    if (!s) return null;
    const allowed = new Set([
      'queued',
      'initiated',
      'ringing',
      'in-progress',
      'completed',
      'busy',
      'no-answer',
      'failed',
      'canceled',
    ]);
    return allowed.has(s) ? s : null;
  }

  /**
   * Build the public-webhook base URL the same way the SMS module does:
   * SMS_WEBHOOK_BASE_URL → APP_URL → FRONTEND_URL. The path (/api/v1/...) is
   * appended by the caller.
   */
  private webhookBase(): string {
    const explicit =
      this.config.get<string>('SMS_WEBHOOK_BASE_URL') ||
      this.config.get<string>('APP_URL') ||
      this.config.get<string>('FRONTEND_URL') ||
      '';
    return explicit.replace(/\/+$/, '');
  }

  /**
   * Write an `activities` (type 'call') row pinned to the lead/client so the
   * call shows on the record's timeline. No-op when the call isn't pinned to a
   * record. Best-effort — never blocks the call flow.
   */
  private async writeTimelineActivity(orgId: string, call: any): Promise<void> {
    if (!call?.relType || !call?.relId) return;
    const summaryParts: string[] = [];
    if (call.outcome) summaryParts.push(`Outcome: ${call.outcome}`);
    if (call.notes) summaryParts.push(call.notes);
    const body = summaryParts.join(' — ').slice(0, BODY_TRUNCATE) || null;

    try {
      await this.prisma.withOrganization(orgId, (tx) =>
        tx.activity.create({
          data: {
            organizationId: orgId,
            type: 'call',
            channel: 'phone',
            direction: call.direction ?? 'outbound',
            subject:
              call.direction === 'inbound'
                ? `Inbound call from ${call.fromNumber ?? call.toNumber}`
                : `Outbound call to ${call.toNumber}`,
            body,
            relatedToType: call.relType,
            relatedToId: call.relId,
            occurredAt: call.occurredAt ?? new Date(),
          },
        }),
      );
    } catch (e) {
      this.logger.warn(
        `Failed to write call timeline activity for call ${call?.id}: ${(e as Error).message}`,
      );
    }
  }
}
