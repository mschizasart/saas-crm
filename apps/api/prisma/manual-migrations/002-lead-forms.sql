-- Migration: 002-lead-forms
-- Creates the `lead_forms` table for the web-to-lead forms feature.
--
-- Safe to run more than once: uses IF NOT EXISTS guards throughout.
-- Apply with: psql "$DATABASE_URL" -f 002-lead-forms.sql

BEGIN;

CREATE TABLE IF NOT EXISTS "lead_forms" (
  "id"               TEXT        PRIMARY KEY,
  "organizationId"   TEXT        NOT NULL,
  "slug"             TEXT        NOT NULL,
  "name"             TEXT        NOT NULL,
  "title"            TEXT        NOT NULL,
  "description"      TEXT,
  "fields"           JSONB       NOT NULL DEFAULT '[]'::jsonb,
  "redirectUrl"      TEXT,
  "captchaEnabled"   BOOLEAN     NOT NULL DEFAULT true,
  "notifyEmail"      TEXT,
  "assignToUserId"   TEXT,
  "isActive"         BOOLEAN     NOT NULL DEFAULT true,
  "submissionCount"  INTEGER     NOT NULL DEFAULT 0,
  "createdAt"        TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"        TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "lead_forms_organization_fkey"
    FOREIGN KEY ("organizationId")
    REFERENCES "organizations" ("id")
    ON DELETE CASCADE
    ON UPDATE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS "lead_forms_organizationId_slug_key"
  ON "lead_forms" ("organizationId", "slug");

CREATE INDEX IF NOT EXISTS "lead_forms_organizationId_idx"
  ON "lead_forms" ("organizationId");

COMMIT;
