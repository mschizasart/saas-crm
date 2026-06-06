-- ─────────────────────────────────────────────────────────────
--  Migration: 027 — Opportunities (deal pipeline + weighted forecast)
--
--  Salesforce-style opportunities with a per-org configurable stage
--  pipeline. Each opportunity carries a monetary `amount` and a
--  `closeDate`; the stage row carries a `probability` (0-100). The
--  weighted forecast is sum(amount * probability/100) over open deals.
--
--  Tables:
--    opportunity_stages          — ordered, configurable pipeline columns
--    opportunities               — the deal itself
--    opportunity_stage_history   — audit log: every stage transition
--
--  Tenant isolation: enforced at the service layer via
--  prisma.withOrganization() — this DB does NOT have the
--  `app_current_organization_id()` helper so no RLS policies here.
--
--  Apply manually on the VPS:
--    psql "$DATABASE_URL" -f 027-opportunities.sql
--
--  Idempotent — CREATE TABLE / INDEX IF NOT EXISTS; FKs added only
--  if absent; the default-stage backfill skips orgs that already have
--  stages.
-- ─────────────────────────────────────────────────────────────

BEGIN;

-- ── opportunity_stages ───────────────────────────────────────
CREATE TABLE IF NOT EXISTS "opportunity_stages" (
    "id"             TEXT          PRIMARY KEY DEFAULT gen_random_uuid()::text,
    "organizationId" TEXT          NOT NULL,
    "name"           TEXT          NOT NULL,
    "order"          INTEGER       NOT NULL DEFAULT 0,
    -- 0.00 … 100.00 — used to weight the forecast.
    "probability"    NUMERIC(5, 2) NOT NULL DEFAULT 0,
    "isWon"          BOOLEAN       NOT NULL DEFAULT FALSE,
    "isLost"         BOOLEAN       NOT NULL DEFAULT FALSE,
    "createdAt"      TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);

-- One row per (org, stage name) — keeps the seed/backfill idempotent.
CREATE UNIQUE INDEX IF NOT EXISTS "opportunity_stages_org_name_key"
    ON "opportunity_stages" ("organizationId", "name");

CREATE INDEX IF NOT EXISTS "opportunity_stages_org_order_idx"
    ON "opportunity_stages" ("organizationId", "order");

-- ── opportunities ────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "opportunities" (
    "id"             TEXT           PRIMARY KEY DEFAULT gen_random_uuid()::text,
    "organizationId" TEXT           NOT NULL,
    "name"           TEXT           NOT NULL,
    "clientId"       TEXT,
    "leadId"         TEXT,
    "ownerId"        TEXT           NOT NULL,
    "stageId"        TEXT           NOT NULL,
    "amount"         NUMERIC(15, 2) NOT NULL DEFAULT 0,
    "currency"       TEXT           NOT NULL DEFAULT 'USD',
    "closeDate"      DATE           NOT NULL,
    "description"    TEXT,
    "source"         TEXT,
    "createdAt"      TIMESTAMPTZ    NOT NULL DEFAULT NOW(),
    "updatedAt"      TIMESTAMPTZ    NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS "opportunities_org_stage_idx"
    ON "opportunities" ("organizationId", "stageId");

CREATE INDEX IF NOT EXISTS "opportunities_org_owner_idx"
    ON "opportunities" ("organizationId", "ownerId");

CREATE INDEX IF NOT EXISTS "opportunities_org_close_date_idx"
    ON "opportunities" ("organizationId", "closeDate");

-- ── opportunity_stage_history ────────────────────────────────
CREATE TABLE IF NOT EXISTS "opportunity_stage_history" (
    "id"             TEXT        PRIMARY KEY DEFAULT gen_random_uuid()::text,
    "organizationId" TEXT        NOT NULL,
    "opportunityId"  TEXT        NOT NULL,
    "fromStageId"    TEXT,
    "toStageId"      TEXT        NOT NULL,
    "changedById"    TEXT        NOT NULL,
    "changedAt"      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS "opportunity_stage_history_opp_idx"
    ON "opportunity_stage_history" ("opportunityId", "changedAt" DESC);

CREATE INDEX IF NOT EXISTS "opportunity_stage_history_org_idx"
    ON "opportunity_stage_history" ("organizationId");

-- ── Foreign keys (added only if absent) ──────────────────────
DO $$
BEGIN
    -- opportunity_stages -> organizations
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'opportunity_stages_organizationId_fkey'
    ) THEN
        ALTER TABLE "opportunity_stages"
            ADD CONSTRAINT "opportunity_stages_organizationId_fkey"
            FOREIGN KEY ("organizationId") REFERENCES "organizations"("id")
            ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;

    -- opportunities -> organizations
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'opportunities_organizationId_fkey'
    ) THEN
        ALTER TABLE "opportunities"
            ADD CONSTRAINT "opportunities_organizationId_fkey"
            FOREIGN KEY ("organizationId") REFERENCES "organizations"("id")
            ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;

    -- opportunities -> clients (SET NULL — keep deal if client deleted)
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'opportunities_clientId_fkey'
    ) THEN
        ALTER TABLE "opportunities"
            ADD CONSTRAINT "opportunities_clientId_fkey"
            FOREIGN KEY ("clientId") REFERENCES "clients"("id")
            ON DELETE SET NULL ON UPDATE CASCADE;
    END IF;

    -- opportunities -> leads (SET NULL — keep deal if lead deleted)
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'opportunities_leadId_fkey'
    ) THEN
        ALTER TABLE "opportunities"
            ADD CONSTRAINT "opportunities_leadId_fkey"
            FOREIGN KEY ("leadId") REFERENCES "leads"("id")
            ON DELETE SET NULL ON UPDATE CASCADE;
    END IF;

    -- opportunities -> users (owner) — RESTRICT keeps data hygiene
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'opportunities_ownerId_fkey'
    ) THEN
        ALTER TABLE "opportunities"
            ADD CONSTRAINT "opportunities_ownerId_fkey"
            FOREIGN KEY ("ownerId") REFERENCES "users"("id")
            ON DELETE RESTRICT ON UPDATE CASCADE;
    END IF;

    -- opportunities -> opportunity_stages (RESTRICT: stage delete refused while in use)
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'opportunities_stageId_fkey'
    ) THEN
        ALTER TABLE "opportunities"
            ADD CONSTRAINT "opportunities_stageId_fkey"
            FOREIGN KEY ("stageId") REFERENCES "opportunity_stages"("id")
            ON DELETE RESTRICT ON UPDATE CASCADE;
    END IF;

    -- opportunity_stage_history -> organizations
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'opportunity_stage_history_organizationId_fkey'
    ) THEN
        ALTER TABLE "opportunity_stage_history"
            ADD CONSTRAINT "opportunity_stage_history_organizationId_fkey"
            FOREIGN KEY ("organizationId") REFERENCES "organizations"("id")
            ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;

    -- opportunity_stage_history -> opportunities
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'opportunity_stage_history_opportunityId_fkey'
    ) THEN
        ALTER TABLE "opportunity_stage_history"
            ADD CONSTRAINT "opportunity_stage_history_opportunityId_fkey"
            FOREIGN KEY ("opportunityId") REFERENCES "opportunities"("id")
            ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;

    -- opportunity_stage_history -> users (changed by)
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'opportunity_stage_history_changedById_fkey'
    ) THEN
        ALTER TABLE "opportunity_stage_history"
            ADD CONSTRAINT "opportunity_stage_history_changedById_fkey"
            FOREIGN KEY ("changedById") REFERENCES "users"("id")
            ON DELETE RESTRICT ON UPDATE CASCADE;
    END IF;
END $$;

-- ── Backfill: default 6-stage pipeline for every existing org ──
-- Each org that has ZERO opportunity_stages today gets the canonical
-- Prospecting → Qualified → Proposal → Negotiation → Closed Won /
-- Closed Lost pipeline seeded. ON CONFLICT (organizationId, name)
-- makes this safe to re-run after a partial apply.
DO $$
DECLARE
    org RECORD;
BEGIN
    FOR org IN
        SELECT o."id"
        FROM "organizations" o
        WHERE NOT EXISTS (
            SELECT 1 FROM "opportunity_stages" s WHERE s."organizationId" = o."id"
        )
    LOOP
        INSERT INTO "opportunity_stages"
            ("organizationId", "name", "order", "probability", "isWon", "isLost")
        VALUES
            (org."id", 'Prospecting',  1,  20.00, FALSE, FALSE),
            (org."id", 'Qualified',    2,  40.00, FALSE, FALSE),
            (org."id", 'Proposal',     3,  60.00, FALSE, FALSE),
            (org."id", 'Negotiation',  4,  80.00, FALSE, FALSE),
            (org."id", 'Closed Won',   5, 100.00, TRUE,  FALSE),
            (org."id", 'Closed Lost',  6,   0.00, FALSE, TRUE)
        ON CONFLICT ("organizationId", "name") DO NOTHING;
    END LOOP;
END $$;

COMMIT;
