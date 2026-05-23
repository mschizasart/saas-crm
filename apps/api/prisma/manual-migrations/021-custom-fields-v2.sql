-- ─────────────────────────────────────────────────────────────
--  Migration: 021 — Custom Fields v2 (COMPUTED field types)
--
--  Extends `custom_fields` with computed-field support. Existing fields
--  remain plain user-entered "input" fields. v2 adds three READ-ONLY
--  computed kinds that are never persisted as user input — they are
--  evaluated on read by the API (computed-fields.service.ts):
--
--      fieldKind     — 'input' | 'formula' | 'lookup' | 'rollup'
--                      Defaults to 'input'; ALL existing rows become 'input'.
--      formulaExpr   — formula fields: a pure-arithmetic expression over the
--                      entity's OTHER custom-field values + a whitelist of the
--                      entity's own numeric columns (e.g. "quantity * unitPrice",
--                      "subtotal * 0.2"). Evaluated by a sandboxed shunting-yard
--                      parser — NO eval/Function/vm.
--      lookupConfig  — lookup fields: { "relation": "client", "field": "company" }
--                      Pulls one field off a related (same-org) record.
--      rollupConfig  — rollup fields: { "relation": "invoices",
--                      "op": "sum"|"count"|"avg"|"min"|"max", "field": "total" }
--                      Aggregates a field over child (same-org) records.
--
--  Apply manually on the VPS:
--    psql "$DATABASE_URL" -f 021-custom-fields-v2.sql
--
--  Idempotent — uses ADD COLUMN IF NOT EXISTS everywhere. No RLS.
--  Safe to re-run. Computed fields are read-only and org-scoped at the
--  API layer; these columns are pure metadata describing how to compute.
-- ─────────────────────────────────────────────────────────────

ALTER TABLE "custom_fields"
    ADD COLUMN IF NOT EXISTS "fieldKind" TEXT NOT NULL DEFAULT 'input';

ALTER TABLE "custom_fields"
    ADD COLUMN IF NOT EXISTS "formulaExpr" TEXT;

ALTER TABLE "custom_fields"
    ADD COLUMN IF NOT EXISTS "lookupConfig" JSONB;

ALTER TABLE "custom_fields"
    ADD COLUMN IF NOT EXISTS "rollupConfig" JSONB;

-- ── Data integrity: constrain fieldKind to the four known kinds ──────────
-- The column may already exist on prod (added by an earlier run of this
-- migration), so guard the constraint creation in an idempotent DO block.
-- Any value outside the whitelist is rejected at the DB layer; the API
-- write-guard additionally treats every non-'input' kind as read-only.
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'custom_fields_fieldKind_check'
    ) THEN
        ALTER TABLE "custom_fields"
            ADD CONSTRAINT "custom_fields_fieldKind_check"
            CHECK ("fieldKind" IN ('input', 'formula', 'lookup', 'rollup'));
    END IF;
END $$;

-- ── Data integrity: no two fields share a slug on the same entity/org ────
-- setValues() resolves a body key to a field by slug; two fields with the
-- same name on the same fieldTo would slugify identically and one would
-- silently shadow the other. Enforce uniqueness on (org, fieldTo, slug).
-- IF NOT EXISTS makes this safe to re-run.
CREATE UNIQUE INDEX IF NOT EXISTS "custom_fields_org_fieldTo_slug_key"
    ON "custom_fields" ("organizationId", "fieldTo", "slug");
