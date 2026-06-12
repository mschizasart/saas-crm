-- ─────────────────────────────────────────────────────────────
--  Migration: 041 — Bulk Operations (Wave H3)
--
--  Audit log for bulk imports / bulk API calls. Every
--  bulk-create / bulk-update / bulk-delete / csv-import request
--  writes one row here so users can review past runs (counts,
--  status, sample errors) on the "Bulk Imports" page.
--
--  TENANCY:
--    * `organization_id` is required and FK CASCADE on
--      organisations(id) — drop an org and its bulk-op history
--      goes with it (same as exports / dunning).
--    * No RLS — service-layer scoping via withOrganization +
--      explicit `where: { organizationId }`.
--    * `created_by_id` is FK to users(id) ON DELETE SET NULL so
--      a deleted user's import history stays readable; the row
--      just loses the "who ran this" attribution.
--
--  ERRORS COLUMN:
--    `errors_json` stores up to the first 50 per-row failures
--    so the detail page can render them without re-running the
--    import. The full failure list is NEVER stored — at 1000
--    rows × N kB error messages we'd inflate the table fast.
--    The detail page surfaces this cap to the user.
--
--  STATUS:
--    'processing' (set at request start) → 'completed' or
--    'failed'. 'failed' means the whole batch couldn't start
--    (e.g. CSV parse error). Per-row failures inside a
--    successful run still finish as 'completed' with a non-zero
--    `failed_rows` count.
-- ─────────────────────────────────────────────────────────────

BEGIN;

CREATE TABLE IF NOT EXISTS bulk_operations (
  id              TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  organization_id TEXT NOT NULL,
  -- 'bulk_create' | 'bulk_update' | 'bulk_delete' | 'csv_import'
  type            TEXT NOT NULL,
  -- 'client' | 'lead' | 'opportunity' | 'task'
  entity_type     TEXT NOT NULL,
  total_rows      INTEGER NOT NULL DEFAULT 0,
  succeeded_rows  INTEGER NOT NULL DEFAULT 0,
  failed_rows     INTEGER NOT NULL DEFAULT 0,
  errors_json     JSONB NOT NULL DEFAULT '[]'::jsonb,
  -- 'processing' | 'completed' | 'failed'
  status          TEXT NOT NULL DEFAULT 'processing',
  started_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at    TIMESTAMPTZ,
  created_by_id   TEXT,

  CONSTRAINT bulk_operations_type_chk
    CHECK (type IN ('bulk_create','bulk_update','bulk_delete','csv_import')),
  CONSTRAINT bulk_operations_entity_chk
    CHECK (entity_type IN ('client','lead','opportunity','task')),
  CONSTRAINT bulk_operations_status_chk
    CHECK (status IN ('processing','completed','failed')),

  CONSTRAINT bulk_operations_org_fk
    FOREIGN KEY (organization_id)
    REFERENCES organizations(id)
    ON DELETE CASCADE,

  CONSTRAINT bulk_operations_user_fk
    FOREIGN KEY (created_by_id)
    REFERENCES users(id)
    ON DELETE SET NULL
);

-- Primary access pattern: "show me MY recent bulk runs" on the
-- Bulk Imports page. The (org, user, started_at desc) ordering
-- matches the SQL the list endpoint emits.
CREATE INDEX IF NOT EXISTS bulk_operations_org_user_started_idx
  ON bulk_operations (organization_id, created_by_id, started_at DESC);

-- Secondary: org-wide "all imports" admin view filtered by
-- entity type (e.g. just CSV-import history for clients).
CREATE INDEX IF NOT EXISTS bulk_operations_org_entity_started_idx
  ON bulk_operations (organization_id, entity_type, started_at DESC);

COMMIT;
