-- ─────────────────────────────────────────────────────────────
--  Migration: 048 — public booking email double-opt-in (verification)
--
--  Closes the anti-spam-relay gap in the public self-service booking flow
--  (migration 047). A public booking is now created with status='pending' and a
--  random verificationToken; the visitor must click an emailed confirm link to
--  flip it to 'scheduled'. Until verified the row does NOT hold the slot.
--
--  Adds to `appointments`:
--    verificationToken      — random secret embedded in the confirm link
--    verificationExpiresAt  — link expiry (created now + 30 min)
--    verifiedAt             — when the visitor confirmed
--
--  CRITICAL index change: the 047 double-booking guard
--  "appointments_org_staff_start_active_key" was partial WHERE status <> 'cancelled'.
--  That would make two 'pending' bookings at the same (org, staff, start) collide.
--  We re-scope it to WHERE status = 'scheduled' so only CONFIRMED bookings are
--  unique-guarded; concurrent unverified pendings no longer collide. Pendings are
--  also excluded from availability/conflict checks in the service layer.
--
--  No RLS — tenant isolation is enforced in the service layer via
--  prisma.withOrganization() (same as 047).
--
--  Apply manually on the VPS:
--    psql "$DATABASE_URL" -f 048-booking-verification.sql
--
--  Idempotent — ALTER ... ADD COLUMN IF NOT EXISTS; DROP/CREATE INDEX IF [NOT] EXISTS.
-- ─────────────────────────────────────────────────────────────

BEGIN;

-- ── appointments additions (double-opt-in metadata) ──────────
ALTER TABLE "appointments" ADD COLUMN IF NOT EXISTS "verificationToken"     TEXT;
ALTER TABLE "appointments" ADD COLUMN IF NOT EXISTS "verificationExpiresAt" TIMESTAMP(3);
ALTER TABLE "appointments" ADD COLUMN IF NOT EXISTS "verifiedAt"            TIMESTAMP(3);

-- Token lookup for the public verify endpoint.
CREATE INDEX IF NOT EXISTS "appointments_verification_token_idx"
    ON "appointments" ("verificationToken");

-- ── Re-scope the double-booking guard to confirmed bookings only ──
-- Previously WHERE status <> 'cancelled' (047), which would block a second
-- 'pending' booking at the same start. Now WHERE status = 'scheduled' so only
-- confirmed bookings are unique-guarded and concurrent pendings don't collide.
DROP INDEX IF EXISTS "appointments_org_staff_start_active_key";
CREATE UNIQUE INDEX IF NOT EXISTS "appointments_org_staff_start_active_key"
    ON "appointments" ("organizationId", "staffId", "startTime")
    WHERE "status" = 'scheduled';

COMMIT;
