-- ─────────────────────────────────────────────────────────────
--  Minimal smoke / contract / migration seed.
--  Inserts one organization, one staff user, and a handful of
--  records across the multi-tenant tables — just enough to make
--  GET /api/v1/<thing> return non-empty bodies.
--
--  Apply against the test DB AFTER prisma db push (or after the
--  manual migrations run cleanly):
--
--    psql "$TEST_DATABASE_URL" -f test/fixtures/seed.sql
--
--  Idempotent: ON CONFLICT DO NOTHING everywhere we expect a unique key.
-- ─────────────────────────────────────────────────────────────

INSERT INTO "organizations" ("id", "name")
VALUES ('00000000-0000-0000-0000-000000000001', 'Test Org')
ON CONFLICT ("id") DO NOTHING;

INSERT INTO "users" ("id", "organizationId", "email")
VALUES (
  '00000000-0000-0000-0000-000000000010',
  '00000000-0000-0000-0000-000000000001',
  'test@example.invalid'
)
ON CONFLICT ("id") DO NOTHING;

INSERT INTO "clients" ("id", "organizationId")
VALUES
  ('00000000-0000-0000-0000-0000000000c1', '00000000-0000-0000-0000-000000000001'),
  ('00000000-0000-0000-0000-0000000000c2', '00000000-0000-0000-0000-000000000001'),
  ('00000000-0000-0000-0000-0000000000c3', '00000000-0000-0000-0000-000000000001')
ON CONFLICT ("id") DO NOTHING;

INSERT INTO "leads" ("id", "organizationId")
VALUES
  ('00000000-0000-0000-0000-0000000000l1', '00000000-0000-0000-0000-000000000001'),
  ('00000000-0000-0000-0000-0000000000l2', '00000000-0000-0000-0000-000000000001')
ON CONFLICT ("id") DO NOTHING;
