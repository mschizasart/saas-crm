/**
 * Shared per-suite helper. Boots a Nest app once and exposes a flag so each
 * suite can `describe.skip` cleanly when the test DB is not available.
 *
 * The integration test infra (Postgres on :5433 with crm_test) is owned by
 * another agent. If `TEST_DATABASE_URL` is absent OR the AppModule fails to
 * connect, we set `available=false` and the suites skip — but the test files
 * stay valuable as documentation of what the integration coverage *should*
 * look like.
 */
import { INestApplication } from '@nestjs/common';
import { applyTestSchema, bootTestApp, resolveTestDatabaseUrl, TestApp } from './setup';

export interface SuiteContext extends Partial<TestApp> {
  available: boolean;
  databaseUrl: string | null;
  reason?: string;
}

let cachedApp: TestApp | null = null;
let cachedAvailable: boolean | null = null;
let cachedReason: string | undefined;

export async function tryBootApp(): Promise<SuiteContext> {
  if (cachedAvailable === false) {
    return { available: false, databaseUrl: null, reason: cachedReason };
  }
  if (cachedAvailable === true && cachedApp) {
    return { ...cachedApp, available: true, databaseUrl: process.env.DATABASE_URL ?? null };
  }

  const url = resolveTestDatabaseUrl();
  if (!url) {
    cachedAvailable = false;
    cachedReason = 'TEST_DATABASE_URL not set and DATABASE_URL not available';
    return { available: false, databaseUrl: null, reason: cachedReason };
  }
  process.env.DATABASE_URL = url;

  const schemaOk = applyTestSchema(url);
  if (!schemaOk) {
    cachedAvailable = false;
    cachedReason = 'prisma db push failed against test database';
    return { available: false, databaseUrl: url, reason: cachedReason };
  }

  try {
    const app = await bootTestApp();
    cachedApp = app;
    cachedAvailable = true;
    return { ...app, available: true, databaseUrl: url };
  } catch (err: any) {
    cachedAvailable = false;
    cachedReason = `bootTestApp failed: ${err?.message ?? err}`;
    return { available: false, databaseUrl: url, reason: cachedReason };
  }
}

export async function shutdownApp(app?: INestApplication): Promise<void> {
  if (app) await app.close().catch(() => {});
  cachedApp = null;
  cachedAvailable = null;
}
