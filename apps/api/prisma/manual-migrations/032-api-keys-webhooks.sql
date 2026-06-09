-- ─────────────────────────────────────────────────────────────
--  Migration: 032 — Public REST API + Webhooks (Wave E3)
--
--  Three tables for the public REST API surface and outbound
--  webhook deliveries. These are NEW tables that live alongside
--  the existing (and intentionally untouched) `api_keys` /
--  `webhooks` tables — the legacy ones power the in-app admin
--  console pages; the new `public_api_keys`, `public_webhooks`,
--  and `public_webhook_deliveries` power the public API surface
--  with scoped keys, HMAC-signed payload delivery, and retry.
--
--    * public_api_keys              — per-org API keys with scopes,
--                                     key_prefix (plaintext, for display
--                                     + lookup) and key_hash
--                                     (sha256 of full key).
--    * public_webhooks              — per-org webhook subscriptions
--                                     with an HMAC secret used to sign
--                                     payloads.
--    * public_webhook_deliveries    — one row per dispatch attempt; drives
--                                     the BullMQ retry worker and is the
--                                     source of truth for "was this
--                                     event ever delivered".
--
--  Apply manually on the VPS:
--      psql "$DATABASE_URL" -f 032-api-keys-webhooks.sql
--
--  Idempotent — CREATE … IF NOT EXISTS / DO blocks for FKs.
--
--  NOTE: deliberately NO RLS policy here. Tenant isolation is enforced
--  in the service layer via prisma.withOrganization(orgId, …) and
--  explicit `organizationId` filters on every query.
-- ─────────────────────────────────────────────────────────────

BEGIN;

-- ─── public_api_keys ────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "public_api_keys" (
    "id"             TEXT        PRIMARY KEY DEFAULT gen_random_uuid()::text,
    "organizationId" TEXT        NOT NULL,
    "name"           TEXT        NOT NULL,
    -- First 8 chars after `crm_`; plaintext, used for display ("crm_abc12345…")
    -- AND to narrow the lookup before the constant-time hash compare.
    "keyPrefix"      TEXT        NOT NULL,
    -- sha256(full_key) hex — the only thing persisted of the secret part.
    "keyHash"        TEXT        NOT NULL,
    -- Array of permission strings, e.g. ['clients.read','invoices.write'].
    "scopes"         JSONB       NOT NULL DEFAULT '[]'::jsonb,
    "lastUsedAt"     TIMESTAMPTZ,
    "expiresAt"      TIMESTAMPTZ,
    "createdById"    TEXT,
    "createdAt"      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    -- Revocation is a soft delete so audit log + delivery rows stay attributable.
    "revokedAt"      TIMESTAMPTZ
);

CREATE UNIQUE INDEX IF NOT EXISTS "public_api_keys_org_prefix_key"
    ON "public_api_keys" ("organizationId", "keyPrefix");

CREATE INDEX IF NOT EXISTS "public_api_keys_prefix_idx"
    ON "public_api_keys" ("keyPrefix");

-- ─── public_webhooks ────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "public_webhooks" (
    "id"             TEXT        PRIMARY KEY DEFAULT gen_random_uuid()::text,
    "organizationId" TEXT        NOT NULL,
    -- URL is validated to start with https:// at the app layer (DTO).
    "url"            TEXT        NOT NULL,
    -- Array of event names from ALLOWED_EVENTS (see webhook-events.ts).
    "events"         JSONB       NOT NULL DEFAULT '[]'::jsonb,
    -- 32-byte hex secret generated server-side; used as the HMAC-SHA256
    -- key when signing outgoing payloads. Stored encrypted at-rest via
    -- ENCRYPTION_KEY (same envelope as email_settings.smtpPassword).
    "secret"         TEXT        NOT NULL,
    "active"         BOOLEAN     NOT NULL DEFAULT TRUE,
    "createdById"    TEXT,
    "createdAt"      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    "updatedAt"      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS "public_webhooks_org_active_idx"
    ON "public_webhooks" ("organizationId", "active");

-- ─── public_webhook_deliveries ──────────────────────────────────
CREATE TABLE IF NOT EXISTS "public_webhook_deliveries" (
    "id"             TEXT        PRIMARY KEY DEFAULT gen_random_uuid()::text,
    "organizationId" TEXT        NOT NULL,
    "webhookId"      TEXT        NOT NULL,
    "event"          TEXT        NOT NULL,
    "payload"        JSONB       NOT NULL DEFAULT '{}'::jsonb,
    "statusCode"     INTEGER,
    "responseBody"   TEXT,
    "attemptCount"   INTEGER     NOT NULL DEFAULT 0,
    "lastAttemptAt"  TIMESTAMPTZ,
    -- Driven by the back-off schedule in webhook-delivery.processor.ts:
    -- attempt 1→+1m, 2→+5m, 3→+30m, 4→+2h, 5→+12h. NULL after permanent fail.
    "nextAttemptAt"  TIMESTAMPTZ,
    "succeeded"      BOOLEAN     NOT NULL DEFAULT FALSE,
    "createdAt"      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS "public_webhook_deliveries_org_webhook_created_idx"
    ON "public_webhook_deliveries" ("organizationId", "webhookId", "createdAt" DESC);

-- Used by webhook-retry.scheduler.ts every minute to find pending retries.
CREATE INDEX IF NOT EXISTS "public_webhook_deliveries_retry_idx"
    ON "public_webhook_deliveries" ("succeeded", "nextAttemptAt");

-- ─── Foreign keys (added only if absent) ────────────────────────
DO $$
BEGIN
    -- public_api_keys -> organizations
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'public_api_keys_organizationId_fkey'
    ) THEN
        ALTER TABLE "public_api_keys"
            ADD CONSTRAINT "public_api_keys_organizationId_fkey"
            FOREIGN KEY ("organizationId") REFERENCES "organizations"("id")
            ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;

    -- public_webhooks -> organizations
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'public_webhooks_organizationId_fkey'
    ) THEN
        ALTER TABLE "public_webhooks"
            ADD CONSTRAINT "public_webhooks_organizationId_fkey"
            FOREIGN KEY ("organizationId") REFERENCES "organizations"("id")
            ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;

    -- public_webhook_deliveries -> organizations
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'public_webhook_deliveries_organizationId_fkey'
    ) THEN
        ALTER TABLE "public_webhook_deliveries"
            ADD CONSTRAINT "public_webhook_deliveries_organizationId_fkey"
            FOREIGN KEY ("organizationId") REFERENCES "organizations"("id")
            ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;

    -- public_webhook_deliveries -> public_webhooks (CASCADE: drop deliveries with the webhook)
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'public_webhook_deliveries_webhookId_fkey'
    ) THEN
        ALTER TABLE "public_webhook_deliveries"
            ADD CONSTRAINT "public_webhook_deliveries_webhookId_fkey"
            FOREIGN KEY ("webhookId") REFERENCES "public_webhooks"("id")
            ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
END $$;

COMMIT;
