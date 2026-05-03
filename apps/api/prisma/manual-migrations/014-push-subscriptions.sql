-- ─────────────────────────────────────────────────────────────
--  Migration: 014 — Web push subscriptions
--
--  Stores per-user, per-device push endpoint tuples returned by the
--  browser's PushManager.subscribe() call. One row per (endpoint).
--  We never trust the client's userId — orgId/userId are taken from
--  the JWT at insert time.
--
--  When web-push delivers a 410 Gone (browser revoked the
--  subscription), the application deletes the row.
--
--  Apply manually on the VPS:
--      psql "$DATABASE_URL" -f 014-push-subscriptions.sql
--
--  Safe to re-run: every statement is idempotent.
-- ─────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS "push_subscriptions" (
    "id"             TEXT         NOT NULL PRIMARY KEY,
    "organizationId" TEXT         NOT NULL,
    "userId"         TEXT         NOT NULL,
    "endpoint"       TEXT         NOT NULL,
    "p256dh"         TEXT         NOT NULL,
    "auth"           TEXT         NOT NULL,
    "userAgent"      TEXT         NOT NULL DEFAULT '',
    "createdAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastUsedAt"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Endpoint is globally unique (it's a URL the push service issues; one
-- subscription per browser instance).
CREATE UNIQUE INDEX IF NOT EXISTS "push_subscriptions_endpoint_key"
    ON "push_subscriptions" ("endpoint");

-- Hot path: "send to user X" — fetch all that user's subscriptions.
CREATE INDEX IF NOT EXISTS "push_subscriptions_userId_idx"
    ON "push_subscriptions" ("userId");

-- Tenant scope: occasional org-wide broadcasts.
CREATE INDEX IF NOT EXISTS "push_subscriptions_organizationId_idx"
    ON "push_subscriptions" ("organizationId");

-- FK to users so deleting a user (or org) cleans up their subscriptions.
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'push_subscriptions_userId_fkey'
    ) THEN
        ALTER TABLE "push_subscriptions"
            ADD CONSTRAINT "push_subscriptions_userId_fkey"
            FOREIGN KEY ("userId") REFERENCES "users"("id")
            ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
END $$;
