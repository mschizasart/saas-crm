-- ─────────────────────────────────────────────────────────────
--  Migration: 018 — per-org membership Role FK
--
--  Closes the v2 RBAC gap left by 017 (multi-org membership). Each
--  UserOrganizationMembership now carries a real, configurable FK to a
--  Role IN THE SAME org, so a user's permissions in a SECONDARY org come
--  from THAT org's Role instead of a name-matching heuristic or nothing.
--
--  The existing `role` TEXT column is KEPT — it is the coarse "role tier"
--  ('admin' | 'staff' | 'owner') that drives the `isAdmin` bypass. The new
--  `roleId` drives granular permissions. Both coexist.
--
--  Apply manually on the VPS:
--    psql "$DATABASE_URL" -f 018-membership-role-fk.sql
--
--  Idempotent + transactional:
--    - ADD COLUMN IF NOT EXISTS, guarded FK creation.
--    - Backfill only sets roleId where it is currently NULL, so re-running
--      never clobbers an already-assigned role.
--
--  BACKFILL strategy:
--    1. Primary memberships (isPrimary = true): copy the user's legacy
--       primary-org role (users.roleId) — but ONLY if that Role belongs to
--       the membership's org (always true for the primary membership). This
--       preserves the home-org permission set exactly.
--    2. Non-primary memberships: map the coarse `role` tier string to a
--       matching Role BY NAME within the membership's own org:
--          admin → 'Administrator' | 'Admin'
--          owner → 'Administrator' | 'Admin'
--          staff → 'Staff' | 'Member'
--       Leave roleId NULL when no match exists (fail-closed → no
--       permissions; the user is denied every permission-gated route in
--       that org until an admin assigns a real Role).
-- ─────────────────────────────────────────────────────────────

BEGIN;

-- 1. Column (nullable; fail-closed default of "no granular role").
ALTER TABLE "user_organization_memberships"
    ADD COLUMN IF NOT EXISTS "roleId" TEXT;

-- 2. FK constraint → roles(id). ON DELETE SET NULL so removing a Role
--    downgrades affected members to fail-closed rather than deleting them.
--    Guarded so re-running the migration is a no-op.
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'user_organization_memberships_roleId_fkey'
    ) THEN
        ALTER TABLE "user_organization_memberships"
            ADD CONSTRAINT "user_organization_memberships_roleId_fkey"
            FOREIGN KEY ("roleId") REFERENCES "roles"("id")
            ON DELETE SET NULL ON UPDATE CASCADE;
    END IF;
END$$;

-- 3. Index to match the Prisma @@index([roleId]).
CREATE INDEX IF NOT EXISTS "user_organization_memberships_roleId_idx"
    ON "user_organization_memberships" ("roleId");

-- 4a. Backfill PRIMARY memberships from the user's legacy primary role.
--     Only when the user's Role lives in the membership's own org (the
--     primary membership's org == users.organizationId, so this holds), and
--     only where roleId is still NULL (idempotent).
UPDATE "user_organization_memberships" m
SET "roleId" = u."roleId"
FROM "users" u
JOIN "roles" r ON r."id" = u."roleId"
WHERE m."userId" = u."id"
  AND m."isPrimary" = TRUE
  AND m."roleId" IS NULL
  AND u."roleId" IS NOT NULL
  AND r."organizationId" = m."organizationId";

-- 4b. Backfill NON-PRIMARY memberships by mapping the coarse tier string to
--     a Role BY NAME within the membership's own org. Picks the first
--     case-insensitive name match. Leaves roleId NULL when no Role matches
--     (fail-closed). Only touches rows where roleId is still NULL.
-- NB: a correlated scalar subquery (not FROM LATERAL) — Postgres does not
-- allow a `FROM LATERAL` clause in UPDATE to reference the UPDATE target
-- table `m`, but a correlated subquery in SET may.
UPDATE "user_organization_memberships" m
SET "roleId" = (
    SELECT r."id"
    FROM "roles" r
    WHERE r."organizationId" = m."organizationId"
      AND (
            (lower(m."role") IN ('admin', 'owner')
                AND lower(r."name") IN ('administrator', 'admin'))
         OR (lower(m."role") = 'staff'
                AND lower(r."name") IN ('staff', 'member'))
      )
    ORDER BY r."name" ASC
    LIMIT 1
)
WHERE m."isPrimary" = FALSE
  AND m."roleId" IS NULL;

COMMIT;

-- 5. Post-backfill report. Read-only count (idempotent — safe to re-run) of
--    memberships that STILL have roleId IS NULL, so the operator can see which
--    orgs need a manual Role assignment (those members are fail-closed: denied
--    every permission-gated route in that org until an admin assigns a Role).
DO $$
DECLARE
    null_count   bigint;
    org_count    bigint;
    sample_orgs  text;
BEGIN
    SELECT count(*),
           count(DISTINCT m."organizationId")
      INTO null_count, org_count
      FROM "user_organization_memberships" m
     WHERE m."roleId" IS NULL;

    IF null_count = 0 THEN
        RAISE NOTICE '[018] Backfill complete: every membership has a roleId.';
    ELSE
        SELECT string_agg(t."organizationId"::text, ', ')
          INTO sample_orgs
          FROM (
              SELECT DISTINCT m."organizationId"
                FROM "user_organization_memberships" m
               WHERE m."roleId" IS NULL
               ORDER BY m."organizationId"
               LIMIT 20
          ) t;

        RAISE NOTICE '[018] % membership(s) across % org(s) still have roleId IS NULL (fail-closed until an admin assigns a Role).', null_count, org_count;
        RAISE NOTICE '[018] Affected org id(s) (first 20): %', sample_orgs;
    END IF;
END$$;
