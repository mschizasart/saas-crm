import { Module } from '@nestjs/common';
import { AuditController } from './audit.controller';
import { AuditService } from './audit.service';

/**
 * Field history / audit trail (Wave E2).
 *
 *  • AuditService     — read-side: per-entity timeline, org-wide feed,
 *                       and per-user list. All scoped to organizationId.
 *  • AuditController  — GET /audit/entity, /audit/feed, /audit/by-user.
 *                       All gated by the `audit.view` permission.
 *
 * Writes are produced automatically by `auditExtension` attached to the
 * global PrismaService — see apps/api/src/modules/audit/audit-extension.ts
 * and the one-line attach in apps/api/src/database/prisma.service.ts.
 * Per-request actor + IP come from `AuditContextInterceptor`, registered
 * globally in app.module.ts.
 *
 * PrismaService is supplied by the global DatabaseModule (no explicit
 * import needed — same pattern as the other Wave D modules).
 */
@Module({
  controllers: [AuditController],
  providers: [AuditService],
  exports: [AuditService],
})
export class AuditModule {}
