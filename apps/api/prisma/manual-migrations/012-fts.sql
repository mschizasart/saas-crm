-- ─────────────────────────────────────────────────────────────
--  Migration: 012 — Cross-record full-text search index
--
--  Single denormalised `search_index` table that powers the
--  Cmd-K palette across 8 entity types (lead, client, invoice,
--  estimate, proposal, contract, ticket, product). Maintained
--  by application code (SearchIndexerService) — NOT by SQL
--  triggers — so we can produce nice display strings (e.g.
--  "Invoice — Acme Ltd — $1,200") without re-implementing
--  formatting in PL/pgSQL.
--
--  Design notes:
--    * Generated `tsv` column (STORED) — Postgres recomputes
--      the tsvector on row write, no manual UPDATE needed.
--    * GIN index on `tsv`           → full-text relevance
--    * GIN index on `title` trigram → fuzzy / typo tolerance
--      (e.g. "acmee" still matches "Acme Ltd")
--    * Composite (organizationId, entityType) index for the
--      reindexer's per-type batched scans.
--    * `simple` text-search config (no stemming) — record
--      titles are mostly proper nouns / numbers; English
--      stemming would mangle "Acme" → "acm".
--
--  Apply manually on the VPS:
--      psql "$DATABASE_URL" -f 012-fts.sql
--
--  Safe to re-run: every statement is idempotent.
-- ─────────────────────────────────────────────────────────────

-- ── 1. Extensions ────────────────────────────────────────────
-- pg_trgm powers similarity() and the GIN trigram index.
-- May already be enabled (knowledge-base FTS doesn't use it,
-- but other CRMs on this box might). CREATE EXTENSION IF NOT
-- EXISTS is a no-op if it already exists.
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- ── 2. Table ─────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "search_index" (
    "id"             TEXT        PRIMARY KEY,
    "organizationId" TEXT        NOT NULL,
    "entityType"     TEXT        NOT NULL,
    "entityId"       TEXT        NOT NULL,
    "title"          TEXT        NOT NULL,
    "subtitle"       TEXT,
    "body"           TEXT,
    "url"            TEXT        NOT NULL,
    "updatedAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- ── 3. Generated tsvector column ─────────────────────────────
-- Done as a separate ALTER (rather than inline) so the table
-- creation above is plain Prisma-shaped DDL — easier to keep
-- the Prisma model and the SQL in sync. The tsvector is NOT
-- modeled in Prisma; the indexer service writes only title/
-- subtitle/body and Postgres derives `tsv` automatically.
ALTER TABLE "search_index"
    ADD COLUMN IF NOT EXISTS "tsv" tsvector
    GENERATED ALWAYS AS (
        to_tsvector(
            'simple',
            coalesce("title", '') || ' ' ||
            coalesce("subtitle", '') || ' ' ||
            coalesce("body", '')
        )
    ) STORED;

-- ── 4. Constraints & indexes ─────────────────────────────────
-- Uniqueness lets us UPSERT by (org, type, id) without an extra
-- SELECT. The PK above is on the synthetic `id` (uuid) — this
-- composite is the natural key the application uses.
CREATE UNIQUE INDEX IF NOT EXISTS "search_index_org_entity_uniq"
    ON "search_index" ("organizationId", "entityType", "entityId");

CREATE INDEX IF NOT EXISTS "search_index_org_idx"
    ON "search_index" ("organizationId");

-- Used by the reindexer when iterating one entity type at a time,
-- and by the search query when narrowing to a specific tab/type.
CREATE INDEX IF NOT EXISTS "search_index_org_type_idx"
    ON "search_index" ("organizationId", "entityType");

-- GIN over the generated tsvector → full-text relevance ranking
-- via ts_rank(tsv, plainto_tsquery('simple', $q)).
CREATE INDEX IF NOT EXISTS "search_index_tsv_idx"
    ON "search_index" USING GIN ("tsv");

-- GIN trigram on `title` → fuzzy similarity() matching for the
-- Cmd-K palette so "acmee" / "ACME" / "acme " all resolve.
CREATE INDEX IF NOT EXISTS "search_index_title_trgm_idx"
    ON "search_index" USING GIN ("title" gin_trgm_ops);

-- ── 5. Row-Level Security ────────────────────────────────────
-- Mirrors the tenant_isolation pattern used by every other tenant-
-- scoped table on this DB. Application code wraps every read/write
-- in PrismaService.withOrganization(orgId, …) which sets
-- app.current_organization_id for the transaction; the policy then
-- restricts visible rows to the active tenant.
ALTER TABLE "search_index" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "search_index" FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation ON "search_index";
CREATE POLICY tenant_isolation ON "search_index"
    USING ("organizationId"::uuid = app_current_organization_id());
