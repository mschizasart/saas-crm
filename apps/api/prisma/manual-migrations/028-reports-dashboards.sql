-- ─────────────────────────────────────────────────────────────
--  Migration: 028 — Reports & Dashboards (Wave D2)
--
--  Salesforce-style drag-and-drop report builder + dashboard composer.
--  Three tables, per-org:
--    * reports            — saved report definitions (entity + filters +
--                           groupBy + aggregations + chart type). The
--                           executor (report-engine.ts) is a whitelisted
--                           safe query builder; nothing here ever turns
--                           into raw SQL.
--    * dashboards         — named layouts that compose multiple reports.
--    * dashboard_widgets  — N reports placed on a dashboard with a grid
--                           position {x,y,w,h}.
--
--  Apply manually on the VPS (we don't run `prisma migrate` in prod):
--      psql "$DATABASE_URL" -f 028-reports-dashboards.sql
--
--  Safe to re-run: uses IF NOT EXISTS everywhere.
--
--  NOTE: deliberately NO RLS policy here — tenant isolation is enforced
--  in the service layer via prisma.withOrganization(orgId, …) and the
--  explicit `where: { organizationId: orgId }` on every query in
--  reports.service.ts / dashboards.service.ts / report-engine.ts.
-- ─────────────────────────────────────────────────────────────

BEGIN;

-- ─── reports ─────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "reports" (
    "id"             TEXT         PRIMARY KEY DEFAULT gen_random_uuid()::text,
    "organizationId" TEXT         NOT NULL,
    "name"           TEXT         NOT NULL,
    "description"    TEXT,
    "entityType"     TEXT         NOT NULL,
    "filters"        JSONB        NOT NULL DEFAULT '[]'::jsonb,
    "groupBy"        TEXT,
    "aggregations"   JSONB        NOT NULL DEFAULT '[]'::jsonb,
    "chartType"      TEXT         NOT NULL DEFAULT 'table',
    "createdById"    TEXT,
    "createdAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "reports_chartType_check"
        CHECK ("chartType" IN ('table', 'bar', 'line', 'pie')),
    CONSTRAINT "reports_organizationId_fkey"
        FOREIGN KEY ("organizationId")
        REFERENCES "organizations"("id")
        ON DELETE CASCADE
        ON UPDATE CASCADE
);

CREATE INDEX IF NOT EXISTS "reports_org_entity_idx"
    ON "reports" ("organizationId", "entityType");

CREATE INDEX IF NOT EXISTS "reports_org_idx"
    ON "reports" ("organizationId");

-- ─── dashboards ──────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "dashboards" (
    "id"             TEXT         PRIMARY KEY DEFAULT gen_random_uuid()::text,
    "organizationId" TEXT         NOT NULL,
    "name"           TEXT         NOT NULL,
    "description"    TEXT,
    -- Optional grid layout hints; widget rows carry their own positions
    -- in dashboard_widgets.position. Kept here for forward-compat with a
    -- react-grid-layout style global layout array.
    "layout"         JSONB        NOT NULL DEFAULT '[]'::jsonb,
    "createdById"    TEXT,
    "createdAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "dashboards_organizationId_fkey"
        FOREIGN KEY ("organizationId")
        REFERENCES "organizations"("id")
        ON DELETE CASCADE
        ON UPDATE CASCADE
);

CREATE INDEX IF NOT EXISTS "dashboards_org_idx"
    ON "dashboards" ("organizationId");

-- ─── dashboard_widgets ───────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "dashboard_widgets" (
    "id"             TEXT         PRIMARY KEY DEFAULT gen_random_uuid()::text,
    "organizationId" TEXT         NOT NULL,
    "dashboardId"    TEXT         NOT NULL,
    "reportId"       TEXT         NOT NULL,
    "title"          TEXT,
    -- Grid position; shape {x:number, y:number, w:number, h:number}.
    -- Shape is enforced by the service layer (dashboards.service.ts).
    "position"       JSONB        NOT NULL DEFAULT '{"x":0,"y":0,"w":6,"h":4}'::jsonb,
    "createdAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "dashboard_widgets_organizationId_fkey"
        FOREIGN KEY ("organizationId")
        REFERENCES "organizations"("id")
        ON DELETE CASCADE
        ON UPDATE CASCADE,
    CONSTRAINT "dashboard_widgets_dashboardId_fkey"
        FOREIGN KEY ("dashboardId")
        REFERENCES "dashboards"("id")
        ON DELETE CASCADE
        ON UPDATE CASCADE,
    CONSTRAINT "dashboard_widgets_reportId_fkey"
        FOREIGN KEY ("reportId")
        REFERENCES "reports"("id")
        ON DELETE CASCADE
        ON UPDATE CASCADE
);

CREATE INDEX IF NOT EXISTS "dashboard_widgets_org_dashboard_idx"
    ON "dashboard_widgets" ("organizationId", "dashboardId");

CREATE INDEX IF NOT EXISTS "dashboard_widgets_report_idx"
    ON "dashboard_widgets" ("reportId");

COMMIT;
