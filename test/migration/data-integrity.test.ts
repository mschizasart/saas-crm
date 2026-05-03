import { describe, it, expect } from 'vitest';
import { listMigrationFiles, pingTestDb, readMigration, withTestDb } from '../utils/test-db.js';

/**
 * Data integrity: seed a few rows, then run all migrations against a *different*
 * fresh schema with the same seed, and assert SELECT counts match.
 *
 * Sanity check that nothing in the migration set quietly DROPs / TRUNCATEs
 * data on existing tables.
 */
describe('Migration: data integrity', () => {
  it('seeded rows survive a full migration replay', async () => {
    const reachable = await pingTestDb();
    if (!reachable) {
      console.warn('[migration:data-integrity] TEST_DATABASE_URL unreachable — skipping');
      return;
    }
    const files = listMigrationFiles();

    await withTestDb(async ({ client }) => {
      // Bootstrap stub schema.
      await client.query(
        `CREATE TABLE IF NOT EXISTS "organizations" ("id" TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text, "name" TEXT)`,
      );
      await client.query(
        `CREATE TABLE IF NOT EXISTS "clients" ("id" TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text, "organizationId" TEXT)`,
      );
      await client.query(
        `CREATE TABLE IF NOT EXISTS "users" ("id" TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text, "organizationId" TEXT, "email" TEXT, "twoFaEnabled" BOOLEAN DEFAULT false, "twoFaSecret" TEXT)`,
      );
      await client.query(
        `CREATE TABLE IF NOT EXISTS "platform_admins" ("id" TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text, "email" TEXT)`,
      );
      await client.query(
        `CREATE TABLE IF NOT EXISTS "leads" ("id" TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text, "organizationId" TEXT)`,
      );
      await client.query(
        `CREATE TABLE IF NOT EXISTS "tickets" ("id" TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text, "organizationId" TEXT)`,
      );
      await client.query(
        `CREATE TABLE IF NOT EXISTS "estimates" ("id" TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text, "organizationId" TEXT)`,
      );
      await client.query(
        `CREATE TABLE IF NOT EXISTS "products" ("id" TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text, "organizationId" TEXT)`,
      );
      await client.query(
        `CREATE OR REPLACE FUNCTION app_current_organization_id() RETURNS uuid AS $$ SELECT NULLIF(current_setting('app.current_organization_id', true), '')::uuid $$ LANGUAGE sql STABLE`,
      );

      // Seed: 1 org, 5 clients.
      const orgRes = await client.query(
        `INSERT INTO "organizations" ("name") VALUES ('Acme Test Org') RETURNING "id"`,
      );
      const orgId = orgRes.rows[0].id;
      for (let i = 0; i < 5; i++) {
        await client.query(
          `INSERT INTO "clients" ("organizationId") VALUES ($1)`,
          [orgId],
        );
      }
      const beforeRes = await client.query(`SELECT COUNT(*)::int AS c FROM "clients"`);
      const before = beforeRes.rows[0].c;

      for (const f of files) {
        await client.query(readMigration(f));
      }

      const afterRes = await client.query(`SELECT COUNT(*)::int AS c FROM "clients"`);
      const after = afterRes.rows[0].c;

      expect(after).toBe(before);
      expect(after).toBe(5);

      // Org row also untouched.
      const orgsAfter = await client.query(
        `SELECT COUNT(*)::int AS c FROM "organizations" WHERE "id" = $1`,
        [orgId],
      );
      expect(orgsAfter.rows[0].c).toBe(1);
    });
  });
});
