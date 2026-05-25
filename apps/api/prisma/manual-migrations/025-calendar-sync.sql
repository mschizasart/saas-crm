-- ─────────────────────────────────────────────────────────────
--  Migration: 025 — 2-way calendar sync (Google Calendar + Outlook)
--  Adds per-user, per-provider OAuth links so the internal calendar
--  (events table) can sync events to/from the user's real Google or
--  Microsoft calendar.
--
--  Two parts:
--    1. calendar_syncs  — one row per (user, provider). Holds the
--       encrypted OAuth tokens + sync state. Mirrors the email OAuth
--       storage pattern (AES-256-GCM, ENCRYPTION_KEY).
--    2. events.*        — four nullable columns that map a local event
--       to its remote counterpart and let us detect local changes
--       worth pushing (syncHash) without re-pushing pulled events.
--
--  Apply manually on the VPS (we don't run `prisma migrate` in prod):
--
--    psql "$DATABASE_URL" -f 025-calendar-sync.sql
--
--  Safe to re-run: uses IF NOT EXISTS / ADD COLUMN IF NOT EXISTS.
--
--  NOTE: deliberately NO RLS policy here — app_current_organization_id()
--  is not defined on this database (same situation as email_settings /
--  ai_settings / tax_settings). Tenant isolation is enforced in the
--  service layer via prisma.withOrganization(orgId, …) and by scoping
--  every query on organizationId + userId.
-- ─────────────────────────────────────────────────────────────

-- ── calendar_syncs (one row per user per provider) ────────────
CREATE TABLE IF NOT EXISTS "calendar_syncs" (
    "id"                   TEXT         PRIMARY KEY DEFAULT gen_random_uuid()::text,
    "organizationId"       TEXT         NOT NULL,
    "userId"               TEXT         NOT NULL,
    -- 'google' | 'microsoft'
    "provider"             TEXT         NOT NULL,
    -- AES-256-GCM encrypted (iv:tag:cipher hex) — never returned raw.
    "refreshToken"         TEXT         NOT NULL,
    -- Cached access token, also encrypted; refreshed on demand.
    "accessToken"          TEXT,
    "tokenExpiresAt"       TIMESTAMP(3),
    -- Which remote calendar we read/write (Google calendarId / Graph
    -- calendar id). NULL = the account's primary calendar.
    "externalCalendarId"   TEXT,
    "syncEnabled"          BOOLEAN      NOT NULL DEFAULT TRUE,
    -- 'both' | 'push' | 'pull'
    "syncDirection"        TEXT         NOT NULL DEFAULT 'both',
    "lastSyncedAt"         TIMESTAMP(3),
    "lastSyncError"        TEXT,
    -- The email the user consented with (display only).
    "connectedEmail"       TEXT,
    "createdAt"            TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"            TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "calendar_syncs_organizationId_fkey"
        FOREIGN KEY ("organizationId")
        REFERENCES "organizations"("id")
        ON DELETE CASCADE
        ON UPDATE CASCADE,
    CONSTRAINT "calendar_syncs_userId_fkey"
        FOREIGN KEY ("userId")
        REFERENCES "users"("id")
        ON DELETE CASCADE
        ON UPDATE CASCADE
);

-- One connection per user per provider (@@unique([userId, provider])).
CREATE UNIQUE INDEX IF NOT EXISTS "calendar_syncs_userId_provider_key"
    ON "calendar_syncs" ("userId", "provider");

-- Scheduler scans for enabled rows; org-scoped lookups in the service.
CREATE INDEX IF NOT EXISTS "calendar_syncs_organizationId_idx"
    ON "calendar_syncs" ("organizationId");
CREATE INDEX IF NOT EXISTS "calendar_syncs_syncEnabled_idx"
    ON "calendar_syncs" ("syncEnabled");

-- ── events: local↔remote mapping columns ──────────────────────
-- externalId       : the remote event id (Google event id / Graph id).
-- externalProvider : 'google' | 'microsoft' — which remote owns it.
-- lastSyncedAt     : last time this row was reconciled with the remote.
-- syncHash         : hash of the local event's sync-relevant fields.
--                    A changed hash means the local copy was edited and
--                    is worth pushing; an unchanged hash after a pull
--                    means "this is exactly what we pulled, don't echo".
ALTER TABLE "events" ADD COLUMN IF NOT EXISTS "externalId"       TEXT;
ALTER TABLE "events" ADD COLUMN IF NOT EXISTS "externalProvider" TEXT;
ALTER TABLE "events" ADD COLUMN IF NOT EXISTS "lastSyncedAt"     TIMESTAMP(3);
ALTER TABLE "events" ADD COLUMN IF NOT EXISTS "syncHash"         TEXT;

-- Fast lookup when reconciling a pulled remote event back to its local row.
CREATE INDEX IF NOT EXISTS "events_externalId_idx"
    ON "events" ("externalProvider", "externalId");
