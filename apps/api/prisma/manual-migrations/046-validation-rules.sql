-- ─────────────────────────────────────────────────────────────
--  Migration: 046 — validation rules (Salesforce-style save guards)
--
--  Adds:
--    validation_rules                           — one row per admin-defined
--                                                 save-time validation rule.
--                                                 fieldTo names the entity
--                                                 ('lead' | 'client', extensible).
--                                                 `conditions` is a JSONB array of
--                                                 { field, operator, value? } clauses
--                                                 combined with `conditionLogic`
--                                                 ('AND' | 'OR'). When the combined
--                                                 condition evaluates TRUE for the
--                                                 record being saved, the save is
--                                                 BLOCKED and `errorMessage` is
--                                                 returned. All active rules for an
--                                                 entity are evaluated and every
--                                                 violated message is surfaced.
--
--                                                 `field` may reference a custom
--                                                 field via a `cf:<slug>` prefix,
--                                                 resolved against the record's
--                                                 custom-field values at evaluation.
--
--  No RLS — this DB has no `app_current_organization_id()` helper; tenant
--  isolation is enforced in the service layer via prisma.withOrganization()
--  (same as sms / campaigns / sequences / calls / dedup).
--
--  Apply manually on the VPS:
--    psql "$DATABASE_URL" -f 046-validation-rules.sql
--
--  Idempotent — CREATE TABLE / CREATE INDEX IF NOT EXISTS; FK added only if
--  absent.
-- ─────────────────────────────────────────────────────────────

BEGIN;

-- ── validation_rules ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "validation_rules" (
    "id"               TEXT         PRIMARY KEY DEFAULT gen_random_uuid()::text,
    "organizationId"   TEXT         NOT NULL,
    -- 'lead' | 'client' (extensible)
    "fieldTo"          TEXT         NOT NULL,
    "name"             TEXT         NOT NULL,
    "description"      TEXT,
    -- 'AND' | 'OR' across the conditions array
    "conditionLogic"   TEXT         NOT NULL DEFAULT 'AND',
    -- array of { field, operator, value? }
    "conditions"       JSONB        NOT NULL DEFAULT '[]',
    "errorMessage"     TEXT         NOT NULL,
    "active"           BOOLEAN      NOT NULL DEFAULT true,
    "order"            INTEGER      NOT NULL DEFAULT 0,
    "createdAt"        TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"        TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Per-org rule listing, filterable by entity type.
CREATE INDEX IF NOT EXISTS "validation_rules_org_fieldto_idx"
    ON "validation_rules" ("organizationId", "fieldTo");

-- ── Foreign keys (added only if absent) ──────────────────────
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'validation_rules_organizationId_fkey'
    ) THEN
        ALTER TABLE "validation_rules"
            ADD CONSTRAINT "validation_rules_organizationId_fkey"
            FOREIGN KEY ("organizationId") REFERENCES "organizations"("id")
            ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
END $$;

COMMIT;
