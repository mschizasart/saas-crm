-- ─────────────────────────────────────────────────────────────
--  Migration: 031 — Field history / audit trail (Wave E2)
--
--  One table: `audit_log`. Every change to every scalar field on a
--  fixed allowlist of entities (Client, Lead, Opportunity, Invoice,
--  Ticket) is recorded with who/when/what changed. Writes are emitted
--  by a Prisma client extension (apps/api/src/modules/audit/
--  audit-extension.ts) so the existing entity services need no
--  modification.
--
--    * audit_log
--        - entityType     : Prisma model name lowercase (e.g. 'client')
--        - entityId       : id of the changed row
--        - action         : 'create' | 'update' | 'delete'
--        - changes        : jsonb. For 'update' = { field: { from, to } };
--                           for 'create'/'delete' = { _all: snapshot }.
--        - changedById    : User.id of the actor (nullable — background
--                           jobs may not have one; the extension skips
--                           the write in that case but the column stays
--                           nullable for future use).
--        - ip             : best-effort capture from the HTTP request.
--        - changedAt      : when the write happened.
--
--  Apply manually on the VPS (we don't run `prisma migrate` in prod):
--      psql "$DATABASE_URL" -f 031-audit-log.sql
--
--  Safe to re-run: uses IF NOT EXISTS everywhere.
--
--  NOTE: deliberately NO RLS policy here. Tenant isolation is enforced
--  in the service layer via explicit `organizationId` filters on every
--  read AND in the extension which only writes rows with the orgId
--  pulled from AsyncLocalStorage (the audit-context interceptor).
-- ─────────────────────────────────────────────────────────────

BEGIN;

CREATE TABLE IF NOT EXISTS "audit_log" (
    "id"             TEXT         PRIMARY KEY DEFAULT gen_random_uuid()::text,
    "organizationId" TEXT         NOT NULL,
    "entityType"     TEXT         NOT NULL,
    "entityId"       TEXT         NOT NULL,
    "action"         TEXT         NOT NULL,
    "changes"        JSONB        NOT NULL DEFAULT '{}'::jsonb,
    "changedById"    TEXT,
    "ip"             TEXT,
    "changedAt"      TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    CONSTRAINT "audit_log_action_check"
        CHECK ("action" IN ('create','update','delete')),
    CONSTRAINT "audit_log_organizationId_fkey"
        FOREIGN KEY ("organizationId")
        REFERENCES "organizations"("id")
        ON DELETE CASCADE
        ON UPDATE CASCADE,
    CONSTRAINT "audit_log_changedById_fkey"
        FOREIGN KEY ("changedById")
        REFERENCES "users"("id")
        ON DELETE SET NULL
        ON UPDATE CASCADE
);

-- Per-entity timeline: the embedded UI on /clients/:id, /leads/:id, etc.
CREATE INDEX IF NOT EXISTS "audit_log_entity_idx"
    ON "audit_log" ("organizationId", "entityType", "entityId", "changedAt" DESC);

-- Org-wide chronological feed (Recent Activity page).
CREATE INDEX IF NOT EXISTS "audit_log_org_recent_idx"
    ON "audit_log" ("organizationId", "changedAt" DESC);

-- "What did this user change?" — admin / compliance view.
CREATE INDEX IF NOT EXISTS "audit_log_org_user_idx"
    ON "audit_log" ("organizationId", "changedById", "changedAt" DESC);

COMMIT;
