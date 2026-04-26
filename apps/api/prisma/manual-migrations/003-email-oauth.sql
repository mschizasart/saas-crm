-- ─────────────────────────────────────────────────────────────
--  Migration: 003 — email_settings OAuth 2.0 columns
--
--  Adds Gmail / Microsoft OAuth fields to the existing
--  email_settings table. The `provider` column stays TEXT so
--  no enum alteration is needed — the API does a runtime check
--  against {'SMTP','PLATFORM_DEFAULT','GMAIL_OAUTH','MICROSOFT_OAUTH'}.
--
--  Apply manually on the VPS:
--
--      psql "$DATABASE_URL" -f 003-email-oauth.sql
--
--  Safe to re-run: uses IF NOT EXISTS on every ADD COLUMN.
-- ─────────────────────────────────────────────────────────────

ALTER TABLE "email_settings"
    ADD COLUMN IF NOT EXISTS "oauthRefreshToken"    TEXT;

ALTER TABLE "email_settings"
    ADD COLUMN IF NOT EXISTS "oauthAccessToken"     TEXT;

ALTER TABLE "email_settings"
    ADD COLUMN IF NOT EXISTS "oauthTokenExpiresAt"  TIMESTAMP(3);

ALTER TABLE "email_settings"
    ADD COLUMN IF NOT EXISTS "oauthConnectedEmail"  TEXT;

ALTER TABLE "email_settings"
    ADD COLUMN IF NOT EXISTS "oauthConnectedAt"     TIMESTAMP(3);

-- No index needed: all OAuth columns are accessed via the existing
-- (organizationId) unique key. RLS already inherited from 001.
