-- ─────────────────────────────────────────────────────────────
--  Migration: 040 — Einstein Activity Capture (Wave H2)
--
--  Adds three tables:
--
--    * `activities` — the customer-interaction timeline row. A
--      single Activity describes one logged email or SMS pinned
--      to a Client / Lead / Contact (User type='contact') via the
--      polymorphic (relatedToType, relatedToId) pair. Salesforce
--      Einstein Activity Capture's counterpart: a unified
--      timeline of every touch with a customer, whether the rep
--      typed it manually or the system observed it.
--
--    * `activity_capture_settings` — one row per org. Tenant
--      controls whether email / SMS auto-capture is enabled and
--      whether emails between two staff users get logged too
--      ("internal_emails"). Created lazily on first read.
--
--    * `activity_capture_log` — write-once audit row per source
--      message describing WHAT the capture pipeline decided. The
--      UNIQUE (source_type, source_id) is the dedup primitive —
--      the listener can fire twice (retry, replay), and the
--      second write loses the race instead of producing a
--      duplicate Activity row. `reason` carries the human
--      explanation (captured / disabled_by_settings /
--      no_matching_contact / internal_email / duplicate).
--
--  Tenancy:
--    * `organization_id` is denormalised onto all three tables.
--      The service layer is the only tenant boundary (no RLS),
--      so every write/read MUST include it in the WHERE.
--
--  Indexes:
--    * (org, related_to_*) on `activities` — the hot read for
--      "show me this customer's timeline".
--    * (org, source_type) on `activity_capture_log` — ops view of
--      "how many SMS got captured this week".
--    * (activity_id) on `activity_capture_log` — join from an
--      Activity row back to the capture decision that made it.
-- ─────────────────────────────────────────────────────────────

BEGIN;

-- ─── 1. activities ─────────────────────────────────────────────
--
-- The unified-timeline row. Created either by the capture
-- pipeline (auto) or, in future, by a rep manually logging a
-- call/note. The polymorphic (relatedToType, relatedToId) pin
-- mirrors `inbox_messages.routedTo` / `outbound_messages.routedTo`
-- so we can render mixed channels (email + sms + manual notes)
-- in one timeline list. CHECK constraints keep tenants from
-- inventing types the UI doesn't know how to render.

CREATE TABLE IF NOT EXISTS "activities" (
  "id"             TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  "organizationId" TEXT NOT NULL,
  "type"           TEXT NOT NULL
    CHECK ("type" IN ('email', 'sms', 'call', 'note', 'meeting')),
  "channel"        TEXT
    CHECK ("channel" IS NULL OR "channel" IN ('email', 'sms', 'phone', 'in_person')),
  "direction"      TEXT
    CHECK ("direction" IS NULL OR "direction" IN ('inbound', 'outbound')),
  "subject"        TEXT,
  "body"           TEXT,
  -- Polymorphic attach point. Same list as inbox_messages /
  -- outbound_messages for cross-channel consistency.
  "relatedToType"  TEXT NOT NULL
    CHECK ("relatedToType" IN ('client', 'lead', 'contact')),
  "relatedToId"    TEXT NOT NULL,
  -- Optional secondary attach (e.g. a contact under a client).
  -- When set, the timeline UI shows both pins.
  "contactId"      TEXT,
  "occurredAt"     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  "createdAt"      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  "updatedAt"      TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT "activities_org_fk"
    FOREIGN KEY ("organizationId") REFERENCES "organizations"("id")
    ON DELETE CASCADE
);

-- Hot path: "show me the timeline for THIS customer", newest first.
CREATE INDEX IF NOT EXISTS "activities_org_related_idx"
  ON "activities" ("organizationId", "relatedToType", "relatedToId", "occurredAt" DESC);

-- Secondary attach: "show me everything for THIS contact".
CREATE INDEX IF NOT EXISTS "activities_org_contact_idx"
  ON "activities" ("organizationId", "contactId", "occurredAt" DESC);

-- ─── 2. activity_capture_settings ──────────────────────────────
--
-- Per-org toggles for the capture pipeline. The row is created
-- lazily on first read with the defaults baked in here, so the
-- listener never has to short-circuit on "no row yet".

CREATE TABLE IF NOT EXISTS "activity_capture_settings" (
  "id"                      TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  "organizationId"          TEXT NOT NULL UNIQUE,
  "emailCaptureEnabled"     BOOLEAN NOT NULL DEFAULT TRUE,
  "smsCaptureEnabled"       BOOLEAN NOT NULL DEFAULT TRUE,
  -- Default OFF — most tenants don't want internal staff↔staff
  -- mail polluting customer timelines.
  "captureInternalEmails"   BOOLEAN NOT NULL DEFAULT FALSE,
  "createdAt"               TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  "updatedAt"               TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT "activity_capture_settings_org_fk"
    FOREIGN KEY ("organizationId") REFERENCES "organizations"("id")
    ON DELETE CASCADE
);

-- ─── 3. activity_capture_log ───────────────────────────────────
--
-- Write-once audit + dedup row per source message. The
-- UNIQUE (source_type, source_id) is the dedup primitive: the
-- listener can fire twice (retry, replay, backfill rerun) and
-- only the first write wins. The second hits P2002 and the
-- service treats it as "already captured, skip".
--
-- `activityId` is nullable because we also write a log row when
-- nothing matched (no_matching_contact) or capture was off
-- (disabled_by_settings / internal_email) — ops needs to see
-- those negative outcomes too.

CREATE TABLE IF NOT EXISTS "activity_capture_log" (
  "id"             TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  "organizationId" TEXT NOT NULL,
  "sourceType"     TEXT NOT NULL
    CHECK ("sourceType" IN ('outbound_email', 'inbound_email', 'outbound_sms', 'inbound_sms')),
  "sourceId"       TEXT NOT NULL,
  "activityId"    TEXT,
  "matched"        BOOLEAN NOT NULL DEFAULT FALSE,
  "reason"         TEXT NOT NULL,
  "createdAt"      TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT "activity_capture_log_org_fk"
    FOREIGN KEY ("organizationId") REFERENCES "organizations"("id")
    ON DELETE CASCADE,
  CONSTRAINT "activity_capture_log_activity_fk"
    FOREIGN KEY ("activityId") REFERENCES "activities"("id")
    ON DELETE SET NULL,

  -- Belt-and-braces dedup: even a buggy listener that fires
  -- twice for the same OutboundMessage / InboxMessage / SmsMessage
  -- can only produce one Activity. The second insert loses on
  -- P2002 and the service short-circuits.
  CONSTRAINT "activity_capture_log_source_uniq"
    UNIQUE ("sourceType", "sourceId")
);

CREATE INDEX IF NOT EXISTS "activity_capture_log_org_source_idx"
  ON "activity_capture_log" ("organizationId", "sourceType");

CREATE INDEX IF NOT EXISTS "activity_capture_log_activity_idx"
  ON "activity_capture_log" ("activityId");

COMMIT;
