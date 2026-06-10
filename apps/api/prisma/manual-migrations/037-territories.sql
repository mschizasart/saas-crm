-- ─────────────────────────────────────────────────────────────
--  Migration: 037 — Territories (Wave G2)
--
--  Sales orgs partition their book of business by geography,
--  industry, or product line. Each tenant defines territories
--  (optionally arranged into a parent/child hierarchy — e.g.
--  "Americas > North America > USA > Northeast"), assigns users
--  as members or managers, and routes Clients/Leads/Opportunities
--  to specific territories. Per-territory rollup metrics and
--  territory-filtered reports follow.
--
--  Three tables:
--    * territories            — the territory tree itself.
--    * territory_members      — users (members or managers) of a
--                                territory. UNIQUE per (territory,
--                                user) so a user can't be in the
--                                same territory twice.
--    * territory_assignments  — links a Client / Lead / Opportunity
--                                to a territory. Polymorphic via
--                                (entity_type, entity_id) so we
--                                don't need three side tables.
--                                UNIQUE per (territory, entity_type,
--                                entity_id).
--
--  Design choices:
--    * Self-FK on territories.parentTerritoryId — nullable, ON
--      DELETE SET NULL so removing a parent promotes its children
--      to roots (matches the Wave F1 hierarchy pattern).
--    * Cycle/depth enforcement lives in the service layer
--      (territories.service.ts), bounded at MAX_DEPTH = 10. Postgres
--      has no native "max recursion depth on insert" guard and we
--      want a friendly 400 instead of a CTE explosion at query time.
--    * Polymorphic `(entity_type, entity_id)` on territory_assignments
--      keeps the schema additive: adding a fourth assignable entity
--      type later only requires a CHECK constraint update and an
--      enum widening in the DTO — no new table, no new join logic.
--      The trade-off is no DB-level FK from entity_id to the entity
--      table; the service layer validates each entity exists in the
--      caller's org before inserting (same pattern as audit_log).
--    * UNIQUE constraints on members and assignments turn duplicate
--      adds into a clean P2002 → ConflictException at the service
--      layer rather than silently inserting twice.
--    * Indexes designed around the two hot reads:
--        - "which territories is THIS entity in?"
--             → (organizationId, entityType, entityId)
--        - "what's in THIS territory?"
--             → (organizationId, territoryId, entityType)
-- ─────────────────────────────────────────────────────────────

BEGIN;

-- ─── 1. Territories ───────────────────────────────────────────

CREATE TABLE IF NOT EXISTS "territories" (
  "id"                  TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  "organizationId"      TEXT NOT NULL
    REFERENCES "organizations"("id") ON DELETE CASCADE,
  "name"                TEXT NOT NULL,
  "description"         TEXT,
  -- Parent territory (self-FK). Nullable — roots have no parent.
  -- ON DELETE SET NULL so removing a parent doesn't cascade-blow-up
  -- the subtree; the children become new roots.
  "parentTerritoryId"   TEXT
    REFERENCES "territories"("id") ON DELETE SET NULL,
  -- Designated manager (optional). ON DELETE SET NULL keeps the
  -- territory alive after the manager leaves the org.
  "managerId"           TEXT
    REFERENCES "users"("id") ON DELETE SET NULL,
  "createdAt"           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  "updatedAt"           TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  -- Name unique within a tenant — avoids two "USA - East" rows that
  -- can't be told apart in pickers.
  CONSTRAINT "territories_org_name_uniq"
    UNIQUE ("organizationId", "name")
);

-- Hot path: "children of X" + recursive CTE walking the tree down.
CREATE INDEX IF NOT EXISTS "territories_org_parent_idx"
  ON "territories" ("organizationId", "parentTerritoryId");

CREATE INDEX IF NOT EXISTS "territories_org_idx"
  ON "territories" ("organizationId");

-- ─── 2. Territory members ─────────────────────────────────────

CREATE TABLE IF NOT EXISTS "territory_members" (
  "id"              TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  "organizationId"  TEXT NOT NULL
    REFERENCES "organizations"("id") ON DELETE CASCADE,
  "territoryId"     TEXT NOT NULL
    REFERENCES "territories"("id") ON DELETE CASCADE,
  "userId"          TEXT NOT NULL
    REFERENCES "users"("id") ON DELETE CASCADE,
  -- 'member' = ordinary rep, 'manager' = elevated visibility.
  -- The dedicated `territories.managerId` column is the SINGLE
  -- designated manager (for routing); `role='manager'` here can
  -- mark MULTIPLE elevated members without changing the routing
  -- pointer.
  "role"            TEXT NOT NULL DEFAULT 'member'
    CHECK ("role" IN ('member', 'manager')),
  "createdAt"       TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  -- A user can only be in a given territory once. Duplicate adds
  -- surface as a clean ConflictException at the service layer.
  CONSTRAINT "territory_members_territory_user_uniq"
    UNIQUE ("territoryId", "userId")
);

CREATE INDEX IF NOT EXISTS "territory_members_org_territory_user_idx"
  ON "territory_members" ("organizationId", "territoryId", "userId");

CREATE INDEX IF NOT EXISTS "territory_members_org_user_idx"
  ON "territory_members" ("organizationId", "userId");

-- ─── 3. Territory assignments ─────────────────────────────────

CREATE TABLE IF NOT EXISTS "territory_assignments" (
  "id"              TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  "organizationId"  TEXT NOT NULL
    REFERENCES "organizations"("id") ON DELETE CASCADE,
  "territoryId"     TEXT NOT NULL
    REFERENCES "territories"("id") ON DELETE CASCADE,
  -- Polymorphic FK — service layer validates that entityId exists
  -- in the appropriate table for the caller's org before inserting.
  "entityType"      TEXT NOT NULL
    CHECK ("entityType" IN ('client', 'lead', 'opportunity')),
  "entityId"        TEXT NOT NULL,
  "createdAt"       TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  -- One assignment row per (territory, entityType, entityId). A
  -- client can be in multiple territories (different rows), but
  -- cannot be assigned to the same territory twice.
  CONSTRAINT "territory_assignments_territory_entity_uniq"
    UNIQUE ("territoryId", "entityType", "entityId")
);

-- "which territories is THIS client/lead/opp in?" — powers the
-- reverse-lookup endpoint and the territory tile on detail pages.
CREATE INDEX IF NOT EXISTS "territory_assignments_org_entity_idx"
  ON "territory_assignments" ("organizationId", "entityType", "entityId");

-- "what's in THIS territory?" — powers the per-territory list with
-- optional entityType filter (the index covers the filter too).
CREATE INDEX IF NOT EXISTS "territory_assignments_org_territory_type_idx"
  ON "territory_assignments" ("organizationId", "territoryId", "entityType");

COMMIT;
