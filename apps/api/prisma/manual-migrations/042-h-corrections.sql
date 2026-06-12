-- ─────────────────────────────────────────────────────────────
--  Migration: 042 — Wave H corrections
--
--  Two fixes for issues caught during Wave H smoke:
--  1. bulk_operations columns were created with snake_case but
--     the rest of the project uses camelCase quoted columns.
--     Rename all 9 affected columns + reindex.
--  2. (Schema-only — no DDL here): work_orders Prisma model
--     was missing forward `client` / `opportunity` relations.
--     Added in schema.prisma, no DB change needed because the
--     FKs already exist.
-- ─────────────────────────────────────────────────────────────

BEGIN;

ALTER TABLE bulk_operations RENAME COLUMN organization_id TO "organizationId";
ALTER TABLE bulk_operations RENAME COLUMN entity_type     TO "entityType";
ALTER TABLE bulk_operations RENAME COLUMN total_rows      TO "totalRows";
ALTER TABLE bulk_operations RENAME COLUMN succeeded_rows  TO "succeededRows";
ALTER TABLE bulk_operations RENAME COLUMN failed_rows     TO "failedRows";
ALTER TABLE bulk_operations RENAME COLUMN errors_json     TO "errorsJson";
ALTER TABLE bulk_operations RENAME COLUMN started_at      TO "startedAt";
ALTER TABLE bulk_operations RENAME COLUMN completed_at    TO "completedAt";
ALTER TABLE bulk_operations RENAME COLUMN created_by_id   TO "createdById";

-- Indexes auto-track renamed columns; no rebuild needed.

COMMIT;
