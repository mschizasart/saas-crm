-- ─────────────────────────────────────────────────────────────
--  Migration: 011 — Email open + click tracking
--
--  Extends the existing `outbound_messages` table (introduced in
--  007-imap-inbox.sql). Adds:
--    * trackingId        — short, unique-per-org URL-safe id used in
--                          /api/v1/track/open/:trackingId.gif and
--                          /api/v1/track/click/:trackingId?u=…
--    * openedAt / openCount / lastOpenedAt
--    * clickedAt / clickCount / lastClickedAt
--    * clickedUrls       — JSONB array of {url, at, ip, userAgent}
--                          (capped at 50 entries by the application)
--    * recipientEmail    — denormalised; used for the "Sent emails"
--                          panel and inbox-style filtering
--
--  No per-open metadata (IP / UA) is stored — emails are pre-fetched
--  by MTAs / image proxies which makes those fields close to useless
--  for opens, while introducing privacy concerns. Click metadata IS
--  stored because the user took an explicit action.
--
--  Apply manually on the VPS:
--      psql "$DATABASE_URL" -f 011-email-tracking.sql
--
--  Safe to re-run: every statement is idempotent.
-- ─────────────────────────────────────────────────────────────

-- ── 1. New columns on outbound_messages ──────────────────────
ALTER TABLE "outbound_messages"
    ADD COLUMN IF NOT EXISTS "trackingId"       TEXT;
ALTER TABLE "outbound_messages"
    ADD COLUMN IF NOT EXISTS "openedAt"         TIMESTAMP(3);
ALTER TABLE "outbound_messages"
    ADD COLUMN IF NOT EXISTS "openCount"        INTEGER     NOT NULL DEFAULT 0;
ALTER TABLE "outbound_messages"
    ADD COLUMN IF NOT EXISTS "lastOpenedAt"     TIMESTAMP(3);
ALTER TABLE "outbound_messages"
    ADD COLUMN IF NOT EXISTS "clickedAt"        TIMESTAMP(3);
ALTER TABLE "outbound_messages"
    ADD COLUMN IF NOT EXISTS "clickCount"       INTEGER     NOT NULL DEFAULT 0;
ALTER TABLE "outbound_messages"
    ADD COLUMN IF NOT EXISTS "lastClickedAt"    TIMESTAMP(3);
ALTER TABLE "outbound_messages"
    ADD COLUMN IF NOT EXISTS "clickedUrls"      JSONB       NOT NULL DEFAULT '[]';
ALTER TABLE "outbound_messages"
    ADD COLUMN IF NOT EXISTS "recipientEmail"   TEXT;

-- The original `messageId` column is NOT NULL (filled with the RFC822
-- Message-ID after nodemailer accepts the mail). Tracking, however, is
-- created BEFORE send, when we don't yet have a messageId. Drop the
-- NOT NULL so we can insert a row keyed only by trackingId.
ALTER TABLE "outbound_messages"
    ALTER COLUMN "messageId" DROP NOT NULL;

-- ── 2. Indexes ───────────────────────────────────────────────
-- Tracking endpoints look up by trackingId only — RLS does NOT apply
-- there because the request is unauthenticated. Uniqueness is enforced
-- globally rather than per-org so the URL itself is unforgeable.
CREATE UNIQUE INDEX IF NOT EXISTS "outbound_messages_trackingId_uniq"
    ON "outbound_messages" ("trackingId")
    WHERE "trackingId" IS NOT NULL;

-- Helps the "Sent emails" panel (filter by routedTo / routedToId,
-- newest first) — already covered by the existing
-- outbound_messages_org_routed_idx, no extra index needed.
