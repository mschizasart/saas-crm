-- ─────────────────────────────────────────────────────────────
--  Migration: 043 — sequences / cadences
--
--  Adds:
--    sequences                  — one row per cadence. Status flows
--                                 draft → active → paused/archived. An admin
--                                 builds an ordered list of steps; leads or
--                                 clients get enrolled and a 5-min cron walks
--                                 each enrollment through its steps over time
--                                 via the BullMQ 'sequences' queue.
--    sequence_steps             — the ordered steps of a sequence. type is
--                                 'email' | 'task' | 'wait'. delayMinutes is
--                                 the wait BEFORE the step runs, relative to
--                                 the prior step's completion.
--                                 @@unique(sequenceId, position).
--    sequence_enrollments       — one row per (sequence, recipient). Tracks
--                                 currentStepIndex + nextStepAt; the scheduler
--                                 scans status='active' AND nextStepAt<=now()
--                                 across all orgs. @@unique(sequenceId,
--                                 recipientType, recipientId) prevents
--                                 double-enroll.
--    sequence_step_executions   — audit trail: one row per step executed for
--                                 an enrollment. status is 'sent' | 'created'
--                                 | 'skipped' | 'failed'. Email steps link to
--                                 the OutboundMessage tracking row.
--
--  No RLS — this DB has no `app_current_organization_id()` helper; tenant
--  isolation is enforced in the service layer via prisma.withOrganization()
--  (same as campaigns / email_settings / documents).
--
--  Apply manually on the VPS:
--    psql "$DATABASE_URL" -f 043-sequences.sql
--
--  Idempotent — CREATE TABLE / INDEX IF NOT EXISTS; FKs added only if absent.
-- ─────────────────────────────────────────────────────────────

BEGIN;

-- ── sequences ────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "sequences" (
    "id"               TEXT         PRIMARY KEY DEFAULT gen_random_uuid()::text,
    "organizationId"   TEXT         NOT NULL,
    "name"             TEXT         NOT NULL,
    "description"      TEXT         NOT NULL DEFAULT '',
    -- 'draft' | 'active' | 'paused' | 'archived'
    "status"           TEXT         NOT NULL DEFAULT 'draft',
    "createdById"      TEXT,
    "createdAt"        TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"        TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Tenant + status listing (the sequences list page filters by status).
CREATE INDEX IF NOT EXISTS "sequences_org_status_idx"
    ON "sequences" ("organizationId", "status");

-- ── sequence_steps ───────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "sequence_steps" (
    "id"                TEXT         PRIMARY KEY DEFAULT gen_random_uuid()::text,
    "sequenceId"        TEXT         NOT NULL,
    "organizationId"    TEXT         NOT NULL,
    -- 0-based order within the sequence.
    "position"          INTEGER      NOT NULL,
    -- 'email' | 'task' | 'wait'
    "type"              TEXT         NOT NULL,
    -- Wait BEFORE this step runs, relative to the prior step's completion.
    "delayMinutes"      INTEGER      NOT NULL DEFAULT 0,
    "emailSubject"      TEXT,
    -- HTML email body.
    "emailBody"         TEXT,
    "taskTitle"         TEXT,
    "taskDescription"   TEXT,
    "createdAt"         TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"         TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- One step per (sequence, position).
CREATE UNIQUE INDEX IF NOT EXISTS "sequence_steps_sequence_position_key"
    ON "sequence_steps" ("sequenceId", "position");

-- Ordered fetch of a sequence's steps.
CREATE INDEX IF NOT EXISTS "sequence_steps_sequence_position_idx"
    ON "sequence_steps" ("sequenceId", "position");

-- ── sequence_enrollments ─────────────────────────────────────
CREATE TABLE IF NOT EXISTS "sequence_enrollments" (
    "id"                 TEXT         PRIMARY KEY DEFAULT gen_random_uuid()::text,
    "organizationId"     TEXT         NOT NULL,
    "sequenceId"         TEXT         NOT NULL,
    -- 'lead' | 'client'
    "recipientType"      TEXT         NOT NULL,
    "recipientId"        TEXT         NOT NULL,
    "recipientEmail"     TEXT         NOT NULL,
    "recipientName"      TEXT,
    -- 'active' | 'completed' | 'paused' | 'unenrolled' | 'failed'
    "status"             TEXT         NOT NULL DEFAULT 'active',
    "currentStepIndex"   INTEGER      NOT NULL DEFAULT 0,
    "nextStepAt"         TIMESTAMP(3),
    "enrolledById"       TEXT,
    "enrolledAt"         TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt"        TIMESTAMP(3)
);

-- Prevent double-enroll of the same recipient into a sequence.
CREATE UNIQUE INDEX IF NOT EXISTS "sequence_enrollments_sequence_recipient_key"
    ON "sequence_enrollments" ("sequenceId", "recipientType", "recipientId");

-- Per-org listing for a sequence's enrollments.
CREATE INDEX IF NOT EXISTS "sequence_enrollments_org_sequence_idx"
    ON "sequence_enrollments" ("organizationId", "sequenceId");

-- Scheduler scan: due active enrollments across all orgs.
CREATE INDEX IF NOT EXISTS "sequence_enrollments_status_next_idx"
    ON "sequence_enrollments" ("status", "nextStepAt");

-- ── sequence_step_executions ─────────────────────────────────
CREATE TABLE IF NOT EXISTS "sequence_step_executions" (
    "id"                 TEXT         PRIMARY KEY DEFAULT gen_random_uuid()::text,
    "organizationId"     TEXT         NOT NULL,
    "enrollmentId"       TEXT         NOT NULL,
    "stepId"             TEXT,
    "stepIndex"          INTEGER      NOT NULL,
    "type"               TEXT         NOT NULL,
    -- 'sent' | 'created' | 'skipped' | 'failed'
    "status"             TEXT         NOT NULL,
    -- Link to the OutboundMessage tracking row for 'email' steps.
    "outboundMessageId"  TEXT,
    "error"              TEXT,
    "executedAt"         TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Per-enrollment execution history.
CREATE INDEX IF NOT EXISTS "sequence_step_executions_enrollment_idx"
    ON "sequence_step_executions" ("enrollmentId");

-- ── Foreign keys (added only if absent) ──────────────────────
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'sequences_organizationId_fkey'
    ) THEN
        ALTER TABLE "sequences"
            ADD CONSTRAINT "sequences_organizationId_fkey"
            FOREIGN KEY ("organizationId") REFERENCES "organizations"("id")
            ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'sequence_steps_sequenceId_fkey'
    ) THEN
        ALTER TABLE "sequence_steps"
            ADD CONSTRAINT "sequence_steps_sequenceId_fkey"
            FOREIGN KEY ("sequenceId") REFERENCES "sequences"("id")
            ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'sequence_steps_organizationId_fkey'
    ) THEN
        ALTER TABLE "sequence_steps"
            ADD CONSTRAINT "sequence_steps_organizationId_fkey"
            FOREIGN KEY ("organizationId") REFERENCES "organizations"("id")
            ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'sequence_enrollments_sequenceId_fkey'
    ) THEN
        ALTER TABLE "sequence_enrollments"
            ADD CONSTRAINT "sequence_enrollments_sequenceId_fkey"
            FOREIGN KEY ("sequenceId") REFERENCES "sequences"("id")
            ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'sequence_enrollments_organizationId_fkey'
    ) THEN
        ALTER TABLE "sequence_enrollments"
            ADD CONSTRAINT "sequence_enrollments_organizationId_fkey"
            FOREIGN KEY ("organizationId") REFERENCES "organizations"("id")
            ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'sequence_step_executions_enrollmentId_fkey'
    ) THEN
        ALTER TABLE "sequence_step_executions"
            ADD CONSTRAINT "sequence_step_executions_enrollmentId_fkey"
            FOREIGN KEY ("enrollmentId") REFERENCES "sequence_enrollments"("id")
            ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'sequence_step_executions_organizationId_fkey'
    ) THEN
        ALTER TABLE "sequence_step_executions"
            ADD CONSTRAINT "sequence_step_executions_organizationId_fkey"
            FOREIGN KEY ("organizationId") REFERENCES "organizations"("id")
            ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
END $$;

COMMIT;
