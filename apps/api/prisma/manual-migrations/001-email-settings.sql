-- ─────────────────────────────────────────────────────────────
--  Migration: 001 — email_settings
--  Adds per-organization SMTP / sender configuration.
--  Apply manually on the VPS (we don't run `prisma migrate` in prod).
--
--    psql "$DATABASE_URL" -f 001-email-settings.sql
--
--  Safe to re-run: uses IF NOT EXISTS everywhere.
-- ─────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS "email_settings" (
    "id"              TEXT        PRIMARY KEY DEFAULT gen_random_uuid()::text,
    "organizationId"  TEXT        NOT NULL UNIQUE,
    "provider"        TEXT        NOT NULL DEFAULT 'PLATFORM_DEFAULT',
    "smtpHost"        TEXT,
    "smtpPort"        INTEGER,
    "smtpUser"        TEXT,
    "smtpPassword"    TEXT,
    "smtpSecure"      BOOLEAN     NOT NULL DEFAULT FALSE,
    "fromName"        TEXT,
    "fromEmail"       TEXT,
    "replyToEmail"    TEXT,
    "createdAt"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "email_settings_organizationId_fkey"
        FOREIGN KEY ("organizationId")
        REFERENCES "organizations"("id")
        ON DELETE CASCADE
        ON UPDATE CASCADE
);

-- Index to accelerate tenant lookups (redundant with UNIQUE but explicit).
CREATE INDEX IF NOT EXISTS "email_settings_organizationId_idx"
    ON "email_settings" ("organizationId");

-- RLS — tenants may only touch their own row. Mirrors the pattern used
-- elsewhere in rls-policies.sql (tenant_isolation policy + app_current_organization_id()).
ALTER TABLE "email_settings" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "email_settings" FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation ON "email_settings";
CREATE POLICY tenant_isolation ON "email_settings"
    USING ("organizationId"::uuid = app_current_organization_id());
