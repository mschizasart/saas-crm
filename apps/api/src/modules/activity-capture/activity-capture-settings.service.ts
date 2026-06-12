import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service';
import { UpdateSettingsDto } from './activity-capture.dto';

/**
 * Per-org capture toggles (Wave H2).
 *
 * Backed by `activity_capture_settings`. The row is created lazily on
 * first read with the migration's defaults baked in so the listener
 * pipeline never has to short-circuit on "no row yet". Every read /
 * write is scoped by `organizationId` — there is no RLS, the service
 * layer is the only tenant boundary.
 */
@Injectable()
export class ActivityCaptureSettingsService {
  constructor(private prisma: PrismaService) {}

  /**
   * Fetch settings for an org, materialising defaults on first call.
   *
   * Uses upsert with empty `update: {}` so two parallel readers don't
   * race a second `create` — the second call no-ops and returns the
   * existing row. Migration defaults (email/sms ON, internal OFF) are
   * the source of truth; we don't repeat them in `create` so a future
   * default change only touches the SQL.
   */
  async get(orgId: string) {
    return this.prisma.withOrganization(orgId, (tx) =>
      tx.activityCaptureSettings.upsert({
        where: { organizationId: orgId },
        // Empty update so a parallel-read race resolves to "no-op"
        // rather than blasting the row with stale defaults.
        update: {},
        create: { organizationId: orgId },
      }),
    );
  }

  /**
   * Update one or more toggles. Defense-in-depth: the WHERE pins
   * `organizationId` so a buggy caller passing somebody else's org id
   * cannot cross-tenant-update.
   *
   * The PUT is upsert-shaped so a tenant that has never read settings
   * can still PUT a fresh row without a separate "init" call.
   */
  async update(orgId: string, dto: UpdateSettingsDto) {
    const data: Record<string, unknown> = {};
    if (dto.emailCaptureEnabled !== undefined)
      data.emailCaptureEnabled = dto.emailCaptureEnabled;
    if (dto.smsCaptureEnabled !== undefined)
      data.smsCaptureEnabled = dto.smsCaptureEnabled;
    if (dto.captureInternalEmails !== undefined)
      data.captureInternalEmails = dto.captureInternalEmails;

    return this.prisma.withOrganization(orgId, (tx) =>
      tx.activityCaptureSettings.upsert({
        where: { organizationId: orgId },
        update: data,
        create: {
          organizationId: orgId,
          ...data,
        },
      }),
    );
  }
}
