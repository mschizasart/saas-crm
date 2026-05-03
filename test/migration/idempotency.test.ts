import { describe, it, expect } from 'vitest';
import { listMigrationFiles, pingTestDb, readMigration, withTestDb } from '../utils/test-db.js';

/**
 * Idempotency: every manual migration must be safe to re-run.
 * Project convention is `IF NOT EXISTS` everywhere; this test enforces it
 * by applying each migration twice and asserting the second run doesn't
 * throw.
 */
describe('Migration: idempotency', () => {
  it('every manual migration is safe to apply twice', async () => {
    const reachable = await pingTestDb();
    if (!reachable) {
      console.warn('[migration:idempotency] TEST_DATABASE_URL unreachable — skipping');
      return;
    }
    const files = listMigrationFiles();
    expect(files.length).toBeGreaterThan(0);

    await withTestDb(async ({ client }) => {
      // Same stub bootstrap as the forward test.
      const stubs = [
        `CREATE TABLE IF NOT EXISTS "organizations" ("id" TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text, "name" TEXT)`,
        `CREATE TABLE IF NOT EXISTS "users" ("id" TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text, "organizationId" TEXT, "email" TEXT, "twoFaEnabled" BOOLEAN DEFAULT false, "twoFaSecret" TEXT)`,
        `CREATE TABLE IF NOT EXISTS "platform_admins" ("id" TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text, "email" TEXT)`,
        `CREATE TABLE IF NOT EXISTS "clients" ("id" TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text, "organizationId" TEXT)`,
        `CREATE TABLE IF NOT EXISTS "leads" ("id" TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text, "organizationId" TEXT)`,
        `CREATE TABLE IF NOT EXISTS "tickets" ("id" TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text, "organizationId" TEXT)`,
        `CREATE TABLE IF NOT EXISTS "estimates" ("id" TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text, "organizationId" TEXT)`,
        `CREATE TABLE IF NOT EXISTS "products" ("id" TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text, "organizationId" TEXT)`,
        `CREATE OR REPLACE FUNCTION app_current_organization_id() RETURNS uuid AS $$ SELECT NULLIF(current_setting('app.current_organization_id', true), '')::uuid $$ LANGUAGE sql STABLE`,
      ];
      for (const s of stubs) await client.query(s);

      const failures: string[] = [];
      for (const f of files) {
        const sql = readMigration(f);
        // First run
        try {
          await client.query(sql);
        } catch (e) {
          failures.push(`${f} (first run): ${(e as Error).message}`);
          continue;
        }
        // Second run — must succeed without error.
        try {
          await client.query(sql);
        } catch (e) {
          failures.push(`${f} (second run): ${(e as Error).message}`);
        }
      }

      if (failures.length > 0) {
        throw new Error(`Idempotency failures:\n  - ${failures.join('\n  - ')}`);
      }
      expect(failures).toEqual([]);
    });
  });
});
