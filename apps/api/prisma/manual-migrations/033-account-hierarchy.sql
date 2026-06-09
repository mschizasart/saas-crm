-- ─────────────────────────────────────────────────────────────
--  Migration: 033 — Account hierarchy (Wave F1)
--
--  Self-referential FK on `clients` so a logical customer can have
--  multiple Client rows linked into a parent/child tree (subsidiaries,
--  divisions, regional offices). One designated parent per node;
--  multiple roots are fine.
--
--  Design choices:
--    * Nullable `parentClientId` — most clients are flat (no parent).
--    * ON DELETE SET NULL — if the parent record is removed, the
--      children survive as new roots instead of cascading away.
--    * Depth / cycle enforcement lives in the service layer
--      (account-hierarchy.service.ts) — Postgres has no native
--      "max recursion depth on insert" guard and we want a friendly
--      400 error rather than a recursive-CTE explosion at query time.
--    * Index on (organizationId, parentClientId) so the common
--      "children of X" lookup is a single index scan and recursive
--      CTEs walking the tree top-down stay cheap.
-- ─────────────────────────────────────────────────────────────

BEGIN;

ALTER TABLE "clients"
  ADD COLUMN "parentClientId" TEXT
  REFERENCES "clients"("id") ON DELETE SET NULL;

CREATE INDEX "clients_org_parent_idx"
  ON "clients" ("organizationId", "parentClientId");

COMMIT;
