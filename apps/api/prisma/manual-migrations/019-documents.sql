-- ─────────────────────────────────────────────────────────────
--  Migration: 019 — document storage with versioning
--
--  Adds polymorphic, versioned file attachments to records
--  (client | invoice | estimate | project | ticket | lead).
--
--    documents          — one logical file per attachment, polymorphic
--                          on (entityType, entityId). No FK to the parent
--                          record (it's one of many tables); the service
--                          layer validates the entity exists in the org.
--    document_versions   — one row per uploaded revision (1-based
--                          `version`). File bytes live in MinIO; only the
--                          object key + metadata are stored here.
--
--  No RLS — this DB has no `app_current_organization_id()` helper and the
--  rest of the app scopes by organizationId in the service layer. We do
--  the same here.
--
--  Apply manually on the VPS:
--    psql "$DATABASE_URL" -f 019-documents.sql
--
--  Idempotent — CREATE TABLE / INDEX IF NOT EXISTS, and the FKs are
--  added only if they don't already exist.
-- ─────────────────────────────────────────────────────────────

BEGIN;

-- ── documents ────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "documents" (
    "id"                TEXT PRIMARY KEY,
    "organizationId"    TEXT NOT NULL,
    "entityType"        TEXT NOT NULL,
    "entityId"          TEXT NOT NULL,
    "name"              TEXT NOT NULL,
    "currentVersionId"  TEXT,
    "createdById"       TEXT,
    "createdAt"         TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"         TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS "documents_organizationId_entityType_entityId_idx"
    ON "documents" ("organizationId", "entityType", "entityId");

-- ── document_versions ────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "document_versions" (
    "id"                TEXT PRIMARY KEY,
    "documentId"        TEXT NOT NULL,
    "organizationId"    TEXT NOT NULL,
    "version"           INTEGER NOT NULL,
    "storageKey"        TEXT NOT NULL,
    "fileName"          TEXT NOT NULL,
    "mimeType"          TEXT NOT NULL,
    "sizeBytes"         INTEGER NOT NULL,
    "uploadedById"      TEXT,
    "note"              TEXT,
    "createdAt"         TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE UNIQUE INDEX IF NOT EXISTS "document_versions_documentId_version_key"
    ON "document_versions" ("documentId", "version");

CREATE INDEX IF NOT EXISTS "document_versions_documentId_idx"
    ON "document_versions" ("documentId");

-- ── Foreign keys (added idempotently) ────────────────────────
DO $$
BEGIN
    -- documents → organizations (CASCADE)
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'documents_organizationId_fkey'
    ) THEN
        ALTER TABLE "documents"
            ADD CONSTRAINT "documents_organizationId_fkey"
            FOREIGN KEY ("organizationId") REFERENCES "organizations"("id")
            ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;

    -- document_versions → documents (CASCADE)
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'document_versions_documentId_fkey'
    ) THEN
        ALTER TABLE "document_versions"
            ADD CONSTRAINT "document_versions_documentId_fkey"
            FOREIGN KEY ("documentId") REFERENCES "documents"("id")
            ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;

    -- document_versions → organizations (CASCADE)
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'document_versions_organizationId_fkey'
    ) THEN
        ALTER TABLE "document_versions"
            ADD CONSTRAINT "document_versions_organizationId_fkey"
            FOREIGN KEY ("organizationId") REFERENCES "organizations"("id")
            ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
END
$$;

COMMIT;
