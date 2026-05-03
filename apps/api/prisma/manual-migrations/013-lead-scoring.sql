-- ─────────────────────────────────────────────────────────────
--  Migration: 013 — AI-powered lead scoring
--
--  Adds three columns + one index on the existing `leads` table:
--    * score           — 0-100 composite (heuristic + AI). Null
--                        means "not yet scored"; the BullMQ
--                        'lead-scoring' queue fills it asynchronously
--                        on lead.created / lead.updated /
--                        inbox.routed-to-lead.
--    * scoreReason     — short human-readable explanation produced
--                        by lead-scoring.service.ts (under ~250 chars).
--    * scoreUpdatedAt  — used both for the UI "last updated" stamp
--                        AND as a freshness guard (we skip recompute
--                        if updated within the last 6 hours and no
--                        underlying signal changed — see service).
--
--  Index `leads_org_score_desc_idx` powers the "Hottest first" sort
--  on the leads list page and any future "needs attention" reports.
--  NULLS LAST keeps unscored leads at the bottom rather than the top
--  (Postgres default treats NULL as larger than any value in DESC).
--
--  Apply manually on the VPS:
--      psql "$DATABASE_URL" -f 013-lead-scoring.sql
--
--  Safe to re-run: every statement uses IF NOT EXISTS.
-- ─────────────────────────────────────────────────────────────

-- ── 1. New columns on leads ──────────────────────────────────
ALTER TABLE "leads"
    ADD COLUMN IF NOT EXISTS "score"          INTEGER;
ALTER TABLE "leads"
    ADD COLUMN IF NOT EXISTS "scoreReason"    TEXT;
ALTER TABLE "leads"
    ADD COLUMN IF NOT EXISTS "scoreUpdatedAt" TIMESTAMP(3);

-- ── 2. Sanity constraint (0-100) ─────────────────────────────
-- Only added if missing; the application clamps before write but a
-- DB-level guard catches any future code path that forgets to.
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
         WHERE conname = 'leads_score_range_chk'
    ) THEN
        ALTER TABLE "leads"
            ADD CONSTRAINT "leads_score_range_chk"
            CHECK ("score" IS NULL OR ("score" >= 0 AND "score" <= 100));
    END IF;
END$$;

-- ── 3. "Hot leads" sort index ────────────────────────────────
-- Postgres treats NULL > any value in DESC ordering; NULLS LAST
-- ensures unscored leads sink to the bottom of "hottest first" lists.
CREATE INDEX IF NOT EXISTS "leads_org_score_desc_idx"
    ON "leads" ("organizationId", "score" DESC NULLS LAST);
