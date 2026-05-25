-- ─────────────────────────────────────────────────────────────
--  Migration: 024 — bulk email campaigns / newsletters
--
--  Adds:
--    campaigns             — one row per newsletter/campaign. Status flows
--                            draft → scheduled → sending → sent (or failed).
--                            segmentType + segmentConfig (jsonb) describe the
--                            recipient set; it is resolved to concrete rows at
--                            send time. Sending happens off the HTTP path via
--                            the BullMQ 'campaigns' queue.
--    campaign_recipients   — the materialised recipient list for a campaign,
--                            de-duplicated by email (@@unique(campaignId,email)).
--                            Each row links to the OutboundMessage tracking row
--                            (outboundMessageId) so opens/clicks attribute back.
--    email_unsubscribes    — per-org suppression list. An email present here
--                            is SKIPPED when building campaign recipients.
--                            CAN-SPAM / GDPR: every campaign mail carries an
--                            unsubscribe link (HMAC-signed token, see
--                            campaigns.service.ts → unsubscribeToken).
--
--  No RLS — this DB has no `app_current_organization_id()` helper; tenant
--  isolation is enforced in the service layer via prisma.withOrganization()
--  (same as email_settings / sms / documents).
--
--  Apply manually on the VPS:
--    psql "$DATABASE_URL" -f 024-campaigns.sql
--
--  Idempotent — CREATE TABLE / INDEX IF NOT EXISTS; FKs added only if absent.
-- ─────────────────────────────────────────────────────────────

BEGIN;

-- ── campaigns ────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "campaigns" (
    "id"               TEXT         PRIMARY KEY DEFAULT gen_random_uuid()::text,
    "organizationId"   TEXT         NOT NULL,
    "name"             TEXT         NOT NULL,
    "subject"          TEXT         NOT NULL,
    -- HTML body. Unsubscribe link + tracking pixel are injected at send time.
    "body"             TEXT         NOT NULL DEFAULT '',
    -- 'draft' | 'scheduled' | 'sending' | 'sent' | 'failed'
    "status"           TEXT         NOT NULL DEFAULT 'draft',
    -- 'all_clients' | 'all_leads' | 'lead_status' | 'manual'
    "segmentType"      TEXT         NOT NULL DEFAULT 'all_clients',
    -- jsonb: e.g. {"statusId":"…"} for lead_status, {"ids":["…"]} for manual
    "segmentConfig"    JSONB        NOT NULL DEFAULT '{}'::jsonb,
    "scheduledAt"      TIMESTAMP(3),
    "sentAt"           TIMESTAMP(3),
    "totalRecipients"  INTEGER      NOT NULL DEFAULT 0,
    "sentCount"        INTEGER      NOT NULL DEFAULT 0,
    "failedCount"      INTEGER      NOT NULL DEFAULT 0,
    "createdById"      TEXT,
    "createdAt"        TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"        TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Tenant + status listing (the campaigns list page filters by status).
CREATE INDEX IF NOT EXISTS "campaigns_org_status_idx"
    ON "campaigns" ("organizationId", "status");

-- ── campaign_recipients ──────────────────────────────────────
CREATE TABLE IF NOT EXISTS "campaign_recipients" (
    "id"                 TEXT         PRIMARY KEY DEFAULT gen_random_uuid()::text,
    "campaignId"         TEXT         NOT NULL,
    "organizationId"     TEXT         NOT NULL,
    "email"              TEXT         NOT NULL,
    "name"               TEXT,
    -- 'client' | 'lead'
    "recipientType"      TEXT         NOT NULL,
    -- Client.id / Lead.id (or contact User.id for client contacts). Nullable
    -- because a manual address may not map to a CRM record.
    "recipientId"        TEXT,
    -- 'pending' | 'sent' | 'failed' | 'skipped'
    "status"             TEXT         NOT NULL DEFAULT 'pending',
    -- Link to the OutboundMessage tracking row so opens/clicks attribute back.
    "outboundMessageId"  TEXT,
    "error"              TEXT,
    "sentAt"             TIMESTAMP(3),
    "createdAt"          TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Dedup within a campaign: one row per email address.
CREATE UNIQUE INDEX IF NOT EXISTS "campaign_recipients_campaign_email_key"
    ON "campaign_recipients" ("campaignId", "email");

-- Send-loop scan: pending rows for a campaign.
CREATE INDEX IF NOT EXISTS "campaign_recipients_campaign_status_idx"
    ON "campaign_recipients" ("campaignId", "status");

-- ── email_unsubscribes ───────────────────────────────────────
CREATE TABLE IF NOT EXISTS "email_unsubscribes" (
    "id"               TEXT         PRIMARY KEY DEFAULT gen_random_uuid()::text,
    "organizationId"   TEXT         NOT NULL,
    "email"            TEXT         NOT NULL,
    -- Optional breadcrumb: which campaign the unsubscribe came from.
    "campaignId"       TEXT,
    "createdAt"        TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- One suppression row per (org, email). Case is normalised to lower in the app.
CREATE UNIQUE INDEX IF NOT EXISTS "email_unsubscribes_org_email_key"
    ON "email_unsubscribes" ("organizationId", "email");

-- ── Foreign keys (added only if absent) ──────────────────────
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'campaigns_organizationId_fkey'
    ) THEN
        ALTER TABLE "campaigns"
            ADD CONSTRAINT "campaigns_organizationId_fkey"
            FOREIGN KEY ("organizationId") REFERENCES "organizations"("id")
            ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'campaign_recipients_campaignId_fkey'
    ) THEN
        ALTER TABLE "campaign_recipients"
            ADD CONSTRAINT "campaign_recipients_campaignId_fkey"
            FOREIGN KEY ("campaignId") REFERENCES "campaigns"("id")
            ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'campaign_recipients_organizationId_fkey'
    ) THEN
        ALTER TABLE "campaign_recipients"
            ADD CONSTRAINT "campaign_recipients_organizationId_fkey"
            FOREIGN KEY ("organizationId") REFERENCES "organizations"("id")
            ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'email_unsubscribes_organizationId_fkey'
    ) THEN
        ALTER TABLE "email_unsubscribes"
            ADD CONSTRAINT "email_unsubscribes_organizationId_fkey"
            FOREIGN KEY ("organizationId") REFERENCES "organizations"("id")
            ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
END $$;

COMMIT;
