-- ─────────────────────────────────────────────────────────────
--  Migration: 015 — ai_settings
--  Adds per-organization AI provider / API-key configuration so each
--  tenant can bring their own Anthropic OR OpenAI key instead of the
--  platform subsidising everyone's token spend.
--  Apply manually on the VPS (we don't run `prisma migrate` in prod).
--
--    psql "$DATABASE_URL" -f 015-ai-settings.sql
--
--  Safe to re-run: uses IF NOT EXISTS everywhere.
--
--  NOTE: deliberately NO RLS policy here — app_current_organization_id()
--  is not defined on this database (same situation as email_settings).
--  Tenant isolation is enforced in the service layer via
--  prisma.withOrganization(orgId, …).
-- ─────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS "ai_settings" (
    "id"                   TEXT         PRIMARY KEY DEFAULT gen_random_uuid()::text,
    "organizationId"       TEXT         NOT NULL UNIQUE,
    -- ANTHROPIC | OPENAI | PLATFORM_DEFAULT
    "provider"             TEXT         NOT NULL DEFAULT 'PLATFORM_DEFAULT',
    -- AES-256-GCM encrypted (iv:tag:cipher hex) — never returned raw
    "apiKey"               TEXT,
    "model"                TEXT,
    "enabled"              BOOLEAN      NOT NULL DEFAULT TRUE,
    "monthlyTokenCap"      INTEGER,
    "tokensUsedThisMonth"  INTEGER      NOT NULL DEFAULT 0,
    "usageResetAt"         TIMESTAMP(3),
    "lastTestedAt"         TIMESTAMP(3),
    "lastTestError"        TEXT,
    "createdAt"            TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"            TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ai_settings_organizationId_fkey"
        FOREIGN KEY ("organizationId")
        REFERENCES "organizations"("id")
        ON DELETE CASCADE
        ON UPDATE CASCADE
);

-- Index to accelerate tenant lookups (redundant with UNIQUE but explicit).
CREATE INDEX IF NOT EXISTS "ai_settings_organizationId_idx"
    ON "ai_settings" ("organizationId");
