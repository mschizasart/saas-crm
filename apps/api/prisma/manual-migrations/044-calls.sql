-- ─────────────────────────────────────────────────────────────
--  Migration: 044 — built-in calling + call logging
--
--  Adds:
--    calls                      — one row per phone call. Two flavours
--                                 share the table:
--                                   (A) manually logged calls — staff record
--                                       a call after the fact. status='logged',
--                                       loggedById set, outcome/duration/notes
--                                       filled by the rep.
--                                   (B) Twilio click-to-call — an outbound call
--                                       initiated from the UI that bridges the
--                                       agent's phone to the customer. status
--                                       starts 'queued' and is driven through
--                                       initiated → ringing → in-progress →
--                                       completed by the public status webhook;
--                                       the recording webhook fills
--                                       recordingUrl / recordingPath.
--                                 Polymorphically pinned to a lead/client via
--                                 relType/relId so the call shows on that
--                                 record's activity timeline (an `activities`
--                                 row is written when a call is logged or a
--                                 click-to-call completes).
--                                 Reuses the org's sms_settings Twilio
--                                 credentials — there is NO separate calling
--                                 credentials table.
--
--  No RLS — this DB has no `app_current_organization_id()` helper; tenant
--  isolation is enforced in the service layer via prisma.withOrganization()
--  (same as sms / campaigns / sequences).
--
--  Apply manually on the VPS:
--    psql "$DATABASE_URL" -f 044-calls.sql
--
--  Idempotent — CREATE TABLE / INDEX IF NOT EXISTS; FK added only if absent.
-- ─────────────────────────────────────────────────────────────

BEGIN;

-- ── calls ────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "calls" (
    "id"               TEXT         PRIMARY KEY DEFAULT gen_random_uuid()::text,
    "organizationId"   TEXT         NOT NULL,
    -- 'lead' | 'client'
    "relType"          TEXT,
    "relId"            TEXT,
    -- 'outbound' | 'inbound'
    "direction"        TEXT         NOT NULL,
    "fromNumber"       TEXT,
    "toNumber"         TEXT         NOT NULL,
    -- logged | queued | initiated | ringing | in-progress | completed |
    -- busy | no-answer | failed | canceled
    "status"           TEXT         NOT NULL DEFAULT 'logged',
    -- connected | voicemail | no_answer | busy | wrong_number | callback_requested
    "outcome"          TEXT,
    "durationSeconds"  INTEGER      NOT NULL DEFAULT 0,
    "notes"            TEXT,
    "recordingUrl"     TEXT,
    "recordingPath"    TEXT,
    "twilioCallSid"    TEXT,
    "loggedById"       TEXT,
    "occurredAt"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt"        TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"        TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Per-record timeline / global call log fetch (filter by lead/client).
CREATE INDEX IF NOT EXISTS "calls_org_rel_idx"
    ON "calls" ("organizationId", "relType", "relId");

-- Global call-log listing, newest first.
CREATE INDEX IF NOT EXISTS "calls_org_occurred_idx"
    ON "calls" ("organizationId", "occurredAt");

-- Webhook lookup by Twilio CallSid (status + recording callbacks).
CREATE INDEX IF NOT EXISTS "calls_twilio_sid_idx"
    ON "calls" ("twilioCallSid");

-- ── Foreign keys (added only if absent) ──────────────────────
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'calls_organizationId_fkey'
    ) THEN
        ALTER TABLE "calls"
            ADD CONSTRAINT "calls_organizationId_fkey"
            FOREIGN KEY ("organizationId") REFERENCES "organizations"("id")
            ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
END $$;

COMMIT;
