-- Migration: 008-ticket-spam-filters
-- Creates the `ticket_spam_filters` table for tenant-defined inbound-ticket
-- spam rules. Each rule matches an inbound email field (subject, fromEmail,
-- body, fromDomain) against a pattern (contains, equals, startsWith,
-- endsWith, regex) and applies an action (mark_spam, auto_close, reject)
-- when the IMAP processor converts a message into a ticket.
--
-- Safe to run more than once: uses IF NOT EXISTS guards throughout.
-- Apply with: psql "$DATABASE_URL" -f 008-ticket-spam-filters.sql

BEGIN;

CREATE TABLE IF NOT EXISTS "ticket_spam_filters" (
  "id"              TEXT         PRIMARY KEY,
  "organizationId"  TEXT         NOT NULL,
  "name"            TEXT         NOT NULL,
  "field"           TEXT         NOT NULL,
  "operator"        TEXT         NOT NULL,
  "pattern"         TEXT         NOT NULL,
  "caseSensitive"   BOOLEAN      NOT NULL DEFAULT false,
  "action"          TEXT         NOT NULL,
  "isActive"        BOOLEAN      NOT NULL DEFAULT true,
  "priority"        INTEGER      NOT NULL DEFAULT 0,
  "matchCount"      INTEGER      NOT NULL DEFAULT 0,
  "lastMatchedAt"   TIMESTAMP(3),
  "createdAt"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "ticket_spam_filters_organization_fkey"
    FOREIGN KEY ("organizationId")
    REFERENCES "organizations" ("id")
    ON DELETE CASCADE
    ON UPDATE CASCADE
);

CREATE INDEX IF NOT EXISTS "ticket_spam_filters_organizationId_idx"
  ON "ticket_spam_filters" ("organizationId");

CREATE INDEX IF NOT EXISTS "ticket_spam_filters_org_active_priority_idx"
  ON "ticket_spam_filters" ("organizationId", "isActive", "priority");

COMMIT;
