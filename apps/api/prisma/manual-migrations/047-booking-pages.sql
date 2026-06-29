-- ─────────────────────────────────────────────────────────────
--  Migration: 047 — public self-service booking pages (Calendly-style)
--
--  Adds:
--    booking_pages                              — one row per configurable
--                                                 public booking link. Visitors
--                                                 (no auth) open
--                                                 /book/:orgSlug/:slug, see slots
--                                                 derived from `workingHours`
--                                                 (expressed in `timezone`), and
--                                                 book — creating an Appointment
--                                                 with source='booking-page'.
--
--  Also extends the existing `appointments` table with the public-booking
--  columns (source, bookingPageId, attendeeName, attendeeEmail) used to record
--  who booked an unauthenticated slot. These are ADDED idempotently.
--
--  No RLS — this DB has no `app_current_organization_id()` helper; tenant
--  isolation is enforced in the service layer via prisma.withOrganization()
--  (same as sms / campaigns / sequences / calls / dedup / validation rules).
--
--  Apply manually on the VPS:
--    psql "$DATABASE_URL" -f 047-booking-pages.sql
--
--  Idempotent — CREATE TABLE / CREATE INDEX IF NOT EXISTS; ALTER ... ADD COLUMN
--  IF NOT EXISTS for the appointment additions; FKs added only if absent.
-- ─────────────────────────────────────────────────────────────

BEGIN;

-- ── booking_pages ────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "booking_pages" (
    "id"               TEXT         PRIMARY KEY DEFAULT gen_random_uuid()::text,
    "organizationId"   TEXT         NOT NULL,
    -- public URL key — lowercase-hyphen, unique per org
    "slug"             TEXT         NOT NULL,
    "title"            TEXT         NOT NULL,
    "description"      TEXT,
    -- the User (type='staff') who gets booked (scalar, mirrors appointments.staffId)
    "staffId"          TEXT         NOT NULL,
    "durationMinutes"  INTEGER      NOT NULL DEFAULT 30,
    "bufferMinutes"    INTEGER      NOT NULL DEFAULT 0,
    "minLeadTimeHours" INTEGER      NOT NULL DEFAULT 0,
    "maxAdvanceDays"   INTEGER      NOT NULL DEFAULT 30,
    -- IANA tz the working hours are expressed in
    "timezone"         TEXT         NOT NULL DEFAULT 'UTC',
    -- { mon:[{start:"09:00",end:"17:00"}], ... } ; missing/empty weekday = closed
    "workingHours"     JSONB        NOT NULL DEFAULT '{}',
    "meetingLocation"  TEXT,
    "active"           BOOLEAN      NOT NULL DEFAULT true,
    "createdAt"        TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"        TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- One slug per org for the public URL.
CREATE UNIQUE INDEX IF NOT EXISTS "booking_pages_org_slug_key"
    ON "booking_pages" ("organizationId", "slug");

-- Per-org page listing.
CREATE INDEX IF NOT EXISTS "booking_pages_org_idx"
    ON "booking_pages" ("organizationId");

-- ── appointments additions (public-booking metadata) ─────────
ALTER TABLE "appointments" ADD COLUMN IF NOT EXISTS "source"        TEXT;
ALTER TABLE "appointments" ADD COLUMN IF NOT EXISTS "bookingPageId" TEXT;
ALTER TABLE "appointments" ADD COLUMN IF NOT EXISTS "attendeeName"  TEXT;
ALTER TABLE "appointments" ADD COLUMN IF NOT EXISTS "attendeeEmail" TEXT;

-- Availability conflict-check lookup: existing slots for a staff member.
CREATE INDEX IF NOT EXISTS "appointments_org_staff_start_idx"
    ON "appointments" ("organizationId", "staffId", "startTime");

-- DB-level double-booking guard: two non-cancelled bookings cannot share the
-- same (org, staff, exact start). Backstops the in-tx conflict check, which is
-- racy under READ COMMITTED. A unique-violation (23505 / Prisma P2002) is caught
-- in BookingService.book() and surfaced as a clean 409. Partial WHERE cannot be
-- modeled in schema.prisma (Prisma can't express a partial-unique), so SQL-only.
CREATE UNIQUE INDEX IF NOT EXISTS "appointments_org_staff_start_active_key"
    ON "appointments" ("organizationId", "staffId", "startTime")
    WHERE "status" <> 'cancelled';

-- ── Foreign keys (added only if absent) ──────────────────────
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'booking_pages_organizationId_fkey'
    ) THEN
        ALTER TABLE "booking_pages"
            ADD CONSTRAINT "booking_pages_organizationId_fkey"
            FOREIGN KEY ("organizationId") REFERENCES "organizations"("id")
            ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'appointments_bookingPageId_fkey'
    ) THEN
        ALTER TABLE "appointments"
            ADD CONSTRAINT "appointments_bookingPageId_fkey"
            FOREIGN KEY ("bookingPageId") REFERENCES "booking_pages"("id")
            ON DELETE SET NULL ON UPDATE CASCADE;
    END IF;
END $$;

COMMIT;
