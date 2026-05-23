-- ─────────────────────────────────────────────────────────────
--  Migration: 022 — sms (Twilio)
--  Adds per-organization Twilio SMS configuration + a message log
--  (outbound sends + inbound webhook receipts).
--  Apply manually on the VPS (we don't run `prisma migrate` in prod).
--
--    psql "$DATABASE_URL" -f 022-sms.sql
--
--  Safe to re-run: uses IF NOT EXISTS everywhere.
--
--  NOTE: deliberately NO RLS policy here — app_current_organization_id()
--  is not defined on this database (same situation as email_settings /
--  ai_settings). Tenant isolation is enforced in the service layer via
--  prisma.withOrganization(orgId, …).
--
--  authToken is stored AES-256-GCM encrypted (iv:tag:cipher hex) by the
--  app; it is never written here in plaintext and never returned raw.
-- ─────────────────────────────────────────────────────────────

-- ─── Per-org Twilio settings (one row per org) ───────────────────────
CREATE TABLE IF NOT EXISTS "sms_settings" (
    "id"              TEXT         PRIMARY KEY DEFAULT gen_random_uuid()::text,
    "organizationId"  TEXT         NOT NULL UNIQUE,
    "provider"        TEXT         NOT NULL DEFAULT 'TWILIO',
    "accountSid"      TEXT,
    -- AES-256-GCM encrypted (iv:tag:cipher hex) — never returned raw
    "authToken"       TEXT,
    "fromNumber"      TEXT,
    "enabled"         BOOLEAN      NOT NULL DEFAULT FALSE,
    "createdAt"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "sms_settings_organizationId_fkey"
        FOREIGN KEY ("organizationId")
        REFERENCES "organizations"("id")
        ON DELETE CASCADE
        ON UPDATE CASCADE
);

-- Index to accelerate tenant lookups (redundant with UNIQUE but explicit).
CREATE INDEX IF NOT EXISTS "sms_settings_organizationId_idx"
    ON "sms_settings" ("organizationId");

-- ─── SMS message log (outbound + inbound) ────────────────────────────
CREATE TABLE IF NOT EXISTS "sms_messages" (
    "id"              TEXT         PRIMARY KEY DEFAULT gen_random_uuid()::text,
    "organizationId"  TEXT         NOT NULL,
    -- 'outbound' | 'inbound'
    "direction"       TEXT         NOT NULL,
    -- 'ticket' | 'lead' | 'client' | NULL
    "entityType"      TEXT,
    "entityId"        TEXT,
    "toNumber"        TEXT         NOT NULL,
    "fromNumber"      TEXT         NOT NULL,
    "body"            TEXT         NOT NULL,
    -- 'queued' | 'sent' | 'delivered' | 'failed' | 'received'
    "status"          TEXT         NOT NULL,
    -- Twilio message SID (e.g. SMxxxxxxxx)
    "providerSid"     TEXT,
    "errorMessage"    TEXT,
    -- staff user who sent it (outbound only)
    "sentById"        TEXT,
    "createdAt"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "sms_messages_organizationId_fkey"
        FOREIGN KEY ("organizationId")
        REFERENCES "organizations"("id")
        ON DELETE CASCADE
        ON UPDATE CASCADE
);

-- Thread lookup: all messages for a given CRM record.
CREATE INDEX IF NOT EXISTS "sms_messages_org_entity_idx"
    ON "sms_messages" ("organizationId", "entityType", "entityId");

-- Chronological listing per org.
CREATE INDEX IF NOT EXISTS "sms_messages_org_createdAt_idx"
    ON "sms_messages" ("organizationId", "createdAt");
