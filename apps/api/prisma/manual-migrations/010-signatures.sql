-- Migration: 010-signatures
-- Adds native e-signature support for proposals and contracts.
--
-- Creates:
--   * `signatures` table — one row per signing event (polymorphic via
--     `documentType` + `documentId`; no FK because the parent is either
--     Proposal or Contract). Audit events are stored in JSONB.
--   * `signatureRequired` boolean on `proposals` and `contracts` to toggle
--     between the legacy click-to-accept flow and the e-signature flow.
--
-- The `signedAt` columns already exist on both `proposals` and `contracts`
-- from earlier migrations, so we only ensure they're present (idempotent).
--
-- Safe to run more than once. Apply with:
--   psql "$DATABASE_URL" -f 010-signatures.sql

BEGIN;

-- ─── signatures ──────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "signatures" (
  "id"                   TEXT         PRIMARY KEY,
  "organizationId"       TEXT         NOT NULL,
  "documentType"         TEXT         NOT NULL,
  "documentId"           TEXT         NOT NULL,
  "signerName"           TEXT         NOT NULL,
  "signerEmail"          TEXT         NOT NULL,
  "signatureImageKey"    TEXT         NOT NULL,
  "signedAt"             TIMESTAMP(3) NOT NULL,
  "ipAddress"            TEXT         NOT NULL,
  "userAgent"            TEXT         NOT NULL,
  "geoCountry"           TEXT,
  "signedDocumentPdfKey" TEXT,
  "auditEvents"          JSONB        NOT NULL DEFAULT '[]'::jsonb,
  "revokedAt"            TIMESTAMP(3),
  "revokedReason"        TEXT,
  "createdAt"            TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "signatures_organizationId_fkey"
    FOREIGN KEY ("organizationId") REFERENCES "organizations"("id")
    ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX IF NOT EXISTS "signatures_org_doc_idx"
  ON "signatures" ("organizationId", "documentType", "documentId");

CREATE INDEX IF NOT EXISTS "signatures_org_signedAt_idx"
  ON "signatures" ("organizationId", "signedAt" DESC);

-- ─── proposals ───────────────────────────────────────────────────────────
ALTER TABLE "proposals"
  ADD COLUMN IF NOT EXISTS "signatureRequired" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS "signedAt"          TIMESTAMP(3);

-- ─── contracts ───────────────────────────────────────────────────────────
ALTER TABLE "contracts"
  ADD COLUMN IF NOT EXISTS "signatureRequired" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS "signedAt"          TIMESTAMP(3);

COMMIT;
