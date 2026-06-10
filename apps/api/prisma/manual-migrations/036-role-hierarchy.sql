-- ─────────────────────────────────────────────────────────────
--  Migration: 036 — Role hierarchy / management chain (Wave G1)
--
--  Adds a self-referential FK on `users` so we can model a
--  Salesforce-style management chain ("X reports to Y"). This is
--  the substrate for hierarchical record sharing: list endpoints
--  filter records by `ownerId IN (self + reports)` based on the
--  caller's permissions, so a sales manager naturally sees their
--  team's deals without us hand-rolling per-record ACLs.
--
--  Design choices:
--    * Nullable `managerId` — most users have a manager but the
--      org chart has at least one root (CEO / owner).
--    * ON DELETE SET NULL — if a manager's user record is deleted,
--      their direct reports remain (now reporting to no-one) rather
--      than cascading the deletion through the team.
--    * Depth / cycle enforcement lives in the service layer
--      (record-sharing.service.ts) — same pattern as Wave F1
--      account-hierarchy. Postgres can't cap recursion-depth at
--      insert-time and we want friendly 400 errors instead of
--      runaway recursive CTEs at query time.
--    * Composite index on (organizationId, managerId) so the common
--      "direct reports of X" lookup is one index scan and recursive
--      CTEs walking the tree top-down stay cheap.
-- ─────────────────────────────────────────────────────────────

BEGIN;

ALTER TABLE "users"
  ADD COLUMN "managerId" TEXT
  REFERENCES "users"("id") ON DELETE SET NULL;

CREATE INDEX "users_org_manager_idx"
  ON "users" ("organizationId", "managerId");

COMMIT;
