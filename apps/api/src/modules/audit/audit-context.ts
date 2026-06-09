import { AsyncLocalStorage } from 'node:async_hooks';

/**
 * Per-request audit context.
 *
 * Populated by `AuditContextInterceptor` on every HTTP request and read
 * by `auditExtension` when it writes an `AuditLog` row. Lives in an
 * `AsyncLocalStorage` so it propagates transparently through `await`
 * boundaries inside services, Prisma extensions, transactions, etc.
 *
 *   • orgId  — the tenant the request resolved to (`request.organization.id`
 *              OR `request.user.orgId`). Used as `AuditLog.organizationId`.
 *   • userId — the actor (`request.user.sub` or `.id`). Used as
 *              `AuditLog.changedById`. Nullable: API-key / system writes
 *              may have no user.
 *   • ip     — best-effort `request.ip`. Cosmetic; nullable.
 *
 * If the store is empty when the extension fires (e.g. a write came from
 * a background job, a scheduled cron, or a unit test), the extension
 * SKIPS the audit row rather than crashing or writing with a null
 * `organizationId`. Background-job auditing is intentionally out of
 * scope for Wave E2.
 */
export interface AuditContext {
  orgId: string | null;
  userId: string | null;
  ip: string | null;
}

export const auditContext = new AsyncLocalStorage<AuditContext>();

/**
 * Wrap a callback so it runs with the given audit context. Anything
 * `await`-ed inside (including Prisma calls that trigger the extension)
 * will see this context via `getAuditContext()`.
 */
export function runWithAuditContext<T>(
  ctx: AuditContext,
  fn: () => T,
): T {
  return auditContext.run(ctx, fn);
}

/**
 * Read the current audit context, or `undefined` if none is active
 * (background jobs, schedulers, tests). The extension treats
 * `undefined` as "skip the audit row".
 */
export function getAuditContext(): AuditContext | undefined {
  return auditContext.getStore();
}
