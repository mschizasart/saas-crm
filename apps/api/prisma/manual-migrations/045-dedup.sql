-- ─────────────────────────────────────────────────────────────
--  Migration: 045 — duplicate detection + record merge
--
--  Adds:
--    leads.mergedIntoId / leads.mergedAt        — soft-merge marker. When a
--    clients.mergedIntoId / clients.mergedAt        lead/client is the LOSER of
--                                                   a merge it is NOT deleted;
--                                                   mergedIntoId points at the
--                                                   surviving winner and mergedAt
--                                                   records when. All default
--                                                   list / kanban / export
--                                                   queries filter
--                                                   `mergedIntoId IS NULL` so
--                                                   losers disappear from the UI.
--                                                   Clients are additionally set
--                                                   active=false on merge.
--    merge_audit                                — one row per completed merge.
--                                                   loserSnapshot (full loser
--                                                   row + counts) + repointCounts
--                                                   ({table: n}) make every merge
--                                                   forensically auditable /
--                                                   reversible.
--
--  Duplicate DETECTION uses pg_trgm similarity() (already installed for the
--  Cmd-K search_index FTS, see migration 012). No new extension is required.
--
--  No RLS — this DB has no `app_current_organization_id()` helper; tenant
--  isolation is enforced in the service layer via prisma.withOrganization()
--  (same as sms / campaigns / sequences / calls).
--
--  Apply manually on the VPS:
--    psql "$DATABASE_URL" -f 045-dedup.sql
--
--  Idempotent — ADD COLUMN / CREATE TABLE / CREATE INDEX IF NOT EXISTS;
--  FK added only if absent.
-- ─────────────────────────────────────────────────────────────

BEGIN;

-- ── leads soft-merge columns ─────────────────────────────────
ALTER TABLE "leads" ADD COLUMN IF NOT EXISTS "mergedIntoId" TEXT;
ALTER TABLE "leads" ADD COLUMN IF NOT EXISTS "mergedAt"     TIMESTAMP(3);

-- ── clients soft-merge columns ───────────────────────────────
ALTER TABLE "clients" ADD COLUMN IF NOT EXISTS "mergedIntoId" TEXT;
ALTER TABLE "clients" ADD COLUMN IF NOT EXISTS "mergedAt"     TIMESTAMP(3);

-- Partial indexes — only merged losers carry a non-null mergedIntoId, so a
-- partial index keeps the index tiny (the common case is `IS NULL`, which
-- the planner can satisfy without this index, but merge-audit lookups
-- ("who did this loser merge into?") hit it).
CREATE INDEX IF NOT EXISTS "leads_merged_into_idx"
    ON "leads" ("mergedIntoId")
    WHERE "mergedIntoId" IS NOT NULL;

CREATE INDEX IF NOT EXISTS "clients_merged_into_idx"
    ON "clients" ("mergedIntoId")
    WHERE "mergedIntoId" IS NOT NULL;

-- ── merge_audit ──────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "merge_audit" (
    "id"               TEXT         PRIMARY KEY DEFAULT gen_random_uuid()::text,
    "organizationId"   TEXT         NOT NULL,
    -- 'lead' | 'client'
    "entityType"       TEXT         NOT NULL,
    "winnerId"         TEXT         NOT NULL,
    "loserId"          TEXT         NOT NULL,
    "mergedById"       TEXT,
    -- full loser row + reference counts captured BEFORE repointing
    "loserSnapshot"    JSONB        NOT NULL,
    -- { table: count } repoint map
    "repointCounts"    JSONB        NOT NULL,
    "createdAt"        TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Per-org audit listing, filterable by entity type.
CREATE INDEX IF NOT EXISTS "merge_audit_org_entity_idx"
    ON "merge_audit" ("organizationId", "entityType");

-- ── Foreign keys (added only if absent) ──────────────────────
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'merge_audit_organizationId_fkey'
    ) THEN
        ALTER TABLE "merge_audit"
            ADD CONSTRAINT "merge_audit_organizationId_fkey"
            FOREIGN KEY ("organizationId") REFERENCES "organizations"("id")
            ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
END $$;

COMMIT;
