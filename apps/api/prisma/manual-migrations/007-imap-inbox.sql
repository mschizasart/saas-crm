-- ─────────────────────────────────────────────────────────────
--  Migration: 007 — IMAP inbox sync
--
--  1. Adds IMAP credential / state columns to email_settings.
--     OAuth (Gmail / Microsoft) reuses oauthRefreshToken — no
--     new fields needed for XOAUTH2 IMAP.
--  2. Creates inbox_messages — one row per fetched RFC822 message,
--     deduped on (organizationId, messageId).
--  3. Creates outbound_messages — minimal record of outbound mail
--     keyed by RFC822 Message-ID, used by the inbox router to
--     thread inbound replies back to the originating record.
--
--  Apply manually on the VPS (we don't run `prisma migrate` in prod):
--      psql "$DATABASE_URL" -f 007-imap-inbox.sql
--
--  Safe to re-run: every statement is idempotent.
-- ─────────────────────────────────────────────────────────────

-- ── 1. email_settings — IMAP columns ─────────────────────────
ALTER TABLE "email_settings"
    ADD COLUMN IF NOT EXISTS "imapHost"           TEXT;
ALTER TABLE "email_settings"
    ADD COLUMN IF NOT EXISTS "imapPort"           INTEGER;
ALTER TABLE "email_settings"
    ADD COLUMN IF NOT EXISTS "imapUser"           TEXT;
-- AES-256-GCM encrypted (iv:tag:cipher hex) — same scheme as smtpPassword.
ALTER TABLE "email_settings"
    ADD COLUMN IF NOT EXISTS "imapPassword"       TEXT;
ALTER TABLE "email_settings"
    ADD COLUMN IF NOT EXISTS "imapTls"            BOOLEAN     NOT NULL DEFAULT TRUE;
ALTER TABLE "email_settings"
    ADD COLUMN IF NOT EXISTS "imapEnabled"        BOOLEAN     NOT NULL DEFAULT FALSE;
-- INBOX UIDNEXT high-water mark — we fetch UID > imapLastUidNext on each poll.
ALTER TABLE "email_settings"
    ADD COLUMN IF NOT EXISTS "imapLastUidNext"    INTEGER;
ALTER TABLE "email_settings"
    ADD COLUMN IF NOT EXISTS "imapLastSyncedAt"   TIMESTAMP(3);
ALTER TABLE "email_settings"
    ADD COLUMN IF NOT EXISTS "imapLastError"      TEXT;

-- ── 2. inbox_messages ────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "inbox_messages" (
    "id"               TEXT         PRIMARY KEY DEFAULT gen_random_uuid()::text,
    "organizationId"   TEXT         NOT NULL,
    -- RFC822 Message-ID (incl. angle brackets) — used for dedup + threading.
    "messageId"        TEXT         NOT NULL,
    "inReplyTo"        TEXT,
    -- RFC822 References header split on whitespace.
    "referenceIds"     TEXT[]       NOT NULL DEFAULT '{}',
    "fromEmail"        TEXT         NOT NULL,
    "fromName"         TEXT,
    "toEmails"         TEXT[]       NOT NULL DEFAULT '{}',
    "ccEmails"         TEXT[]       NOT NULL DEFAULT '{}',
    "subject"          TEXT,
    "bodyText"         TEXT,
    "bodyHtml"         TEXT,
    -- IMAP INTERNALDATE (or Date: header fallback).
    "receivedAt"       TIMESTAMP(3) NOT NULL,
    "attachmentCount"  INTEGER      NOT NULL DEFAULT 0,
    -- JSON array of {filename, contentType, size}. Bodies NOT fetched in v1.
    "attachmentsJson"  JSONB        NOT NULL DEFAULT '[]',
    -- Routing — filled at sync time, may be re-routed by user later.
    -- Allowed: 'lead' | 'client' | 'invoice' | 'estimate' | 'ticket' | 'unmatched'
    "routedTo"         TEXT         NOT NULL DEFAULT 'unmatched',
    "routedToId"       TEXT,
    "isRead"           BOOLEAN      NOT NULL DEFAULT FALSE,
    "isStarred"        BOOLEAN      NOT NULL DEFAULT FALSE,
    "isArchived"       BOOLEAN      NOT NULL DEFAULT FALSE,
    -- Full headers map for debugging.
    "rawHeadersJson"   JSONB        NOT NULL DEFAULT '{}',
    "createdAt"        TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "inbox_messages_organizationId_fkey"
        FOREIGN KEY ("organizationId")
        REFERENCES "organizations"("id")
        ON DELETE CASCADE
        ON UPDATE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS "inbox_messages_org_messageId_uniq"
    ON "inbox_messages" ("organizationId", "messageId");

CREATE INDEX IF NOT EXISTS "inbox_messages_org_routed_idx"
    ON "inbox_messages" ("organizationId", "routedTo", "routedToId");

CREATE INDEX IF NOT EXISTS "inbox_messages_org_archived_received_idx"
    ON "inbox_messages" ("organizationId", "isArchived", "receivedAt" DESC);

-- RLS — same tenant_isolation pattern as the rest of the schema.
ALTER TABLE "inbox_messages" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "inbox_messages" FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation ON "inbox_messages";
CREATE POLICY tenant_isolation ON "inbox_messages"
    USING ("organizationId"::uuid = app_current_organization_id());

-- ── 3. outbound_messages ─────────────────────────────────────
-- Tiny side table that records the RFC822 Message-ID nodemailer hands back
-- when we send mail tied to a record. The inbox router uses this to thread
-- replies (In-Reply-To / References) back to the originating Lead / Invoice / …
CREATE TABLE IF NOT EXISTS "outbound_messages" (
    "id"               TEXT         PRIMARY KEY DEFAULT gen_random_uuid()::text,
    "organizationId"   TEXT         NOT NULL,
    "messageId"        TEXT         NOT NULL,
    -- 'lead' | 'client' | 'invoice' | 'estimate' | 'ticket'
    "routedTo"         TEXT         NOT NULL,
    "routedToId"       TEXT         NOT NULL,
    "subject"          TEXT,
    "sentAt"           TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt"        TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "outbound_messages_organizationId_fkey"
        FOREIGN KEY ("organizationId")
        REFERENCES "organizations"("id")
        ON DELETE CASCADE
        ON UPDATE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS "outbound_messages_org_messageId_uniq"
    ON "outbound_messages" ("organizationId", "messageId");

CREATE INDEX IF NOT EXISTS "outbound_messages_org_routed_idx"
    ON "outbound_messages" ("organizationId", "routedTo", "routedToId");

ALTER TABLE "outbound_messages" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "outbound_messages" FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation ON "outbound_messages";
CREATE POLICY tenant_isolation ON "outbound_messages"
    USING ("organizationId"::uuid = app_current_organization_id());
