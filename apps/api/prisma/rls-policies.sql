-- ─────────────────────────────────────────────────────────────
--  Row-Level Security policies for all tenant-scoped tables
--  Run AFTER prisma migrate (tables must exist first)
--  Apply with: psql $DATABASE_URL -f prisma/rls-policies.sql
-- ─────────────────────────────────────────────────────────────

-- Helper function (already in postgres-init.sql, repeated for safety)
CREATE OR REPLACE FUNCTION app_current_organization_id()
RETURNS UUID AS $$
  SELECT NULLIF(current_setting('app.current_organization_id', true), '')::UUID;
$$ LANGUAGE sql STABLE;

-- Macro: enable RLS + create tenant isolation policy on a table
DO $$
DECLARE
  tenant_tables TEXT[] := ARRAY[
    'users',
    'roles',
    'client_groups',
    'clients',
    'vault_entries',
    'currencies',
    'taxes',
    'payment_modes',
    'lead_statuses',
    'lead_sources',
    'leads',
    'lead_notes',
    'invoices',
    'invoice_items',
    'payments',
    'payment_attempts',
    'credit_notes',
    'credit_note_items',
    'estimates',
    'estimate_items',
    'proposals',
    'proposal_items',
    'proposal_comments',
    'expense_categories',
    'expenses',
    'client_subscriptions',
    'projects',
    'project_members',
    'milestones',
    'tasks',
    'time_entries',
    'project_discussions',
    'project_files',
    'project_notes',
    'departments',
    'tickets',
    'ticket_replies',
    'ticket_attachments',
    'contract_types',
    'contracts',
    'contract_comments',
    'knowledge_base_groups',
    'knowledge_base_articles',
    'custom_fields',
    'custom_field_values',
    'notifications',
    'activity_log',
    'email_templates',
    'surveys',
    'survey_questions',
    'goals',
    'announcements',
    'saved_filters',
    'todos'
  ];
  t TEXT;
BEGIN
  FOREACH t IN ARRAY tenant_tables LOOP
    BEGIN
      -- Enable RLS
      EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
      -- Force RLS even for table owner (important!)
      EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);

      -- Drop existing policy if any
      EXECUTE format('DROP POLICY IF EXISTS tenant_isolation ON %I', t);

      -- Create policy: only show rows matching current org
      -- Prisma stores organizationId as camelCase in PostgreSQL
      EXECUTE format(
        'CREATE POLICY tenant_isolation ON %I
         USING ("organizationId"::uuid = app_current_organization_id())',
        t
      );

      RAISE NOTICE 'RLS enabled on %', t;
    EXCEPTION
      WHEN undefined_table THEN
        RAISE NOTICE 'Table % does not exist, skipping', t;
      WHEN undefined_column THEN
        RAISE NOTICE 'Table % has no organizationId column, skipping', t;
    END;
  END LOOP;
END $$;

-- Tables without organization_id get no RLS (platform-level tables):
-- platform_admins, organizations, user_sessions, invoice_payment_modes
-- task_assignments, task_checklists, task_comments, task_attachments
-- project_members, project_discussion_comments, milestone, taggable, tags
-- announcement_dismissals, survey_submissions, survey_answers, mail_queue
-- These are protected by application-level access control instead.

-- Full-text search index on knowledge base articles
CREATE INDEX CONCURRENTLY IF NOT EXISTS kb_articles_search_idx
  ON knowledge_base_articles
  USING gin(to_tsvector('english', coalesce(title, '') || ' ' || coalesce(content, '')));

-- GIN trigram index for quick name/email searches
CREATE INDEX CONCURRENTLY IF NOT EXISTS clients_name_trgm_idx
  ON clients USING gin(company gin_trgm_ops);

CREATE INDEX CONCURRENTLY IF NOT EXISTS users_email_trgm_idx
  ON users USING gin(email gin_trgm_ops);

CREATE INDEX CONCURRENTLY IF NOT EXISTS leads_name_trgm_idx
  ON leads USING gin(name gin_trgm_ops);

DO $$ BEGIN RAISE NOTICE 'RLS policies and search indexes applied successfully'; END $$;
