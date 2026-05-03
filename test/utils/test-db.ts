/**
 * Test DB helper. Spins up an isolated schema on a Postgres reachable via
 * TEST_DATABASE_URL (default: postgresql://crm:CrmPass2024!@localhost:5433/crm_test).
 *
 * `withTestDb(fn)` :
 *   1. Connects to TEST_DATABASE_URL.
 *   2. Creates a unique schema (`test_run_<random>`).
 *   3. SET search_path so subsequent queries land in it.
 *   4. Runs `fn(client)`.
 *   5. Drops the schema in `finally`.
 *
 * For local dev: ensure a postgres-test service exists. The repo's
 * docker-compose.yml only has the prod-like postgres on 5432, so the
 * easy path is to either:
 *   (a) run a one-off:
 *       docker run --rm -d --name pg-test -p 5433:5432 \
 *         -e POSTGRES_USER=crm -e POSTGRES_PASSWORD=CrmPass2024! \
 *         -e POSTGRES_DB=crm_test postgres:16-alpine
 *   (b) point TEST_DATABASE_URL at an existing crm_test database on
 *       the running postgres (port 5432).
 */
import { Client } from 'pg';
import { randomBytes } from 'node:crypto';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const REPO_ROOT = process.env.REPO_ROOT || '/home/marios/Documents/Project/saas-crm';
const MIGRATIONS_DIR = join(REPO_ROOT, 'apps/api/prisma/manual-migrations');

export const TEST_DATABASE_URL =
  process.env.TEST_DATABASE_URL ??
  'postgresql://crm:CrmPass2024!@localhost:5433/crm_test';

export interface TestDbContext {
  client: Client;
  schema: string;
}

export async function withTestDb<T>(
  fn: (ctx: TestDbContext) => Promise<T>,
): Promise<T> {
  const client = new Client({ connectionString: TEST_DATABASE_URL });
  await client.connect();

  const schema = `test_${randomBytes(6).toString('hex')}`;
  await client.query(`CREATE SCHEMA "${schema}"`);
  await client.query(`SET search_path TO "${schema}"`);
  try {
    return await fn({ client, schema });
  } finally {
    try {
      await client.query(`DROP SCHEMA "${schema}" CASCADE`);
    } catch {
      /* swallow */
    }
    await client.end();
  }
}

/**
 * Returns the list of migration filenames in numeric order.
 */
export function listMigrationFiles(): string[] {
  if (!existsSync(MIGRATIONS_DIR)) return [];
  return readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith('.sql'))
    .sort((a, b) => {
      const an = Number(a.match(/^(\d+)/)?.[1] ?? 0);
      const bn = Number(b.match(/^(\d+)/)?.[1] ?? 0);
      return an - bn;
    });
}

/**
 * Read a migration's SQL.
 */
export function readMigration(name: string): string {
  return readFileSync(join(MIGRATIONS_DIR, name), 'utf8');
}

export const MIGRATIONS_PATH = MIGRATIONS_DIR;

/**
 * Ping the test DB. Returns true if reachable, false otherwise.
 * Used by tests to skip cleanly when no DB is running.
 */
export async function pingTestDb(): Promise<boolean> {
  const c = new Client({ connectionString: TEST_DATABASE_URL });
  try {
    await c.connect();
    await c.query('SELECT 1');
    await c.end();
    return true;
  } catch {
    try {
      await c.end();
    } catch {
      /* noop */
    }
    return false;
  }
}
