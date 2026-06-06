-- ─────────────────────────────────────────────────────────────
--  Migration: 029 — Custom Objects (Wave D3)
--
--  Three tables, per-org. Custom objects let tenants define their own
--  entity types at runtime (Salesforce-style). The architectural decision
--  is to store custom records as ROWS in `custom_records` with a `data`
--  jsonb column — we explicitly do NOT create real Postgres tables on the
--  fly (that would be too dangerous to expose to tenants).
--
--    * custom_objects        — the per-org object definitions
--                              (e.g. "Vehicles", "Inventory Items")
--    * custom_object_fields  — field definitions per object
--                              (label, key, type, options, required, order)
--    * custom_records        — actual records, with jsonb `data` keyed
--                              by field key. A GIN index covers basic
--                              jsonb queries (containment / existence).
--
--  Apply manually on the VPS (we don't run `prisma migrate` in prod):
--      psql "$DATABASE_URL" -f 029-custom-objects.sql
--
--  Safe to re-run: uses IF NOT EXISTS everywhere.
--
--  NOTE: deliberately NO RLS policy here. Tenant isolation is enforced
--  in the service layer via prisma.withOrganization(orgId, …) and
--  explicit `organizationId` filters on every query.
-- ─────────────────────────────────────────────────────────────

BEGIN;

-- ─── custom_objects — per-org object definitions ─────────────────────
CREATE TABLE IF NOT EXISTS "custom_objects" (
    "id"             TEXT         PRIMARY KEY DEFAULT gen_random_uuid()::text,
    "organizationId" TEXT         NOT NULL,
    "name"           TEXT         NOT NULL,            -- e.g. "Vehicle"
    "slug"           TEXT         NOT NULL,            -- e.g. "vehicle" (snake_case)
    "pluralName"     TEXT         NOT NULL,            -- e.g. "Vehicles"
    "icon"           TEXT,                              -- lucide-react icon name (nullable)
    "createdAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "custom_objects_organizationId_fkey"
        FOREIGN KEY ("organizationId")
        REFERENCES "organizations"("id")
        ON DELETE CASCADE
        ON UPDATE CASCADE
);

-- Slug uniqueness is per-org. Two different orgs may define the same slug.
CREATE UNIQUE INDEX IF NOT EXISTS "custom_objects_org_slug_key"
    ON "custom_objects" ("organizationId", "slug");

CREATE INDEX IF NOT EXISTS "custom_objects_org_idx"
    ON "custom_objects" ("organizationId");

-- ─── custom_object_fields — field defs per object ────────────────────
-- fieldType ∈ ('text','number','date','boolean','select','relation').
-- `options` jsonb stores per-type config:
--   select  : { "choices": ["A","B","C"] }
--   relation: { "relatedEntity": "clients" | "leads" | … }
CREATE TABLE IF NOT EXISTS "custom_object_fields" (
    "id"             TEXT         PRIMARY KEY DEFAULT gen_random_uuid()::text,
    "organizationId" TEXT         NOT NULL,
    "customObjectId" TEXT         NOT NULL,
    "label"          TEXT         NOT NULL,             -- "VIN", "Make", "Price"
    "key"            TEXT         NOT NULL,             -- "vin", "make", "price" (snake_case)
    "fieldType"      TEXT         NOT NULL,
    "options"        JSONB        NOT NULL DEFAULT '{}'::jsonb,
    "required"       BOOLEAN      NOT NULL DEFAULT FALSE,
    "order"          INTEGER      NOT NULL DEFAULT 0,
    "createdAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "custom_object_fields_fieldType_check"
        CHECK ("fieldType" IN ('text','number','date','boolean','select','relation')),
    CONSTRAINT "custom_object_fields_customObjectId_fkey"
        FOREIGN KEY ("customObjectId")
        REFERENCES "custom_objects"("id")
        ON DELETE CASCADE
        ON UPDATE CASCADE
);

-- Field keys are unique within an object (so `data->>'key'` is unambiguous).
CREATE UNIQUE INDEX IF NOT EXISTS "custom_object_fields_object_key_key"
    ON "custom_object_fields" ("customObjectId", "key");

CREATE INDEX IF NOT EXISTS "custom_object_fields_object_order_idx"
    ON "custom_object_fields" ("customObjectId", "order");

-- ─── custom_records — the actual rows, jsonb-keyed ───────────────────
-- `data` is keyed by field.key (validated against custom_object_fields
-- in the service layer before insert/update). A GIN index makes basic
-- jsonb operators (?, @>, ?|) cheap; per-field text search falls back to
-- ILIKE on `data->>'key'`.
CREATE TABLE IF NOT EXISTS "custom_records" (
    "id"             TEXT         PRIMARY KEY DEFAULT gen_random_uuid()::text,
    "organizationId" TEXT         NOT NULL,
    "customObjectId" TEXT         NOT NULL,
    "data"           JSONB        NOT NULL DEFAULT '{}'::jsonb,
    "createdById"    TEXT,
    "createdAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "custom_records_customObjectId_fkey"
        FOREIGN KEY ("customObjectId")
        REFERENCES "custom_objects"("id")
        ON DELETE CASCADE
        ON UPDATE CASCADE,
    CONSTRAINT "custom_records_createdById_fkey"
        FOREIGN KEY ("createdById")
        REFERENCES "users"("id")
        ON DELETE SET NULL
        ON UPDATE CASCADE
);

CREATE INDEX IF NOT EXISTS "custom_records_org_object_idx"
    ON "custom_records" ("organizationId", "customObjectId");

-- GIN over `data` so containment / key-exists queries are cheap.
CREATE INDEX IF NOT EXISTS "custom_records_data_gin_idx"
    ON "custom_records" USING GIN ("data");

COMMIT;
