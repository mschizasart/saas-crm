import { ForbiddenException, Injectable, Logger, Optional } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { PrismaService } from '../../database/prisma.service';
import { decrypt, encrypt, isEncrypted } from '../../common/crypto/encrypt';

/**
 * Per-tenant Twilio SMS configuration + send/log brain.
 *
 * Mirrors EmailSettingsService / AiConfigService exactly:
 *   - encrypt-on-write  (authToken → AES-256-GCM, ENCRYPTION_KEY env)
 *   - redact-on-read    (authToken → authTokenSet boolean)
 *   - resolveConfig     (decrypt + assemble usable Twilio creds)
 *   - sendTest          (friendly {ok,error?,sid?} instead of throwing)
 *
 * We use the official `twilio` npm SDK (already a dependency, ^5.x). It is
 * loaded lazily via require() inside the call sites so the module still boots
 * if the package is somehow absent in a given environment — the same defensive
 * pattern the legacy event-driven SmsService used.
 *
 * Credentials are PER-TENANT only. There is an OPTIONAL platform-env fallback
 * (TWILIO_ACCOUNT_SID / TWILIO_AUTH_TOKEN / TWILIO_FROM_NUMBER) preserved for
 * the legacy notification SmsService, but the per-record send flow
 * (/sms/send) deliberately requires the org to configure its own credentials —
 * it does NOT silently bill the platform's Twilio account.
 */

export type SmsProvider = 'TWILIO';

export interface UpsertSmsSettingsDto {
  provider?: SmsProvider;
  accountSid?: string | null;
  /** Plaintext — encrypted before storage. Omit = unchanged, null = clear, string = set. */
  authToken?: string | null;
  fromNumber?: string | null;
  enabled?: boolean;
}

/** Shape returned to clients — never includes the decrypted auth token. */
export interface SmsSettingsResponse {
  provider: SmsProvider;
  accountSid: string | null;
  authTokenSet: boolean;
  fromNumber: string | null;
  enabled: boolean;
  updatedAt: string | null;
}

export interface ResolvedSmsConfig {
  accountSid: string;
  authToken: string;
  fromNumber: string;
  source: 'org' | 'platform-env';
}

export interface SmsSendResult {
  ok: boolean;
  error?: string;
  sid?: string;
}

@Injectable()
export class SmsConfigService {
  private readonly logger = new Logger(SmsConfigService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    // Wave H2 — Einstein Activity Capture observes
    // `sms.outbound.sent` / `sms.inbound.received` to log SMS to the
    // timeline. Optional so unit tests still boot.
    @Optional() private readonly events?: EventEmitter2,
  ) {}

  private encKey(): string | undefined {
    return this.config.get<string>('ENCRYPTION_KEY');
  }

  /** Redact the auth token before returning over the wire. */
  private toResponse(row: any): SmsSettingsResponse {
    return {
      provider: (row?.provider ?? 'TWILIO') as SmsProvider,
      accountSid: row?.accountSid ?? null,
      authTokenSet: !!row?.authToken,
      fromNumber: row?.fromNumber ?? null,
      enabled: !!row?.enabled,
      updatedAt: row?.updatedAt ? new Date(row.updatedAt).toISOString() : null,
    };
  }

  async getForOrg(orgId: string): Promise<SmsSettingsResponse> {
    const row = await this.prisma.withOrganization(orgId, (tx) =>
      tx.smsSettings.findUnique({ where: { organizationId: orgId } }),
    );
    return this.toResponse(row);
  }

  async upsert(
    orgId: string,
    dto: UpsertSmsSettingsDto,
  ): Promise<SmsSettingsResponse> {
    const provider: SmsProvider = dto.provider ?? 'TWILIO';

    // Build encrypted authToken only if the caller supplied a new plaintext.
    // `null` explicitly clears; `undefined` means "no change".
    let tokenUpdate: { authToken?: string | null } = {};
    if (dto.authToken === null) {
      tokenUpdate = { authToken: null };
    } else if (
      typeof dto.authToken === 'string' &&
      dto.authToken.trim().length > 0
    ) {
      tokenUpdate = { authToken: encrypt(dto.authToken.trim(), this.encKey()) };
    }

    const data: Record<string, any> = {
      provider,
      ...tokenUpdate,
    };
    if (dto.accountSid !== undefined)
      data.accountSid = dto.accountSid?.trim() || null;
    if (dto.fromNumber !== undefined)
      data.fromNumber = dto.fromNumber?.trim() || null;
    if (dto.enabled !== undefined) data.enabled = dto.enabled;

    const row = await this.prisma.withOrganization(orgId, (tx) =>
      tx.smsSettings.upsert({
        where: { organizationId: orgId },
        create: {
          organizationId: orgId,
          provider,
          accountSid: data.accountSid ?? null,
          authToken: tokenUpdate.authToken ?? null,
          fromNumber: data.fromNumber ?? null,
          enabled: data.enabled ?? false,
        },
        update: data,
      }),
    );
    return this.toResponse(row);
  }

  /**
   * Resolve usable Twilio credentials for an org. Returns null when neither
   * the org nor the platform-env fallback has complete credentials.
   *
   * Pass `requireEnabled = false` to resolve even when the org toggle is off
   * (used by the "send test" flow so a tenant can verify before enabling).
   */
  async resolveConfig(
    orgId: string,
    requireEnabled = true,
  ): Promise<ResolvedSmsConfig | null> {
    const row = await this.prisma.withOrganization(orgId, (tx) =>
      tx.smsSettings.findUnique({ where: { organizationId: orgId } }),
    );

    if (row && row.accountSid && row.authToken && row.fromNumber) {
      if (requireEnabled && !row.enabled) return null;
      let token = '';
      try {
        token = isEncrypted(row.authToken)
          ? decrypt(row.authToken, this.encKey())
          : row.authToken;
      } catch (e) {
        this.logger.error(
          `Failed to decrypt Twilio auth token for org ${orgId}: ${(e as Error).message}`,
        );
        return null;
      }
      return {
        accountSid: row.accountSid,
        authToken: token,
        fromNumber: row.fromNumber,
        source: 'org',
      };
    }

    // Optional platform-env fallback (used by the legacy notification flow).
    const envSid = this.config.get<string>('TWILIO_ACCOUNT_SID');
    const envToken = this.config.get<string>('TWILIO_AUTH_TOKEN');
    const envFrom = this.config.get<string>('TWILIO_FROM_NUMBER');
    if (envSid && envToken && envFrom) {
      return {
        accountSid: envSid,
        authToken: envToken,
        fromNumber: envFrom,
        source: 'platform-env',
      };
    }

    return null;
  }

  /**
   * Look up the decrypted auth token for an org's *saved* settings. Used by the
   * inbound webhook to validate the Twilio request signature. Returns null when
   * the org has no saved token.
   */
  async getAuthTokenForOrg(orgId: string): Promise<string | null> {
    const row = await this.prisma.withOrganization(orgId, (tx) =>
      tx.smsSettings.findUnique({
        where: { organizationId: orgId },
        select: { authToken: true },
      }),
    );
    if (!row?.authToken) return null;
    try {
      return isEncrypted(row.authToken)
        ? decrypt(row.authToken, this.encKey())
        : row.authToken;
    } catch (e) {
      this.logger.error(
        `Failed to decrypt Twilio auth token for org ${orgId}: ${(e as Error).message}`,
      );
      return null;
    }
  }

  /**
   * Low-level send via the Twilio REST API using the supplied creds.
   * Returns the friendly result object; never throws.
   */
  private async twilioSend(
    cfg: ResolvedSmsConfig,
    to: string,
    body: string,
  ): Promise<SmsSendResult> {
    try {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const twilio = require('twilio');
      const client = twilio(cfg.accountSid, cfg.authToken);
      const msg = await client.messages.create({
        from: cfg.fromNumber,
        to,
        body,
      });
      return { ok: true, sid: msg.sid };
    } catch (e) {
      const msg = (e as Error).message || 'Unknown Twilio error';
      this.logger.warn(`SMS send to ${to} failed: ${msg}`);
      return { ok: false, error: msg };
    }
  }

  /**
   * Send an SMS for the given org and log an outbound SmsMessage row.
   * Resolves the org's saved Twilio creds (enabled required). Logs both
   * success and failure so the thread reflects what happened.
   */
  async sendForOrg(
    orgId: string,
    params: {
      to: string;
      body: string;
      entityType?: string | null;
      entityId?: string | null;
      sentById?: string | null;
    },
  ): Promise<SmsSendResult> {
    const to = params.to?.trim();
    const body = params.body ?? '';
    if (!to) return { ok: false, error: 'Recipient number is required' };
    if (!body.trim()) return { ok: false, error: 'Message body is required' };

    const cfg = await this.resolveConfig(orgId, true);
    if (!cfg) {
      return {
        ok: false,
        error:
          'SMS is not configured or not enabled for this organization. Configure Twilio in Settings → SMS.',
      };
    }

    // Per-record/tenant send MUST use the org's OWN Twilio credentials. If
    // resolveConfig fell back to the platform-env creds (incomplete tenant
    // config), refuse rather than silently billing the platform account. The
    // legacy notification SmsService keeps the platform-env fallback; this
    // path does not.
    if (cfg.source !== 'org') {
      return {
        ok: false,
        error:
          'SMS is not configured for this organization. Configure Twilio in Settings → SMS.',
      };
    }

    const result = await this.twilioSend(cfg, to, body);

    // Capture the created row id so Wave H2 can fire
    // `sms.outbound.sent` with a stable pointer for capture-log dedup.
    let smsMessageId: string | undefined;
    try {
      const created = await this.prisma.withOrganization(orgId, (tx) =>
        tx.smsMessage.create({
          data: {
            organizationId: orgId,
            direction: 'outbound',
            entityType: params.entityType ?? null,
            entityId: params.entityId ?? null,
            toNumber: to,
            fromNumber: cfg.fromNumber,
            body,
            status: result.ok ? 'sent' : 'failed',
            providerSid: result.sid ?? null,
            errorMessage: result.error ?? null,
            sentById: params.sentById ?? null,
          },
          select: { id: true, createdAt: true },
        }),
      );
      smsMessageId = created.id;
      // Wave H2 — fire-and-forget for Activity Capture. Emit for both
      // success AND failure: a failed outbound SMS still belongs on
      // the customer's timeline as "we tried to text you".
      if (smsMessageId && this.events) {
        this.events.emit('sms.outbound.sent', {
          orgId,
          smsMessageId,
          toNumber: to,
          body,
          createdAt: created.createdAt ?? new Date(),
        });
      }
    } catch (e) {
      this.logger.error(
        `Failed to log outbound SMS for org ${orgId}: ${(e as Error).message}`,
      );
    }

    return result;
  }

  /**
   * Send a probe SMS using either the org's saved config OR a caller-provided
   * override (so a tenant can test BEFORE saving). Does not log to the thread.
   */
  async sendTest(
    orgId: string,
    to: string,
    override?: UpsertSmsSettingsDto,
  ): Promise<SmsSendResult> {
    if (!to || !/^\+?[0-9]{7,15}$/.test(to.replace(/[\s()-]/g, ''))) {
      return { ok: false, error: 'Recipient number is invalid (use E.164, e.g. +14155551234)' };
    }

    let cfg: ResolvedSmsConfig | null = null;

    // Use the override only when SID + From are both provided. The auth token
    // may be omitted from the override (the UI doesn't echo the saved one back
    // for editing) — in that case we fall back to the org's saved, decrypted
    // token so "Send test" works without re-typing the secret.
    if (override && override.accountSid && override.fromNumber) {
      const token = override.authToken || (await this.getAuthTokenForOrg(orgId));
      if (token) {
        cfg = {
          accountSid: override.accountSid,
          authToken: token,
          fromNumber: override.fromNumber,
          source: 'org',
        };
      } else {
        // No override token and none saved — fall back to full resolution
        // (which also covers the optional platform-env fallback).
        cfg = await this.resolveConfig(orgId, false);
      }
    } else {
      cfg = await this.resolveConfig(orgId, false);
    }

    if (!cfg) {
      return {
        ok: false,
        error:
          'No usable Twilio credentials. Provide Account SID, Auth Token and From number.',
      };
    }

    return this.twilioSend(cfg, to, `CRM SMS test (${cfg.source}). It works!`);
  }

  /**
   * Map an SMS thread's polymorphic entityType to its RBAC resource so we can
   * gate read access by `<resource>.view`. Reading a record's SMS thread is
   * reading the record, so it must match the entity's view permission (a staff
   * member with only leads.edit must NOT read a ticket's thread).
   */
  private threadResource(entityType: string): string {
    switch (entityType) {
      case 'ticket':
        return 'tickets';
      case 'client':
        return 'clients';
      case 'lead':
      default:
        return 'leads';
    }
  }

  /**
   * Assert the caller may VIEW the given entity's SMS thread. Replicates the
   * RbacGuard / DocumentsService resolution: super-admin + portal-contact
   * bypass (handled upstream by RbacGuard for this staff route), then role
   * permissions overlaid with per-user overrides, against `<resource>.view`.
   */
  private async assertCanViewThread(
    user: any,
    entityType: string,
  ): Promise<void> {
    if (user?.isAdmin) return;
    if (user?.type === 'contact') return;

    const permission = `${this.threadResource(entityType)}.view`;
    const [resource, action] = permission.split('.');

    const rolePermissions: Record<string, Record<string, boolean>> =
      user?.role?.permissions || {};
    const roleHas = rolePermissions?.[resource]?.[action] === true;

    let overrideGrant: boolean | undefined;
    if (user?.id) {
      try {
        const override = await (
          this.prisma as any
        ).userPermissionOverride.findFirst({
          where: { userId: user.id, permission },
          select: { grant: true },
        });
        if (override) overrideGrant = override.grant;
      } catch {
        overrideGrant = undefined;
      }
    }

    const allowed = overrideGrant !== undefined ? overrideGrant : roleHas;
    if (!allowed) {
      throw new ForbiddenException(`Missing permission: ${permission}`);
    }
  }

  /**
   * List the SMS thread for a CRM record (both directions), chronological.
   * Gated by the entity's `<resource>.view` permission so thread access
   * matches the record's read permission.
   */
  async thread(
    orgId: string,
    entityType: string,
    entityId: string,
    user: any,
  ): Promise<any[]> {
    await this.assertCanViewThread(user, entityType);
    return this.prisma.withOrganization(orgId, (tx) =>
      tx.smsMessage.findMany({
        where: { organizationId: orgId, entityType, entityId },
        orderBy: { createdAt: 'asc' },
      }),
    );
  }

  /**
   * Persist an inbound SMS (called by the public webhook). Attempts to attach
   * it to a known lead/client by matching the sender's phone number.
   */
  async logInbound(
    orgId: string,
    params: {
      from: string;
      to: string;
      body: string;
      providerSid?: string | null;
    },
  ): Promise<void> {
    const { entityType, entityId } = await this.matchEntityByPhone(
      orgId,
      params.from,
    );

    const created = await this.prisma.withOrganization(orgId, (tx) =>
      tx.smsMessage.create({
        data: {
          organizationId: orgId,
          direction: 'inbound',
          entityType,
          entityId,
          toNumber: params.to,
          fromNumber: params.from,
          body: params.body ?? '',
          status: 'received',
          providerSid: params.providerSid ?? null,
        },
        select: { id: true, createdAt: true },
      }),
    );

    // Wave H2 — emit for Activity Capture. The matcher inside
    // SmsConfigService is per-record (lead vs client) and may differ
    // from the capture pipeline's per-Contact resolution — that's
    // fine, both timelines coexist.
    if (created?.id && this.events) {
      this.events.emit('sms.inbound.received', {
        orgId,
        smsMessageId: created.id,
        fromNumber: params.from,
        body: params.body ?? '',
        createdAt: created.createdAt ?? new Date(),
      });
    }
  }

  /**
   * Best-effort match of a phone number to a CRM record. Tries leads first,
   * then clients. Uses a suffix match on the last 8 digits to tolerate
   * formatting differences (E.164 vs local). Returns nulls when nothing
   * matches — the inbound message is still logged, just unattached.
   */
  private async matchEntityByPhone(
    orgId: string,
    phone: string,
  ): Promise<{ entityType: string | null; entityId: string | null }> {
    const digits = (phone || '').replace(/[^0-9]/g, '');
    if (digits.length < 7) return { entityType: null, entityId: null };
    const suffix = digits.slice(-8);

    return this.prisma.withOrganization(orgId, async (tx) => {
      const lead = await tx.lead.findFirst({
        where: {
          organizationId: orgId,
          phone: { contains: suffix },
        },
        select: { id: true },
        orderBy: { createdAt: 'desc' },
      });
      if (lead) return { entityType: 'lead', entityId: lead.id };

      const client = await tx.client.findFirst({
        where: {
          organizationId: orgId,
          phone: { contains: suffix },
        },
        select: { id: true },
        orderBy: { createdAt: 'desc' },
      });
      if (client) return { entityType: 'client', entityId: client.id };

      return { entityType: null, entityId: null };
    });
  }
}
