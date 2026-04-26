-- ─────────────────────────────────────────────────────────────
--  Migration: 004 — line item productId FK
--
--  Adds an optional `productId` column to invoice_items,
--  estimate_items, and proposal_items so each line can reference
--  the source Product by FK instead of relying on case-insensitive
--  description matching. Stock auto-decrement (and any future
--  product-driven analytics) prefer this FK; description matching
--  remains as a transitional fallback when productId is null.
--
--  Apply manually on the VPS:
--
--      psql "$DATABASE_URL" -f 004-line-item-product-fk.sql
--
--  Idempotent — safe to re-run. ON DELETE SET NULL on the FK so
--  deleting a product doesn't cascade-delete historical invoices.
-- ─────────────────────────────────────────────────────────────

-- ── Columns ──────────────────────────────────────────────────
ALTER TABLE "invoice_items"
    ADD COLUMN IF NOT EXISTS "productId" TEXT;

ALTER TABLE "estimate_items"
    ADD COLUMN IF NOT EXISTS "productId" TEXT;

ALTER TABLE "proposal_items"
    ADD COLUMN IF NOT EXISTS "productId" TEXT;

-- ── Foreign keys (drop-then-add for idempotency) ─────────────
ALTER TABLE "invoice_items"
    DROP CONSTRAINT IF EXISTS "invoice_items_productId_fkey";
ALTER TABLE "invoice_items"
    ADD CONSTRAINT "invoice_items_productId_fkey"
    FOREIGN KEY ("productId") REFERENCES "products"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "estimate_items"
    DROP CONSTRAINT IF EXISTS "estimate_items_productId_fkey";
ALTER TABLE "estimate_items"
    ADD CONSTRAINT "estimate_items_productId_fkey"
    FOREIGN KEY ("productId") REFERENCES "products"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "proposal_items"
    DROP CONSTRAINT IF EXISTS "proposal_items_productId_fkey";
ALTER TABLE "proposal_items"
    ADD CONSTRAINT "proposal_items_productId_fkey"
    FOREIGN KEY ("productId") REFERENCES "products"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;

-- ── Indexes ──────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS "invoice_items_productId_idx"
    ON "invoice_items"("productId");

CREATE INDEX IF NOT EXISTS "estimate_items_productId_idx"
    ON "estimate_items"("productId");

CREATE INDEX IF NOT EXISTS "proposal_items_productId_idx"
    ON "proposal_items"("productId");
