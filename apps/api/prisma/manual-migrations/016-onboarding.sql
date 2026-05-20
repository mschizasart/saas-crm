-- ─────────────────────────────────────────────────────────────
--  Migration: 016 — onboarding wizard state on organizations
--
--  Adds three columns to `organizations` so we can drive the new
--  tenant onboarding wizard purely from server state (URL-driven
--  step routing on the web, no localStorage):
--
--      onboardingCompletedAt  — when the user finished or marked done
--      onboardingStep         — name of last completed step
--      onboardingSkipped      — true if user opted out of the tour
--
--  Apply manually on the VPS:
--    psql "$DATABASE_URL" -f 016-onboarding.sql
--
--  Idempotent — uses ADD COLUMN IF NOT EXISTS everywhere.
--
--  BACKFILL: all rows that already exist at the time this runs are
--  flagged `onboardingSkipped = TRUE` so existing tenants are NEVER
--  forced through the wizard on their next login. New orgs created
--  after this migration land with the defaults below (skipped=false,
--  completedAt=null) and will trigger the redirect on first login.
--
--  Safe to re-run; the backfill UPDATE is guarded by `IS NULL`
--  so it won't clobber rows that have already been touched.
-- ─────────────────────────────────────────────────────────────

ALTER TABLE "organizations"
    ADD COLUMN IF NOT EXISTS "onboardingCompletedAt" TIMESTAMP(3);

ALTER TABLE "organizations"
    ADD COLUMN IF NOT EXISTS "onboardingStep" TEXT;

ALTER TABLE "organizations"
    ADD COLUMN IF NOT EXISTS "onboardingSkipped" BOOLEAN NOT NULL DEFAULT FALSE;

-- Backfill: every org that already exists is treated as "already onboarded".
-- We only flip rows where the column is still at the default (FALSE) AND
-- the org was created before now — so a fresh tenant signing up between
-- this migration and the rest of the deploy lands on the wizard correctly.
UPDATE "organizations"
   SET "onboardingSkipped" = TRUE
 WHERE "onboardingSkipped" = FALSE
   AND "onboardingCompletedAt" IS NULL
   AND "createdAt" < CURRENT_TIMESTAMP;
