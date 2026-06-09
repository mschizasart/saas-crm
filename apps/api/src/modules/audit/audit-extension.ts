import { Prisma } from '@prisma/client';
import { getAuditContext } from './audit-context';

/**
 * Prisma client extension that captures `create` / `update` / `delete`
 * on a fixed allowlist of models and writes one `AuditLog` row per
 * operation. The extension is attached once to the global PrismaService
 * in apps/api/src/database/prisma.service.ts; no entity service code
 * needs to change to be audited.
 *
 * Design notes
 * ────────────
 * • AUDITED_MODELS is the Prisma model name lowercase ('client', 'lead',
 *   …). Adding another model to this list is the only step needed to
 *   audit it — no schema change, no per-entity wiring.
 *
 * • Tenant scoping: every write reads `orgId` from the AsyncLocalStorage
 *   AuditContext set by `AuditContextInterceptor`. If the context is
 *   missing or carries a null orgId (background jobs, scheduled crons,
 *   unit tests), we SKIP the audit row rather than write with a null
 *   organizationId. This is intentional — auditing background writes
 *   is out of scope for Wave E2.
 *
 * • Diff strategy for `update`:
 *     - Fetch the BEFORE row via `findUnique({ where: args.where })`.
 *       Same `where` the user passed, so the before/after correspond
 *       1:1 even when the row was matched by a non-id unique key.
 *     - Run the update.
 *     - Shallow scalar diff: compare top-level keys, skip relations
 *       (objects/arrays), skip the `updatedAt`/`updated_at` columns
 *       (they would always differ and add no signal).
 *     - If no scalar fields actually changed → skip the audit row.
 *
 * • For `create` / `delete` we snapshot the row's scalar columns under
 *   `changes._all` (relations stripped). The delete fetch uses the same
 *   `where` so we capture what we're about to remove.
 *
 * • `updateMany` / `deleteMany` / `createMany` deliberately fall through
 *   without auditing — those would require iterating and re-running
 *   queries, often defeating their batch advantage. Tracked as TODO.
 *
 * • Size cap: `changes` jsonb is capped at ~MAX_CHANGES_BYTES (10KB).
 *   If a serialized row blows past that, each value is replaced with
 *   the string '[truncated]' so we keep field NAMES but drop values.
 *   Prevents pathologically large rows (large notes, big jsonb blobs).
 */

const AUDITED_MODELS = [
  'client',
  'lead',
  'opportunity',
  'invoice',
  'ticket',
] as const;

type AuditedModel = (typeof AUDITED_MODELS)[number];

// AUDITED_SET must never contain 'auditlog' — would cause infinite recursion
// because writeAuditRow itself calls auditLog.create through the extended
// client and would re-enter the create hook.
const AUDITED_SET = new Set<string>(AUDITED_MODELS);

/** Columns we never want to diff on. */
const IGNORED_DIFF_FIELDS = new Set<string>([
  'updatedAt',
  'updated_at',
]);

const MAX_CHANGES_BYTES = 10_000;

// ─────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────

/**
 * Strip relations and other non-scalar properties so the audit row only
 * holds primitive field values. Dates are serialized to ISO strings.
 */
function scalarSnapshot(row: unknown): Record<string, unknown> {
  if (!row || typeof row !== 'object') return {};
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(row as Record<string, unknown>)) {
    if (v === null || v === undefined) {
      out[k] = v ?? null;
      continue;
    }
    if (v instanceof Date) {
      out[k] = v.toISOString();
      continue;
    }
    const t = typeof v;
    if (t === 'string' || t === 'number' || t === 'boolean' || t === 'bigint') {
      // bigint isn't valid JSON — coerce to string.
      out[k] = t === 'bigint' ? String(v) : v;
      continue;
    }
    // Decimal (Prisma.Decimal) and similar objects expose toString().
    if (t === 'object' && typeof (v as { toString?: unknown }).toString === 'function'
        && !Array.isArray(v)
        && (v as object).constructor?.name === 'Decimal') {
      out[k] = (v as { toString: () => string }).toString();
      continue;
    }
    // Everything else (objects, arrays, jsonb) is treated as a relation
    // or jsonb blob and skipped per the diff policy.
  }
  return out;
}

/**
 * Compare two scalar snapshots and return only the changed keys.
 * Returns `null` if nothing scalar changed (caller should skip the write).
 */
function diffScalars(
  before: Record<string, unknown>,
  after: Record<string, unknown>,
): Record<string, { from: unknown; to: unknown }> | null {
  const changes: Record<string, { from: unknown; to: unknown }> = {};
  const keys = new Set([...Object.keys(before), ...Object.keys(after)]);
  for (const k of keys) {
    if (IGNORED_DIFF_FIELDS.has(k)) continue;
    const a = before[k];
    const b = after[k];
    // Loose equality on primitives via JSON.stringify is sufficient
    // since we already stripped to scalars + ISO strings.
    if (JSON.stringify(a) !== JSON.stringify(b)) {
      changes[k] = { from: a ?? null, to: b ?? null };
    }
  }
  return Object.keys(changes).length === 0 ? null : changes;
}

/**
 * Cap the serialized size of the `changes` payload. If over the budget,
 * replace every value with the string '[truncated]' so we keep the field
 * names (still useful for "what changed?") but drop the values.
 */
function capChangesSize(payload: unknown): unknown {
  try {
    const json = JSON.stringify(payload);
    if (json.length <= MAX_CHANGES_BYTES) return payload;
  } catch {
    // Fall through — circular refs etc. — return a sentinel.
    return { _truncated: true };
  }

  // Best-effort truncation depending on shape.
  if (payload && typeof payload === 'object') {
    const obj = payload as Record<string, unknown>;
    // Update-style: { field: { from, to } }
    const truncated: Record<string, unknown> = {};
    for (const k of Object.keys(obj)) {
      truncated[k] = '[truncated]';
    }
    return truncated;
  }
  return '[truncated]';
}

/**
 * Resolve the model's delegate on the inner client returned by `query`.
 * We need a plain delegate for the "fetch BEFORE" lookup; using the
 * extended client would re-enter the extension and recurse.
 *
 * NOTE (Wave E2.2 known-issue): `client` here is the outer
 * (non-transaction-scoped) extended client captured in the extension
 * closure, so the BEFORE-image findUnique runs on a separate connection
 * from any in-flight transaction. Under high concurrency the captured
 * 'before' may be slightly stale. Acceptable for current scale and given
 * the MAJOR 1 caveat (audit hooks don't fire inside `$transaction` in
 * Prisma 6 anyway — see prisma.service.ts withOrganization).
 */
function getDelegate(client: any, model: string): any {
  // Prisma model keys on the client are camelCase; AUDITED_MODELS already
  // are camelCase ('client', 'lead', …) so a direct lookup works.
  return client?.[model];
}

// ─────────────────────────────────────────────────────────────────────
// Extension
// ─────────────────────────────────────────────────────────────────────

export const auditExtension = Prisma.defineExtension((client) => {
  return client.$extends({
    name: 'audit-trail',
    query: {
      $allModels: {
        async create({ model, args, query }) {
          // Hard recursion guard: never let the audit-log writer re-enter
          // this hook via the extended client. See AUDITED_SET note above.
          if (model === 'AuditLog' || model === 'auditLog') return query(args);
          const lower = model.toLowerCase();
          if (!AUDITED_SET.has(lower)) return query(args);
          const result = await query(args);
          await writeAuditRow(client, {
            entityType: lower,
            entityId: (result as any)?.id,
            action: 'create',
            snapshot: scalarSnapshot(result),
          });
          return result;
        },

        async update({ model, args, query }) {
          // Hard recursion guard (see create hook for rationale).
          if (model === 'AuditLog' || model === 'auditLog') return query(args);
          const lower = model.toLowerCase();
          if (!AUDITED_SET.has(lower)) {
            return query(args);
          }

          const ctx = getAuditContext();
          // Cheap escape hatch: if there's no context we won't write an
          // audit row anyway, so skip the extra BEFORE query.
          if (!ctx || !ctx.orgId) {
            return query(args);
          }

          const delegate = getDelegate(client, lower);
          let before: unknown = null;
          try {
            before = await delegate.findUnique({ where: args.where });
          } catch {
            // If the where isn't a unique selector (rare for our callers),
            // fall back to findFirst.
            try {
              before = await delegate.findFirst({ where: args.where });
            } catch {
              before = null;
            }
          }

          const after = await query(args);

          const beforeScalars = scalarSnapshot(before);
          const afterScalars  = scalarSnapshot(after);
          const diff = diffScalars(beforeScalars, afterScalars);
          if (!diff) return after; // nothing scalar changed → skip

          await writeAuditRow(client, {
            entityType: lower,
            entityId: (after as any)?.id ?? (before as any)?.id,
            action: 'update',
            snapshot: diff,
          });
          return after;
        },

        async delete({ model, args, query }) {
          // Hard recursion guard (see create hook for rationale).
          if (model === 'AuditLog' || model === 'auditLog') return query(args);
          const lower = model.toLowerCase();
          if (!AUDITED_SET.has(lower)) {
            return query(args);
          }

          const ctx = getAuditContext();
          if (!ctx || !ctx.orgId) {
            return query(args);
          }

          // Fetch BEFORE the delete using the SAME where so we capture
          // exactly what's about to be removed.
          const delegate = getDelegate(client, lower);
          let before: unknown = null;
          try {
            before = await delegate.findUnique({ where: args.where });
          } catch {
            try {
              before = await delegate.findFirst({ where: args.where });
            } catch {
              before = null;
            }
          }

          const result = await query(args);

          await writeAuditRow(client, {
            entityType: lower,
            entityId: (before as any)?.id ?? (result as any)?.id,
            action: 'delete',
            snapshot: scalarSnapshot(before ?? result),
          });
          return result;
        },

        // *Many variants intentionally not audited — TODO Wave E2.1: iterate
        // before+after for createMany / updateMany / deleteMany.
        // We do NOT wrap them so the underlying batch query is untouched.
      },
    },
  });
});

// ─────────────────────────────────────────────────────────────────────
// Audit row writer
// ─────────────────────────────────────────────────────────────────────

interface AuditWritePayload {
  entityType: string;
  entityId: string | undefined;
  action: 'create' | 'update' | 'delete';
  /**
   * For update: { field: { from, to }, … }
   * For create/delete: { ...scalar snapshot } (wrapped under `_all`).
   */
  snapshot: Record<string, unknown>;
}

async function writeAuditRow(
  client: any,
  payload: AuditWritePayload,
): Promise<void> {
  const ctx = getAuditContext();
  if (!ctx || !ctx.orgId) return; // background-job write — skip
  if (!payload.entityId) return;  // can't audit something we can't reference

  const changes =
    payload.action === 'update'
      ? capChangesSize(payload.snapshot)
      : capChangesSize({ _all: payload.snapshot });

  try {
    await client.auditLog.create({
      data: {
        organizationId: ctx.orgId,
        entityType: payload.entityType,
        entityId: payload.entityId,
        action: payload.action,
        changes: changes as Prisma.InputJsonValue,
        changedById: ctx.userId,
        ip: ctx.ip,
      },
    });
  } catch {
    // Auditing is best-effort: a failure here MUST NOT roll back the
    // user-facing operation. Swallow the error; the entity write has
    // already committed by this point anyway.
  }
}
