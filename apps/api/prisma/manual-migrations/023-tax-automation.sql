-- ─────────────────────────────────────────────────────────────
--  Migration: 023 — tax automation (TaxJar / Avalara)
--  Adds per-organization automatic sales-tax / VAT configuration so each
--  tenant can plug in a TaxJar or Avalara account and have tax computed
--  automatically on invoices/estimates instead of (or alongside) the
--  existing manual tax rates (taxes table + tax1/tax2 on line items).
--
--  This is an OPT-IN layer. With provider = 'NONE' (the default) or
--  enabled = false, nothing changes — manual taxes keep working exactly
--  as before.
--
--  Apply manually on the VPS (we don't run `prisma migrate` in prod):
--
--    psql "$DATABASE_URL" -f 023-tax-automation.sql
--
--  Safe to re-run: uses IF NOT EXISTS everywhere.
--
--  NOTE: deliberately NO RLS policy here — app_current_organization_id()
--  is not defined on this database (same situation as email_settings /
--  ai_settings / einvoice_settings). Tenant isolation is enforced in the
--  service layer via prisma.withOrganization(orgId, …).
-- ─────────────────────────────────────────────────────────────

-- ── tax_settings (one row per org) ────────────────────────────
CREATE TABLE IF NOT EXISTS "tax_settings" (
    "id"                  TEXT         PRIMARY KEY DEFAULT gen_random_uuid()::text,
    "organizationId"      TEXT         NOT NULL UNIQUE,
    -- NONE | TAXJAR | AVALARA
    "provider"            TEXT         NOT NULL DEFAULT 'NONE',
    -- AES-256-GCM encrypted (iv:tag:cipher hex) — never returned raw.
    -- TaxJar: API token. Avalara: license key.
    "apiKey"              TEXT,
    -- Avalara needs account id + license (apiKey) + company code.
    "avalaraAccountId"    TEXT,
    "avalaraCompanyCode"  TEXT,
    -- Origin / nexus address the tenant ships/bills FROM.
    -- Shape: { street, city, state, zip, country }
    "originAddress"       JSONB,
    "enabled"             BOOLEAN      NOT NULL DEFAULT FALSE,
    -- false = manual "Calculate tax" button; true = auto-calc on every save.
    "autoApply"           BOOLEAN      NOT NULL DEFAULT FALSE,
    "lastTestedAt"        TIMESTAMP(3),
    "lastTestError"       TEXT,
    "createdAt"           TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"           TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "tax_settings_organizationId_fkey"
        FOREIGN KEY ("organizationId")
        REFERENCES "organizations"("id")
        ON DELETE CASCADE
        ON UPDATE CASCADE
);

-- Index to accelerate tenant lookups (redundant with UNIQUE but explicit).
CREATE INDEX IF NOT EXISTS "tax_settings_organizationId_idx"
    ON "tax_settings" ("organizationId");

-- ── tax_calculations (audit / cache) ──────────────────────────
CREATE TABLE IF NOT EXISTS "tax_calculations" (
    "id"              TEXT          PRIMARY KEY DEFAULT gen_random_uuid()::text,
    "organizationId"  TEXT          NOT NULL,
    -- 'invoice' | 'estimate'
    "entityType"      TEXT          NOT NULL,
    "entityId"        TEXT          NOT NULL,
    -- NONE | TAXJAR | AVALARA
    "provider"        TEXT          NOT NULL,
    "taxableAmount"   DECIMAL(15,2) NOT NULL,
    "taxAmount"       DECIMAL(15,2) NOT NULL,
    -- Effective combined rate as a percentage, e.g. 8.8750.
    "rate"            DECIMAL(7,4)  NOT NULL,
    -- Raw jurisdiction breakdown from the provider.
    "breakdown"       JSONB,
    "calculatedAt"    TIMESTAMP(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "tax_calculations_organizationId_fkey"
        FOREIGN KEY ("organizationId")
        REFERENCES "organizations"("id")
        ON DELETE CASCADE
        ON UPDATE CASCADE
);

CREATE INDEX IF NOT EXISTS "tax_calculations_org_entity_idx"
    ON "tax_calculations" ("organizationId", "entityType", "entityId");
