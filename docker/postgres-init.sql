-- Enable pg_trgm for full-text search
CREATE EXTENSION IF NOT EXISTS pg_trgm;
-- Enable pgcrypto for gen_random_uuid()
CREATE EXTENSION IF NOT EXISTS pgcrypto;
-- Enable uuid-ossp as fallback
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- Create the app settings function used by RLS policies
CREATE OR REPLACE FUNCTION app_current_organization_id()
RETURNS UUID AS $$
  SELECT NULLIF(current_setting('app.current_organization_id', true), '')::UUID;
$$ LANGUAGE sql STABLE;
