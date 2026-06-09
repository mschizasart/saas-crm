-- ─────────────────────────────────────────────────────────────
--  Migration: 030 — Approval workflows (Wave E1)
--
--  Multi-step approval chains. Tenants define `approval_processes`
--  (one per entity type, e.g. invoice / opportunity / expense /
--  custom) with an ordered list of `approval_steps` (each step
--  resolves to a user, role, or the requester's manager). A live
--  `approval_request` advances through the chain one step at a
--  time as eligible approvers POST `approval_decisions`.
--
--  Status enums are CHECK-constrained at the DB level AND enforced
--  at the DTO level (class-validator @IsIn) — defense in depth.
--
--  Tenant isolation: enforced at the service layer via
--  prisma.withOrganization() — this DB does NOT have the
--  `app_current_organization_id()` helper, so no RLS policies here.
--  Every read AND write in the service includes an explicit
--  `where: { organizationId: orgId }` clause.
--
--  Apply manually on the VPS:
--    psql "$DATABASE_URL" -f 030-approvals.sql
--
--  Idempotent — CREATE TABLE / INDEX IF NOT EXISTS; FKs added only
--  if absent.
-- ─────────────────────────────────────────────────────────────

BEGIN;

-- ── approval_processes ───────────────────────────────────────
CREATE TABLE IF NOT EXISTS "approval_processes" (
    "id"               TEXT        PRIMARY KEY DEFAULT gen_random_uuid()::text,
    "organizationId"   TEXT        NOT NULL,
    "name"             TEXT        NOT NULL,
    -- What this process gates. CHECK keeps the enum honest at the DB
    -- layer even if a future DTO regression slips bad data through.
    "entityType"       TEXT        NOT NULL,
    "active"           BOOLEAN     NOT NULL DEFAULT TRUE,
    -- {field, op, value} — when to require approval. Empty object
    -- means "always". Evaluated by the requesting subsystem (e.g.
    -- invoices.service) BEFORE it creates an approval_request.
    "triggerCondition" JSONB       NOT NULL DEFAULT '{}',
    "createdById"      TEXT,
    "createdAt"        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    "updatedAt"        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT "approval_processes_entityType_check"
        CHECK ("entityType" IN ('invoice','opportunity','expense','custom'))
);

CREATE INDEX IF NOT EXISTS "approval_processes_org_idx"
    ON "approval_processes" ("organizationId");

CREATE INDEX IF NOT EXISTS "approval_processes_org_entity_idx"
    ON "approval_processes" ("organizationId", "entityType");

-- ── approval_steps ───────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "approval_steps" (
    "id"               TEXT        PRIMARY KEY DEFAULT gen_random_uuid()::text,
    "organizationId"   TEXT        NOT NULL,
    "processId"        TEXT        NOT NULL,
    "order"            INTEGER     NOT NULL,
    -- approver_type: 'user' (fixed user), 'role' (any user in a role),
    -- 'manager' (the requester's direct manager — resolved at decide-
    -- time; not implemented yet, see TODO in approval-requests.service.ts).
    "approverType"     TEXT        NOT NULL,
    "approverUserId"   TEXT,
    "approverRoleId"   TEXT,
    "name"             TEXT,
    "createdAt"        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT "approval_steps_approverType_check"
        CHECK ("approverType" IN ('user','role','manager'))
);

CREATE INDEX IF NOT EXISTS "approval_steps_org_idx"
    ON "approval_steps" ("organizationId");

CREATE INDEX IF NOT EXISTS "approval_steps_process_order_idx"
    ON "approval_steps" ("processId", "order");

-- ── approval_requests ────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "approval_requests" (
    "id"                 TEXT        PRIMARY KEY DEFAULT gen_random_uuid()::text,
    "organizationId"     TEXT        NOT NULL,
    "processId"          TEXT        NOT NULL,
    "targetType"         TEXT        NOT NULL,
    "targetId"           TEXT        NOT NULL,
    "status"             TEXT        NOT NULL DEFAULT 'pending',
    -- The `order` (NOT the id) of the step currently awaiting a
    -- decision. Updated atomically with the decision insert inside
    -- a single $transaction so the request can never "skip" a step.
    "currentStepOrder"   INTEGER     NOT NULL DEFAULT 0,
    "requestedById"      TEXT        NOT NULL,
    "startedAt"          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    "completedAt"        TIMESTAMPTZ,
    CONSTRAINT "approval_requests_status_check"
        CHECK ("status" IN ('pending','approved','rejected','cancelled'))
);

CREATE INDEX IF NOT EXISTS "approval_requests_org_status_idx"
    ON "approval_requests" ("organizationId", "status");

CREATE INDEX IF NOT EXISTS "approval_requests_org_target_idx"
    ON "approval_requests" ("organizationId", "targetType", "targetId");

CREATE INDEX IF NOT EXISTS "approval_requests_org_requested_by_idx"
    ON "approval_requests" ("organizationId", "requestedById");

-- ── approval_decisions ───────────────────────────────────────
CREATE TABLE IF NOT EXISTS "approval_decisions" (
    "id"               TEXT        PRIMARY KEY DEFAULT gen_random_uuid()::text,
    "organizationId"   TEXT        NOT NULL,
    "requestId"        TEXT        NOT NULL,
    "stepOrder"        INTEGER     NOT NULL,
    "decidedById"      TEXT        NOT NULL,
    "decision"         TEXT        NOT NULL,
    "comment"          TEXT,
    "decidedAt"        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT "approval_decisions_decision_check"
        CHECK ("decision" IN ('approve','reject'))
);

CREATE INDEX IF NOT EXISTS "approval_decisions_request_idx"
    ON "approval_decisions" ("requestId", "decidedAt" DESC);

CREATE INDEX IF NOT EXISTS "approval_decisions_org_decided_by_idx"
    ON "approval_decisions" ("organizationId", "decidedById");

-- ── Foreign keys (added only if absent) ──────────────────────
DO $$
BEGIN
    -- approval_processes -> organizations (CASCADE)
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'approval_processes_organizationId_fkey'
    ) THEN
        ALTER TABLE "approval_processes"
            ADD CONSTRAINT "approval_processes_organizationId_fkey"
            FOREIGN KEY ("organizationId") REFERENCES "organizations"("id")
            ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;

    -- approval_processes -> users (created_by, SET NULL)
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'approval_processes_createdById_fkey'
    ) THEN
        ALTER TABLE "approval_processes"
            ADD CONSTRAINT "approval_processes_createdById_fkey"
            FOREIGN KEY ("createdById") REFERENCES "users"("id")
            ON DELETE SET NULL ON UPDATE CASCADE;
    END IF;

    -- approval_steps -> organizations (CASCADE)
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'approval_steps_organizationId_fkey'
    ) THEN
        ALTER TABLE "approval_steps"
            ADD CONSTRAINT "approval_steps_organizationId_fkey"
            FOREIGN KEY ("organizationId") REFERENCES "organizations"("id")
            ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;

    -- approval_steps -> approval_processes (CASCADE — steps die with their process)
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'approval_steps_processId_fkey'
    ) THEN
        ALTER TABLE "approval_steps"
            ADD CONSTRAINT "approval_steps_processId_fkey"
            FOREIGN KEY ("processId") REFERENCES "approval_processes"("id")
            ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;

    -- approval_steps -> users (approver, SET NULL)
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'approval_steps_approverUserId_fkey'
    ) THEN
        ALTER TABLE "approval_steps"
            ADD CONSTRAINT "approval_steps_approverUserId_fkey"
            FOREIGN KEY ("approverUserId") REFERENCES "users"("id")
            ON DELETE SET NULL ON UPDATE CASCADE;
    END IF;

    -- approval_steps -> roles (approver, SET NULL)
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'approval_steps_approverRoleId_fkey'
    ) THEN
        ALTER TABLE "approval_steps"
            ADD CONSTRAINT "approval_steps_approverRoleId_fkey"
            FOREIGN KEY ("approverRoleId") REFERENCES "roles"("id")
            ON DELETE SET NULL ON UPDATE CASCADE;
    END IF;

    -- approval_requests -> organizations (CASCADE)
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'approval_requests_organizationId_fkey'
    ) THEN
        ALTER TABLE "approval_requests"
            ADD CONSTRAINT "approval_requests_organizationId_fkey"
            FOREIGN KEY ("organizationId") REFERENCES "organizations"("id")
            ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;

    -- approval_requests -> approval_processes (RESTRICT — keep history honest)
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'approval_requests_processId_fkey'
    ) THEN
        ALTER TABLE "approval_requests"
            ADD CONSTRAINT "approval_requests_processId_fkey"
            FOREIGN KEY ("processId") REFERENCES "approval_processes"("id")
            ON DELETE RESTRICT ON UPDATE CASCADE;
    END IF;

    -- approval_requests -> users (requested_by, RESTRICT)
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'approval_requests_requestedById_fkey'
    ) THEN
        ALTER TABLE "approval_requests"
            ADD CONSTRAINT "approval_requests_requestedById_fkey"
            FOREIGN KEY ("requestedById") REFERENCES "users"("id")
            ON DELETE RESTRICT ON UPDATE CASCADE;
    END IF;

    -- approval_decisions -> organizations (CASCADE)
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'approval_decisions_organizationId_fkey'
    ) THEN
        ALTER TABLE "approval_decisions"
            ADD CONSTRAINT "approval_decisions_organizationId_fkey"
            FOREIGN KEY ("organizationId") REFERENCES "organizations"("id")
            ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;

    -- approval_decisions -> approval_requests (CASCADE — decisions die with the request)
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'approval_decisions_requestId_fkey'
    ) THEN
        ALTER TABLE "approval_decisions"
            ADD CONSTRAINT "approval_decisions_requestId_fkey"
            FOREIGN KEY ("requestId") REFERENCES "approval_requests"("id")
            ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;

    -- approval_decisions -> users (decided_by, RESTRICT)
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'approval_decisions_decidedById_fkey'
    ) THEN
        ALTER TABLE "approval_decisions"
            ADD CONSTRAINT "approval_decisions_decidedById_fkey"
            FOREIGN KEY ("decidedById") REFERENCES "users"("id")
            ON DELETE RESTRICT ON UPDATE CASCADE;
    END IF;

    -- Prevent concurrent double-decide on the same step. Without this,
    -- two simultaneous decide() calls can both pass the eligibility
    -- check and both insert a decision row, corrupting the audit log
    -- and double-advancing the chain.
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'approval_decisions_request_step_uniq'
    ) THEN
        ALTER TABLE "approval_decisions"
            ADD CONSTRAINT "approval_decisions_request_step_uniq"
            UNIQUE ("requestId", "stepOrder");
    END IF;
END $$;

COMMIT;
