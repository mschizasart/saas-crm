-- ─────────────────────────────────────────────────────────────
--  Migration: 005 — einvoice_settings
--  Adds per-organization e-invoice / UBL XML configuration so EU
--  tenants can choose a format (PEPPOL UBL 2.1 / Factur-X /
--  generic UBL) and customize sender / header fields without a
--  code change. EinvoiceService reads from this table when present
--  and falls back to its built-in defaults when absent.
--
--  Apply manually on the VPS (we don't run `prisma migrate` in prod):
--
--      psql "$DATABASE_URL" -f 005-einvoice-settings.sql
--
--  Safe to re-run: uses IF NOT EXISTS / DROP-then-CREATE everywhere.
-- ─────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS "einvoice_settings" (
    "id"                TEXT        PRIMARY KEY DEFAULT gen_random_uuid()::text,
    "organizationId"    TEXT        NOT NULL UNIQUE,
    -- 'PEPPOL_UBL_2_1' | 'FACTUR_X' | 'GENERIC_UBL'
    "format"            TEXT        NOT NULL DEFAULT 'PEPPOL_UBL_2_1',
    "senderId"          TEXT,
    "senderIdScheme"    TEXT,
    "senderName"        TEXT,
    "senderTaxId"       TEXT,
    "senderAddress"     TEXT,
    "senderCity"        TEXT,
    "senderPostcode"    TEXT,
    -- ISO 3166-1 alpha-2
    "senderCountry"     TEXT,
    "defaultCurrency"   TEXT        DEFAULT 'EUR',
    -- UN/CEFACT 4461 payment means code (e.g. '30' = credit transfer)
    "paymentMeansCode"  TEXT        DEFAULT '30',
    "customXmlSnippet"  TEXT,
    "enabled"           BOOLEAN     NOT NULL DEFAULT FALSE,
    "createdAt"         TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"         TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "einvoice_settings_organizationId_fkey"
        FOREIGN KEY ("organizationId")
        REFERENCES "organizations"("id")
        ON DELETE CASCADE
        ON UPDATE CASCADE
);

-- Tenant-lookup index (redundant with UNIQUE but explicit, mirrors 001-email-settings.sql).
CREATE INDEX IF NOT EXISTS "einvoice_settings_organizationId_idx"
    ON "einvoice_settings" ("organizationId");

-- RLS — tenants may only touch their own row. Mirrors the pattern used
-- elsewhere in rls-policies.sql (tenant_isolation policy + app_current_organization_id()).
ALTER TABLE "einvoice_settings" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "einvoice_settings" FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation ON "einvoice_settings";
CREATE POLICY tenant_isolation ON "einvoice_settings"
    USING ("organizationId"::uuid = app_current_organization_id());
