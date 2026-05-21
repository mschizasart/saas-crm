-- ─────────────────────────────────────────────────────────────
--  Migration: 020 — white-label per-tenant branding
--
--  Adds branding columns to `organizations` so each tenant can theme
--  the admin UI, client portal and public pages with its own colors,
--  logo, favicon and an optional email footer.
--
--      brandPrimaryColor  — hex accent/primary (e.g. #3B82F6)
--      brandSidebarColor  — hex sidebar background (falls back to dark)
--      brandFaviconUrl    — optional favicon URL
--      brandEmailFooter   — optional HTML/text appended to outgoing mail
--      whiteLabelEnabled  — master toggle; FALSE → platform defaults
--
--  NOTE: the existing `logo` column is REUSED as the brand logo. There
--  is intentionally NO `brandLogoUrl` column — the API/UI read `logo`.
--
--  Apply manually on the VPS:
--    psql "$DATABASE_URL" -f 020-branding.sql
--
--  Idempotent — uses ADD COLUMN IF NOT EXISTS everywhere. No RLS.
--  Safe to re-run. Existing tenants keep platform defaults
--  (whiteLabelEnabled = FALSE) until they opt in via Settings → Branding.
-- ─────────────────────────────────────────────────────────────

ALTER TABLE "organizations"
    ADD COLUMN IF NOT EXISTS "brandPrimaryColor" TEXT;

ALTER TABLE "organizations"
    ADD COLUMN IF NOT EXISTS "brandSidebarColor" TEXT;

ALTER TABLE "organizations"
    ADD COLUMN IF NOT EXISTS "brandFaviconUrl" TEXT;

ALTER TABLE "organizations"
    ADD COLUMN IF NOT EXISTS "brandEmailFooter" TEXT;

ALTER TABLE "organizations"
    ADD COLUMN IF NOT EXISTS "whiteLabelEnabled" BOOLEAN NOT NULL DEFAULT FALSE;
