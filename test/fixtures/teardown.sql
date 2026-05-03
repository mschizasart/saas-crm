-- Drops everything inserted by seed.sql, in dependency-safe order.
-- Run with: psql "$TEST_DATABASE_URL" -f test/fixtures/teardown.sql

DELETE FROM "leads"   WHERE "organizationId" = '00000000-0000-0000-0000-000000000001';
DELETE FROM "clients" WHERE "organizationId" = '00000000-0000-0000-0000-000000000001';
DELETE FROM "users"   WHERE "organizationId" = '00000000-0000-0000-0000-000000000001';
DELETE FROM "organizations" WHERE "id"        = '00000000-0000-0000-0000-000000000001';
