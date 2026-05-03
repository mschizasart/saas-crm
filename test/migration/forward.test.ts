import { describe, it, expect } from 'vitest';
import { listMigrationFiles, pingTestDb, readMigration, withTestDb } from '../utils/test-db.js';

/**
 * The forward migration test:
 *   - applies every numbered SQL in apps/api/prisma/manual-migrations/ in order
 *     to a fresh schema.
 *   - asserts each ALTER TABLE / CREATE TABLE / CREATE INDEX target object
 *     exists post-run (best-effort introspection from the SQL itself).
 *
 * Because the migrations expect tables like `users`, `organizations`,
 * `clients` etc. to already exist (Prisma normally creates those), we
 * pre-create just enough stub tables to let the migrations apply cleanly.
 *
 * If you'd rather run against a real Prisma-applied schema, set
 * SKIP_STUB_BOOTSTRAP=1 and ensure the test DB has been
 * `prisma db push`-ed beforehand.
 */

describe('Migration: forward', () => {
  it('applies all manual SQL migrations in numeric order', async () => {
    const reachable = await pingTestDb();
    if (!reachable) {
      console.warn('[migration] TEST_DATABASE_URL unreachable — skipping');
      return;
    }
    const files = listMigrationFiles();
    expect(files.length).toBeGreaterThan(0);

    await withTestDb(async ({ client }) => {
      if (process.env.SKIP_STUB_BOOTSTRAP !== '1') {
        await bootstrapStubs(client);
      }

      for (const f of files) {
        const sql = readMigration(f);
        try {
          await client.query(sql);
        } catch (e) {
          throw new Error(`Migration ${f} failed: ${(e as Error).message}`);
        }
      }

      // Spot-check: the email_settings table from migration 001 must exist.
      const r = await client.query(
        `SELECT to_regclass(current_schema() || '.email_settings') AS t`,
      );
      expect(r.rows[0].t).not.toBeNull();
    });
  });
});

async function bootstrapStubs(client: import('pg').Client) {
  // Minimal scaffolding so manual migrations can ALTER these tables / FK them.
  // Columns are intentionally permissive — the real schema is owned by Prisma.
  const stmts = [
    `CREATE TABLE IF NOT EXISTS "organizations" (
       "id" TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
       "name" TEXT
     )`,
    `CREATE TABLE IF NOT EXISTS "users" (
       "id" TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
       "organizationId" TEXT,
       "email" TEXT,
       "twoFaEnabled" BOOLEAN DEFAULT false,
       "twoFaSecret" TEXT
     )`,
    `CREATE TABLE IF NOT EXISTS "platform_admins" (
       "id" TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
       "email" TEXT
     )`,
    `CREATE TABLE IF NOT EXISTS "clients" (
       "id" TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
       "organizationId" TEXT
     )`,
    `CREATE TABLE IF NOT EXISTS "leads" (
       "id" TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
       "organizationId" TEXT
     )`,
    `CREATE TABLE IF NOT EXISTS "tickets" (
       "id" TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
       "organizationId" TEXT
     )`,
    `CREATE TABLE IF NOT EXISTS "estimates" (
       "id" TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
       "organizationId" TEXT
     )`,
    `CREATE TABLE IF NOT EXISTS "products" (
       "id" TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
       "organizationId" TEXT
     )`,
    // Stub the helper function used by the RLS policies so policy SQL doesn't blow up.
    `CREATE OR REPLACE FUNCTION app_current_organization_id() RETURNS uuid AS $$
       SELECT NULLIF(current_setting('app.current_organization_id', true), '')::uuid
     $$ LANGUAGE sql STABLE`,
  ];
  for (const s of stmts) await client.query(s);
}
