-- ─────────────────────────────────────────────────────────────
--  Migration: 034 — CPQ (Configure-Price-Quote)  [Wave F2]
--
--  Salesforce-style CPQ. Sales reps build a Quote out of either
--  individual Products or pre-configured Product Bundles, apply
--  optional discounts, send the quote to the client, and convert
--  accepted quotes to Invoices.
--
--  Tables:
--    product_bundles    — admin-curated kits of products
--    bundle_items       — products inside a bundle (with per-product qty + discount)
--    quotes             — header row (number, client, status, totals)
--    quote_line_items   — line items (each line is EITHER a product OR a bundle)
--
--  Tenant isolation: enforced at the service layer via
--  prisma.withOrganization(). No RLS in this DB.
--
--  Apply manually on the VPS:
--    psql "$DATABASE_URL" -f 034-cpq.sql
--
--  Idempotent — CREATE TABLE / INDEX IF NOT EXISTS; FKs added only
--  if absent.
-- ─────────────────────────────────────────────────────────────

BEGIN;

-- ── product_bundles ──────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "product_bundles" (
    "id"             TEXT        PRIMARY KEY DEFAULT gen_random_uuid()::text,
    "organizationId" TEXT        NOT NULL,
    "name"           TEXT        NOT NULL,
    "description"    TEXT,
    "active"         BOOLEAN     NOT NULL DEFAULT TRUE,
    "createdById"    TEXT,
    "createdAt"      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    "updatedAt"      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS "product_bundles_org_idx"
    ON "product_bundles" ("organizationId");

CREATE INDEX IF NOT EXISTS "product_bundles_org_active_idx"
    ON "product_bundles" ("organizationId", "active");

-- ── bundle_items ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "bundle_items" (
    "id"              TEXT          PRIMARY KEY DEFAULT gen_random_uuid()::text,
    "organizationId"  TEXT          NOT NULL,
    "bundleId"        TEXT          NOT NULL,
    "productId"       TEXT          NOT NULL,
    "quantity"        INTEGER       NOT NULL DEFAULT 1,
    "discountPercent" NUMERIC(5, 2) NOT NULL DEFAULT 0,
    "order"           INTEGER       NOT NULL DEFAULT 0,
    CONSTRAINT "bundle_items_quantity_check" CHECK ("quantity" >= 1),
    CONSTRAINT "bundle_items_discount_check"
        CHECK ("discountPercent" >= 0 AND "discountPercent" <= 100)
);

CREATE INDEX IF NOT EXISTS "bundle_items_org_bundle_idx"
    ON "bundle_items" ("organizationId", "bundleId");

CREATE INDEX IF NOT EXISTS "bundle_items_product_idx"
    ON "bundle_items" ("productId");

-- ── quotes ───────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "quotes" (
    "id"                   TEXT           PRIMARY KEY DEFAULT gen_random_uuid()::text,
    "organizationId"       TEXT           NOT NULL,
    -- Per-org sequence like Q-2026-0001, generated in the service layer.
    "number"               TEXT           NOT NULL,
    "clientId"             TEXT           NOT NULL,
    "opportunityId"        TEXT,
    "status"               TEXT           NOT NULL DEFAULT 'draft',
    "validUntil"           DATE,
    "subtotal"             NUMERIC(15, 2) NOT NULL DEFAULT 0,
    "discountPercent"      NUMERIC(5, 2)  NOT NULL DEFAULT 0,
    "total"                NUMERIC(15, 2) NOT NULL DEFAULT 0,
    "currency"             TEXT           NOT NULL DEFAULT 'USD',
    "notes"                TEXT,
    "sentAt"               TIMESTAMPTZ,
    "acceptedAt"           TIMESTAMPTZ,
    "convertedInvoiceId"   TEXT,
    "createdById"          TEXT,
    "createdAt"            TIMESTAMPTZ    NOT NULL DEFAULT NOW(),
    "updatedAt"            TIMESTAMPTZ    NOT NULL DEFAULT NOW(),
    CONSTRAINT "quotes_status_check"
        CHECK ("status" IN ('draft', 'sent', 'accepted', 'rejected', 'expired')),
    CONSTRAINT "quotes_discount_check"
        CHECK ("discountPercent" >= 0 AND "discountPercent" <= 100)
);

-- Per-org number uniqueness — also enforced at the Prisma model level.
CREATE UNIQUE INDEX IF NOT EXISTS "quotes_org_number_key"
    ON "quotes" ("organizationId", "number");

CREATE INDEX IF NOT EXISTS "quotes_org_status_idx"
    ON "quotes" ("organizationId", "status");

CREATE INDEX IF NOT EXISTS "quotes_org_client_idx"
    ON "quotes" ("organizationId", "clientId");

CREATE INDEX IF NOT EXISTS "quotes_org_opportunity_idx"
    ON "quotes" ("organizationId", "opportunityId");

-- ── quote_line_items ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "quote_line_items" (
    "id"              TEXT           PRIMARY KEY DEFAULT gen_random_uuid()::text,
    "organizationId"  TEXT           NOT NULL,
    "quoteId"         TEXT           NOT NULL,
    -- Each line is EITHER a Product OR a Bundle. The service layer
    -- enforces exactly-one; CHECK below mirrors that as a hard rail.
    "productId"       TEXT,
    "bundleId"        TEXT,
    "description"     TEXT,
    "quantity"        INTEGER        NOT NULL DEFAULT 1,
    "unitPrice"       NUMERIC(15, 2) NOT NULL DEFAULT 0,
    "discountPercent" NUMERIC(5, 2)  NOT NULL DEFAULT 0,
    "lineTotal"       NUMERIC(15, 2) NOT NULL DEFAULT 0,
    "order"           INTEGER        NOT NULL DEFAULT 0,
    CONSTRAINT "quote_line_items_quantity_check" CHECK ("quantity" >= 1),
    CONSTRAINT "quote_line_items_discount_check"
        CHECK ("discountPercent" >= 0 AND "discountPercent" <= 100),
    -- XOR — exactly one of productId / bundleId must be set.
    CONSTRAINT "quote_line_items_product_or_bundle_check"
        CHECK ( ("productId" IS NOT NULL)::int + ("bundleId" IS NOT NULL)::int = 1 )
);

CREATE INDEX IF NOT EXISTS "quote_line_items_org_quote_idx"
    ON "quote_line_items" ("organizationId", "quoteId");

CREATE INDEX IF NOT EXISTS "quote_line_items_product_idx"
    ON "quote_line_items" ("productId");

CREATE INDEX IF NOT EXISTS "quote_line_items_bundle_idx"
    ON "quote_line_items" ("bundleId");

-- ── Foreign keys (added only if absent) ──────────────────────
DO $$
BEGIN
    -- product_bundles -> organizations (CASCADE — tenant-scoped lifecycle)
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'product_bundles_organizationId_fkey'
    ) THEN
        ALTER TABLE "product_bundles"
            ADD CONSTRAINT "product_bundles_organizationId_fkey"
            FOREIGN KEY ("organizationId") REFERENCES "organizations"("id")
            ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;

    -- product_bundles -> users (creator, SET NULL on user delete to keep audit)
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'product_bundles_createdById_fkey'
    ) THEN
        ALTER TABLE "product_bundles"
            ADD CONSTRAINT "product_bundles_createdById_fkey"
            FOREIGN KEY ("createdById") REFERENCES "users"("id")
            ON DELETE SET NULL ON UPDATE CASCADE;
    END IF;

    -- bundle_items -> organizations
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'bundle_items_organizationId_fkey'
    ) THEN
        ALTER TABLE "bundle_items"
            ADD CONSTRAINT "bundle_items_organizationId_fkey"
            FOREIGN KEY ("organizationId") REFERENCES "organizations"("id")
            ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;

    -- bundle_items -> product_bundles (CASCADE — items die with bundle)
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'bundle_items_bundleId_fkey'
    ) THEN
        ALTER TABLE "bundle_items"
            ADD CONSTRAINT "bundle_items_bundleId_fkey"
            FOREIGN KEY ("bundleId") REFERENCES "product_bundles"("id")
            ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;

    -- bundle_items -> products (RESTRICT — refuse product delete if any bundle uses it)
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'bundle_items_productId_fkey'
    ) THEN
        ALTER TABLE "bundle_items"
            ADD CONSTRAINT "bundle_items_productId_fkey"
            FOREIGN KEY ("productId") REFERENCES "products"("id")
            ON DELETE RESTRICT ON UPDATE CASCADE;
    END IF;

    -- quotes -> organizations
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'quotes_organizationId_fkey'
    ) THEN
        ALTER TABLE "quotes"
            ADD CONSTRAINT "quotes_organizationId_fkey"
            FOREIGN KEY ("organizationId") REFERENCES "organizations"("id")
            ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;

    -- quotes -> clients (RESTRICT — block client delete while quotes exist)
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'quotes_clientId_fkey'
    ) THEN
        ALTER TABLE "quotes"
            ADD CONSTRAINT "quotes_clientId_fkey"
            FOREIGN KEY ("clientId") REFERENCES "clients"("id")
            ON DELETE RESTRICT ON UPDATE CASCADE;
    END IF;

    -- quotes -> opportunities (SET NULL — quote survives deal cleanup)
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'quotes_opportunityId_fkey'
    ) THEN
        ALTER TABLE "quotes"
            ADD CONSTRAINT "quotes_opportunityId_fkey"
            FOREIGN KEY ("opportunityId") REFERENCES "opportunities"("id")
            ON DELETE SET NULL ON UPDATE CASCADE;
    END IF;

    -- quotes -> invoices (converted_invoice — SET NULL keeps the audit trail
    -- if the invoice is later deleted; the convertedInvoiceId column being
    -- non-null is the "this quote was converted" flag).
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'quotes_convertedInvoiceId_fkey'
    ) THEN
        ALTER TABLE "quotes"
            ADD CONSTRAINT "quotes_convertedInvoiceId_fkey"
            FOREIGN KEY ("convertedInvoiceId") REFERENCES "invoices"("id")
            ON DELETE SET NULL ON UPDATE CASCADE;
    END IF;

    -- quotes -> users (creator)
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'quotes_createdById_fkey'
    ) THEN
        ALTER TABLE "quotes"
            ADD CONSTRAINT "quotes_createdById_fkey"
            FOREIGN KEY ("createdById") REFERENCES "users"("id")
            ON DELETE SET NULL ON UPDATE CASCADE;
    END IF;

    -- quote_line_items -> organizations
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'quote_line_items_organizationId_fkey'
    ) THEN
        ALTER TABLE "quote_line_items"
            ADD CONSTRAINT "quote_line_items_organizationId_fkey"
            FOREIGN KEY ("organizationId") REFERENCES "organizations"("id")
            ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;

    -- quote_line_items -> quotes (CASCADE — lines die with quote)
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'quote_line_items_quoteId_fkey'
    ) THEN
        ALTER TABLE "quote_line_items"
            ADD CONSTRAINT "quote_line_items_quoteId_fkey"
            FOREIGN KEY ("quoteId") REFERENCES "quotes"("id")
            ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;

    -- quote_line_items -> products (RESTRICT — refuse product delete if referenced)
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'quote_line_items_productId_fkey'
    ) THEN
        ALTER TABLE "quote_line_items"
            ADD CONSTRAINT "quote_line_items_productId_fkey"
            FOREIGN KEY ("productId") REFERENCES "products"("id")
            ON DELETE RESTRICT ON UPDATE CASCADE;
    END IF;

    -- quote_line_items -> product_bundles (SET NULL — accepted quotes' lines
    -- keep their unitPrice + lineTotal even after the bundle definition is
    -- deleted; only the live reference goes away).
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'quote_line_items_bundleId_fkey'
    ) THEN
        ALTER TABLE "quote_line_items"
            ADD CONSTRAINT "quote_line_items_bundleId_fkey"
            FOREIGN KEY ("bundleId") REFERENCES "product_bundles"("id")
            ON DELETE SET NULL ON UPDATE CASCADE;
    END IF;
END $$;

COMMIT;
