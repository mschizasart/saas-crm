-- Migration: 006-estimate-request-forms
-- Creates the `estimate_request_forms` table for the public "Request a quote"
-- forms feature. Submissions create draft Estimates that the tenant reviews
-- and finalises by hand.
--
-- Mirrors 002-lead-forms.sql; adds defaultClientId / defaultCurrencyId so the
-- generated Estimate can attach to an existing client and use a non-default
-- currency.
--
-- Safe to run more than once: uses IF NOT EXISTS guards throughout.
-- Apply with: psql "$DATABASE_URL" -f 006-estimate-request-forms.sql

BEGIN;

CREATE TABLE IF NOT EXISTS "estimate_request_forms" (
  "id"                 TEXT        PRIMARY KEY,
  "organizationId"     TEXT        NOT NULL,
  "slug"               TEXT        NOT NULL,
  "name"               TEXT        NOT NULL,
  "title"              TEXT        NOT NULL,
  "description"        TEXT,
  "fields"             JSONB       NOT NULL DEFAULT '[]'::jsonb,
  "defaultClientId"    TEXT,
  "defaultCurrencyId"  TEXT,
  "redirectUrl"        TEXT,
  "captchaEnabled"     BOOLEAN     NOT NULL DEFAULT true,
  "notifyEmail"        TEXT,
  "assignToUserId"     TEXT,
  "isActive"           BOOLEAN     NOT NULL DEFAULT true,
  "submissionCount"    INTEGER     NOT NULL DEFAULT 0,
  "createdAt"          TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"          TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "estimate_request_forms_organization_fkey"
    FOREIGN KEY ("organizationId")
    REFERENCES "organizations" ("id")
    ON DELETE CASCADE
    ON UPDATE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS "estimate_request_forms_organizationId_slug_key"
  ON "estimate_request_forms" ("organizationId", "slug");

CREATE INDEX IF NOT EXISTS "estimate_request_forms_organizationId_idx"
  ON "estimate_request_forms" ("organizationId");

COMMIT;
