-- ─────────────────────────────────────────────────────────────
--  Migration: 026 — Dunning (automated overdue-invoice reminders)
--
--  Three tables, per-org:
--    * dunning_settings — one row per org; master `enabled` toggle.
--    * dunning_rules    — ordered reminder steps. `offsetDays` is relative
--                         to the invoice due date (negative = before due,
--                         positive = after). `body` is HTML with
--                         {{invoice_number}} {{amount}} {{due_date}}
--                         {{client_name}} placeholders.
--    * dunning_logs     — idempotency + audit. The UNIQUE(invoiceId, ruleId)
--                         constraint is the HARD double-send guard: a given
--                         rule fires AT MOST ONCE per invoice, even if two
--                         scheduler passes race. The engine INSERTs the log
--                         row inside a txn FIRST, and only enqueues the email
--                         after the insert commits; a unique-violation (P2002)
--                         means another pass already claimed that send, so we
--                         skip it. See dunning.service.ts for the ordering.
--
--  Apply manually on the VPS (we don't run `prisma migrate` in prod):
--      psql "$DATABASE_URL" -f 026-dunning.sql
--
--  Safe to re-run: uses IF NOT EXISTS everywhere.
--
--  NOTE: deliberately NO RLS policy here — app_current_organization_id()
--  is not defined on this database (same situation as email_settings /
--  ai_settings / sms_settings). Tenant isolation is enforced in the
--  service layer via prisma.withOrganization(orgId, …).
-- ─────────────────────────────────────────────────────────────

-- ─── Per-org dunning settings (one row per org) ──────────────────────
CREATE TABLE IF NOT EXISTS "dunning_settings" (
    "id"              TEXT         PRIMARY KEY DEFAULT gen_random_uuid()::text,
    "organizationId"  TEXT         NOT NULL UNIQUE,
    "enabled"         BOOLEAN      NOT NULL DEFAULT FALSE,
    "createdAt"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "dunning_settings_organizationId_fkey"
        FOREIGN KEY ("organizationId")
        REFERENCES "organizations"("id")
        ON DELETE CASCADE
        ON UPDATE CASCADE
);

-- ─── Reminder steps (ordered by offsetDays) ──────────────────────────
CREATE TABLE IF NOT EXISTS "dunning_rules" (
    "id"              TEXT         PRIMARY KEY DEFAULT gen_random_uuid()::text,
    "organizationId"  TEXT         NOT NULL,
    "name"            TEXT         NOT NULL,
    -- Days relative to the invoice due date. Negative = before due,
    -- positive = after due. e.g. -3, +1, +7, +14.
    "offsetDays"      INTEGER      NOT NULL,
    "subject"         TEXT         NOT NULL,
    -- HTML body; supports {{invoice_number}} {{amount}} {{due_date}}
    -- {{client_name}} placeholders (interpolated by dunning.service.ts).
    "body"            TEXT         NOT NULL,
    "isActive"        BOOLEAN      NOT NULL DEFAULT TRUE,
    "createdAt"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "dunning_rules_organizationId_fkey"
        FOREIGN KEY ("organizationId")
        REFERENCES "organizations"("id")
        ON DELETE CASCADE
        ON UPDATE CASCADE
);

CREATE INDEX IF NOT EXISTS "dunning_rules_org_active_idx"
    ON "dunning_rules" ("organizationId", "isActive");

-- ─── Sent-reminder log (idempotency + audit) ─────────────────────────
-- The UNIQUE(invoiceId, ruleId) below is the double-send guard.
CREATE TABLE IF NOT EXISTS "dunning_logs" (
    "id"                 TEXT         PRIMARY KEY DEFAULT gen_random_uuid()::text,
    "organizationId"     TEXT         NOT NULL,
    "invoiceId"          TEXT         NOT NULL,
    "ruleId"             TEXT         NOT NULL,
    "sentAt"             TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "recipientEmail"     TEXT         NOT NULL,
    -- OutboundMessage id / message id (best-effort; nullable because the
    -- email is enqueued AFTER the log row commits and may not have a
    -- provider message id yet).
    "outboundMessageId"  TEXT,
    CONSTRAINT "dunning_logs_organizationId_fkey"
        FOREIGN KEY ("organizationId")
        REFERENCES "organizations"("id")
        ON DELETE CASCADE
        ON UPDATE CASCADE,
    CONSTRAINT "dunning_logs_invoiceId_fkey"
        FOREIGN KEY ("invoiceId")
        REFERENCES "invoices"("id")
        ON DELETE CASCADE
        ON UPDATE CASCADE
);

-- ─── THE double-send guard ───────────────────────────────────────────
-- A given rule fires at most once per invoice. A concurrent scheduler
-- pass that tries to insert the same (invoiceId, ruleId) gets a unique
-- violation (Prisma P2002), which the engine catches and treats as
-- "already sent" → it skips the duplicate email entirely.
CREATE UNIQUE INDEX IF NOT EXISTS "dunning_logs_invoice_rule_key"
    ON "dunning_logs" ("invoiceId", "ruleId");

CREATE INDEX IF NOT EXISTS "dunning_logs_org_sentat_idx"
    ON "dunning_logs" ("organizationId", "sentAt");

-- ─── ruleId → dunning_rules FK (added in review; idempotent) ──────────
-- Without this FK, deleting a rule left orphaned dunning_logs rows whose
-- (invoiceId, ruleId) unique slots could never be freed. ON DELETE CASCADE
-- means removing a rule also removes its log rows, freeing those slots.
--
-- Postgres has no `ADD CONSTRAINT IF NOT EXISTS` for foreign keys, so guard
-- with a catalog check. The "dunning_logs" column already exists on prod
-- after the first apply, so this is safe to re-run.
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'dunning_logs_ruleId_fkey'
          AND conrelid = '"dunning_logs"'::regclass
    ) THEN
        ALTER TABLE "dunning_logs"
            ADD CONSTRAINT "dunning_logs_ruleId_fkey"
            FOREIGN KEY ("ruleId")
            REFERENCES "dunning_rules"("id")
            ON DELETE CASCADE
            ON UPDATE CASCADE;
    END IF;
END $$;

-- Back the FK with an index so rule deletes / lookups by ruleId are fast.
CREATE INDEX IF NOT EXISTS "dunning_logs_ruleId_idx"
    ON "dunning_logs" ("ruleId");
