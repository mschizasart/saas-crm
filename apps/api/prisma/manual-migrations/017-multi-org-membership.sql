-- ─────────────────────────────────────────────────────────────
--  Migration: 017 — multi-org membership
--
--  Adds a join table so a single human (User row) can belong to
--  multiple organizations. The user's *primary* org still lives
--  on `users.organizationId` (kept for backward compat and RLS
--  anchoring); the join table enumerates *all* orgs the user can
--  switch into via /api/v1/auth/switch-org and /select-org.
--
--  Apply manually on the VPS:
--    psql "$DATABASE_URL" -f 017-multi-org-membership.sql
--
--  Idempotent — uses CREATE TABLE IF NOT EXISTS + ON CONFLICT DO
--  NOTHING on the backfill so it's safe to re-run.
--
--  BACKFILL: every existing User row gets a corresponding
--  membership in their current `organizationId`, marked
--  isPrimary=true and acceptedAt=NOW(). Role is derived from
--  `users.isAdmin` (true → 'admin', else 'staff').
-- ─────────────────────────────────────────────────────────────

BEGIN;

CREATE TABLE IF NOT EXISTS "user_organization_memberships" (
    "id"              TEXT PRIMARY KEY,
    "userId"          TEXT NOT NULL,
    "organizationId"  TEXT NOT NULL,
    "role"            TEXT NOT NULL,
    "isPrimary"       BOOLEAN NOT NULL DEFAULT FALSE,
    "invitedAt"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "acceptedAt"      TIMESTAMP(3),
    CONSTRAINT "user_organization_memberships_userId_fkey"
        FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "user_organization_memberships_organizationId_fkey"
        FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS "user_organization_memberships_userId_organizationId_key"
    ON "user_organization_memberships" ("userId", "organizationId");

CREATE INDEX IF NOT EXISTS "user_organization_memberships_userId_idx"
    ON "user_organization_memberships" ("userId");

CREATE INDEX IF NOT EXISTS "user_organization_memberships_organizationId_idx"
    ON "user_organization_memberships" ("organizationId");

-- Backfill: for every existing user, create a row in the join table
-- pointing at their current organizationId, role derived from isAdmin,
-- marked isPrimary=true and already accepted. ON CONFLICT keeps the
-- migration idempotent if it runs a second time.
INSERT INTO "user_organization_memberships"
    ("id", "userId", "organizationId", "role", "isPrimary", "invitedAt", "acceptedAt")
SELECT
    gen_random_uuid()::text,
    u."id",
    u."organizationId",
    CASE WHEN u."isAdmin" THEN 'admin' ELSE 'staff' END,
    TRUE,
    NOW(),
    NOW()
FROM "users" u
ON CONFLICT ("userId", "organizationId") DO NOTHING;

COMMIT;
