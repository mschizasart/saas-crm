-- Migration: 009-2fa
-- Adds TOTP-based 2FA columns to both `users` (staff/contact) and
-- `platform_admins`. Stores the TOTP secret encrypted with AES-256-GCM
-- (see apps/api/src/common/crypto/encrypt.ts) and a JSON array of
-- bcrypt-hashed one-time recovery codes.
--
-- New columns (mirrored on both tables):
--   twoFactorSecret         TEXT      — encrypted base32 TOTP secret
--   twoFactorEnabled        BOOLEAN   — only true after the user verifies the first code
--   twoFactorRecoveryCodes  JSONB     — array of bcrypt hashes; one-time use
--   twoFactorEnrolledAt     TIMESTAMP — when 2FA was first activated
--
-- Note: the `users` table already has `twoFaEnabled` / `twoFaSecret` columns
-- from an earlier scaffolding pass. Those are intentionally left in place
-- (to avoid clobbering existing data) and the new code uses the
-- `twoFactor*` columns added here.
--
-- Safe to run more than once: every column uses ADD COLUMN IF NOT EXISTS.
-- Apply with: psql "$DATABASE_URL" -f 009-2fa.sql

BEGIN;

-- ─── users (staff + contacts) ─────────────────────────────────────────
ALTER TABLE "users"
  ADD COLUMN IF NOT EXISTS "twoFactorSecret"        TEXT,
  ADD COLUMN IF NOT EXISTS "twoFactorEnabled"       BOOLEAN      NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS "twoFactorRecoveryCodes" JSONB,
  ADD COLUMN IF NOT EXISTS "twoFactorEnrolledAt"    TIMESTAMP(3);

-- ─── platform_admins ──────────────────────────────────────────────────
ALTER TABLE "platform_admins"
  ADD COLUMN IF NOT EXISTS "twoFactorSecret"        TEXT,
  ADD COLUMN IF NOT EXISTS "twoFactorEnabled"       BOOLEAN      NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS "twoFactorRecoveryCodes" JSONB,
  ADD COLUMN IF NOT EXISTS "twoFactorEnrolledAt"    TIMESTAMP(3);

COMMIT;
