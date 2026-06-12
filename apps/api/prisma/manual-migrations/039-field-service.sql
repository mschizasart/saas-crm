-- ─────────────────────────────────────────────────────────────
--  Migration: 039 — Field Service (Work Orders + Dispatch)  (Wave H1)
--
--  HVAC / IT-services / landscaping shops dispatch technicians
--  to clients to perform on-site work. A WorkOrder is the unit
--  that ties together (client, optional opportunity, technician,
--  schedule window, materials/labor line items).
--
--  Lifecycle: draft → scheduled → in_progress → completed
--  with `cancelled` reachable from draft/scheduled/in_progress
--  (NOT from completed). Final states (completed / cancelled)
--  are sinks. Transitions are written to `work_order_status_history`
--  inside the same transaction as the work_order update —
--  mirroring the opportunity_stage_history pattern (Wave D).
--
--  TENANCY:
--    * Every row has `organization_id` and FK CASCADE on
--      organisations(id) — same as quotes / opportunities.
--    * No RLS — service layer scoping enforced by every read
--      (`withOrganization` + explicit `where: { organizationId }`).
--    * `client_id` uses ON DELETE RESTRICT so deleting a client
--      can't silently orphan a scheduled work order.
--    * `opportunity_id` uses ON DELETE SET NULL — losing the
--      originating opp shouldn't destroy a dispatched work order.
--    * `technician_id` uses ON DELETE SET NULL — a departing
--      technician's history stays intact, just unassigned.
--    * `product_id` on line items uses ON DELETE SET NULL — the
--      catalog can churn without breaking historic invoicing.
--
--  NUMBER:
--    Per-org sequence "WO-YYYY-NNNN" generated in the service
--    layer (mirrors the Quote / Invoice pattern). The
--    UNIQUE(org, number) constraint catches concurrent collisions
--    as a P2002 the caller can retry.
--
--  USER FLAG:
--    `isTechnician` boolean on users — gates assignability. The
--    column is mixed-case (camelCase) to match the existing
--    `isAdmin` / `isPrimary` columns on `users`. Plain composite
--    index on (org, isTechnician) — a partial index would be a
--    micro-optim but standardizes worse with the rest of the
--    schema.
-- ─────────────────────────────────────────────────────────────

BEGIN;

-- ─── 1. work_orders ───────────────────────────────────────────

CREATE TABLE IF NOT EXISTS "work_orders" (
  "id"                TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  "organizationId"    TEXT NOT NULL,
  "number"            TEXT NOT NULL,
  "clientId"          TEXT NOT NULL,
  "opportunityId"     TEXT,
  "locationAddress"   TEXT,
  "scheduledStart"    TIMESTAMPTZ,
  "scheduledEnd"      TIMESTAMPTZ,
  "status"            TEXT NOT NULL DEFAULT 'draft'
    CHECK ("status" IN ('draft', 'scheduled', 'in_progress', 'completed', 'cancelled')),
  "technicianId"      TEXT,
  "priority"          TEXT NOT NULL DEFAULT 'normal'
    CHECK ("priority" IN ('low', 'normal', 'high', 'urgent')),
  "description"       TEXT,
  "completionNotes"   TEXT,
  "createdById"       TEXT,
  "createdAt"         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  "updatedAt"         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  "startedAt"         TIMESTAMPTZ,
  "completedAt"       TIMESTAMPTZ,
  "cancelledAt"       TIMESTAMPTZ,

  CONSTRAINT "work_orders_org_fk"
    FOREIGN KEY ("organizationId") REFERENCES "organizations"("id")
    ON DELETE CASCADE,
  CONSTRAINT "work_orders_client_fk"
    FOREIGN KEY ("clientId") REFERENCES "clients"("id")
    ON DELETE RESTRICT,
  CONSTRAINT "work_orders_opportunity_fk"
    FOREIGN KEY ("opportunityId") REFERENCES "opportunities"("id")
    ON DELETE SET NULL,
  CONSTRAINT "work_orders_technician_fk"
    FOREIGN KEY ("technicianId") REFERENCES "users"("id")
    ON DELETE SET NULL,
  CONSTRAINT "work_orders_created_by_fk"
    FOREIGN KEY ("createdById") REFERENCES "users"("id")
    ON DELETE SET NULL,

  CONSTRAINT "work_orders_org_number_uniq"
    UNIQUE ("organizationId", "number")
);

-- Hot paths:
--   1. board view filters by status        → (org, status)
--   2. technician's schedule (calendar)    → (org, technicianId, scheduledStart)
--   3. "all WOs for this client"          → (org, clientId)
--   4. date-range list / dispatch board    → (org, scheduledStart)
CREATE INDEX IF NOT EXISTS "work_orders_org_status_idx"
  ON "work_orders" ("organizationId", "status");
CREATE INDEX IF NOT EXISTS "work_orders_org_tech_start_idx"
  ON "work_orders" ("organizationId", "technicianId", "scheduledStart");
CREATE INDEX IF NOT EXISTS "work_orders_org_client_idx"
  ON "work_orders" ("organizationId", "clientId");
CREATE INDEX IF NOT EXISTS "work_orders_org_start_idx"
  ON "work_orders" ("organizationId", "scheduledStart");

-- ─── 2. work_order_line_items ─────────────────────────────────

CREATE TABLE IF NOT EXISTS "work_order_line_items" (
  "id"              TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  "organizationId"  TEXT NOT NULL,
  "workOrderId"     TEXT NOT NULL,
  -- 'service' (labor) | 'part' (material). Drives later billing
  -- categorisation when these get flowed into an Invoice.
  "type"            TEXT NOT NULL DEFAULT 'service'
    CHECK ("type" IN ('service', 'part')),
  "productId"       TEXT,
  "description"     TEXT NOT NULL,
  "quantity"        NUMERIC(10, 2) NOT NULL DEFAULT 1
    CHECK ("quantity" >= 0),
  "unitPrice"       NUMERIC(15, 2) NOT NULL DEFAULT 0,
  "lineTotal"       NUMERIC(15, 2) NOT NULL DEFAULT 0,
  "order"           INTEGER NOT NULL DEFAULT 0,
  "createdAt"       TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT "work_order_line_items_org_fk"
    FOREIGN KEY ("organizationId") REFERENCES "organizations"("id")
    ON DELETE CASCADE,
  CONSTRAINT "work_order_line_items_wo_fk"
    FOREIGN KEY ("workOrderId") REFERENCES "work_orders"("id")
    ON DELETE CASCADE,
  CONSTRAINT "work_order_line_items_product_fk"
    FOREIGN KEY ("productId") REFERENCES "products"("id")
    ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS "work_order_line_items_org_wo_idx"
  ON "work_order_line_items" ("organizationId", "workOrderId");

-- ─── 3. work_order_status_history ─────────────────────────────

CREATE TABLE IF NOT EXISTS "work_order_status_history" (
  "id"              TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  "organizationId"  TEXT NOT NULL,
  "workOrderId"     TEXT NOT NULL,
  -- NULL on the initial 'draft' insert row.
  "fromStatus"      TEXT,
  "toStatus"        TEXT NOT NULL,
  "changedById"     TEXT,
  "notes"           TEXT,
  "changedAt"       TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT "work_order_status_history_org_fk"
    FOREIGN KEY ("organizationId") REFERENCES "organizations"("id")
    ON DELETE CASCADE,
  CONSTRAINT "work_order_status_history_wo_fk"
    FOREIGN KEY ("workOrderId") REFERENCES "work_orders"("id")
    ON DELETE CASCADE,
  CONSTRAINT "work_order_status_history_changed_by_fk"
    FOREIGN KEY ("changedById") REFERENCES "users"("id")
    ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS "work_order_status_history_org_wo_idx"
  ON "work_order_status_history" ("organizationId", "workOrderId", "changedAt" DESC);

-- ─── 4. users.isTechnician ────────────────────────────────────
--
-- Guarded ADD COLUMN so the migration is rerun-safe (column may
-- already exist if a prior partial deploy got the User model
-- regenerated before this SQL ran). camelCase to match the
-- existing `isAdmin` / `isPrimary` columns.

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_name = 'users'
      AND column_name = 'isTechnician'
  ) THEN
    ALTER TABLE "users"
      ADD COLUMN "isTechnician" BOOLEAN NOT NULL DEFAULT false;
  END IF;
END $$;

-- Cheap technician lookup for dispatch / availability endpoints.
-- A partial index (WHERE "isTechnician" = true) would be denser,
-- but a plain composite mirrors the rest of the schema and the
-- planner picks it up fine for the org-scoped queries.
CREATE INDEX IF NOT EXISTS "users_org_is_technician_idx"
  ON "users" ("organizationId", "isTechnician");

COMMIT;
