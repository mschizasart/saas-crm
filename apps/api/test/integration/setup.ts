/**
 * Integration-test harness.
 *
 * Boots a real Nest application against a real Postgres instance pointed at
 * by `TEST_DATABASE_URL`. The other test-infra agent owns provisioning a
 * `crm_test` database on port 5433 — if that's not yet up, we fall back to
 * the dev DB but with a `_test` schema so production rows aren't affected.
 *
 * This file is intentionally NOT a `.spec.ts`, so Jest won't try to pick it
 * up as a test suite.
 */
import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import {
  FastifyAdapter,
  NestFastifyApplication,
} from '@nestjs/platform-fastify';
import { ValidationPipe, VersioningType } from '@nestjs/common';
import { execSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import { JwtService } from '@nestjs/jwt';

/**
 * Resolve the test database URL. Priority:
 *   1. TEST_DATABASE_URL — explicit, set by CI / the test-infra agent
 *   2. DATABASE_URL with an appended ?schema=test_<random> — local fallback
 *   3. null — caller must skip integration tests
 */
export function resolveTestDatabaseUrl(): string | null {
  if (process.env.TEST_DATABASE_URL) return process.env.TEST_DATABASE_URL;
  if (process.env.DATABASE_URL) {
    const url = new URL(process.env.DATABASE_URL);
    // Append a random schema so we don't collide with the dev DB.
    url.searchParams.set('schema', `jest_${Date.now()}`);
    return url.toString();
  }
  return null;
}

/**
 * Probe the DB by attempting a `prisma db push --accept-data-loss --skip-generate`.
 * Returns `true` if the schema was applied, `false` otherwise.
 *
 * We intentionally use `db push` (not `migrate deploy`) because the project
 * stores the canonical schema in `prisma/schema.prisma` and the manual
 * migrations are folded in there as well — pushing is the one-shot equivalent.
 */
export function applyTestSchema(databaseUrl: string): boolean {
  try {
    execSync('pnpm prisma db push --accept-data-loss --skip-generate', {
      cwd: path.resolve(__dirname, '..', '..'),
      env: { ...process.env, DATABASE_URL: databaseUrl },
      stdio: 'pipe',
      timeout: 60_000,
    });

    // Apply manual SQL migrations on top (RLS policies, etc.)
    const migDir = path.resolve(
      __dirname,
      '..',
      '..',
      'prisma',
      'manual-migrations',
    );
    if (fs.existsSync(migDir)) {
      const files = fs.readdirSync(migDir).filter((f) => f.endsWith('.sql')).sort();
      // Use psql to apply each — but psql may not be on the path. Try and
      // skip on failure (the AppModule will still start; tests that depend
      // on those columns will fail individually).
      for (const f of files) {
        try {
          execSync(`psql "${databaseUrl}" -f "${path.join(migDir, f)}"`, {
            stdio: 'pipe',
            timeout: 15_000,
          });
        } catch {
          // best effort
        }
      }
    }
    return true;
  } catch (err) {
    return false;
  }
}

export interface TestApp {
  app: INestApplication;
  module: TestingModule;
  baseUrl: string;
}

/**
 * Build a Nest test app configured the same way `main.ts` does (versioning,
 * global prefix, validation pipe).
 */
export async function bootTestApp(): Promise<TestApp> {
  // Lazy-import AppModule so jest doesn't try to evaluate the whole DI graph
  // at module load (which would crash if env is missing).
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { AppModule } = require('../../src/app.module');

  const moduleRef: TestingModule = await Test.createTestingModule({
    imports: [AppModule],
  }).compile();

  const app = moduleRef.createNestApplication<NestFastifyApplication>(
    new FastifyAdapter({ logger: false }),
  );
  app.setGlobalPrefix('api');
  app.enableVersioning({ type: VersioningType.URI, defaultVersion: '1' });
  app.useGlobalPipes(
    new ValidationPipe({ whitelist: true, transform: true }),
  );
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const multipart = require('@fastify/multipart');
    await (app as any).register(multipart, {
      limits: { fileSize: 10 * 1024 * 1024 },
    });
  } catch {
    // optional
  }

  await app.init();
  await (app.getHttpAdapter().getInstance() as any).ready();

  return { app, module: moduleRef, baseUrl: '/api/v1' };
}

/**
 * Seed an organization + active staff user, returning a real JWT signed with
 * the test JwtService. Use the returned token in the `Authorization: Bearer
 * <token>` header.
 */
export async function seedOrg(
  app: INestApplication,
  opts: { slug?: string; email?: string } = {},
): Promise<{
  org: { id: string; slug: string };
  user: { id: string; email: string };
  token: string;
}> {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { PrismaService } = require('../../src/database/prisma.service');
  const prisma = app.get(PrismaService);
  const jwt: JwtService = app.get(JwtService);

  const slug = opts.slug ?? `t${Date.now()}-${Math.floor(Math.random() * 1000)}`;
  const email =
    opts.email ?? `tester+${slug}@jest.local`;

  const org = await prisma.organization.create({
    data: {
      slug,
      name: `Test Org ${slug}`,
    },
  });

  // bcrypt-hash a throwaway password
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const bcrypt = require('bcryptjs');
  const password = await bcrypt.hash('test-password', 10);

  const user = await prisma.user.create({
    data: {
      organizationId: org.id,
      email,
      password,
      passwordFormat: 'bcrypt',
      firstName: 'Test',
      lastName: 'User',
      type: 'staff',
      active: true,
    },
  });

  const token = jwt.sign(
    { sub: user.id, email: user.email, orgId: org.id, type: 'staff' },
    { expiresIn: '1h' },
  );

  return {
    org: { id: org.id, slug: org.slug },
    user: { id: user.id, email: user.email },
    token,
  };
}

/**
 * Best-effort cleanup. Runs at the end of a suite to free the test schema.
 * Failures here are swallowed — losing a few rows in the test DB is fine.
 */
export async function teardownOrg(
  app: INestApplication,
  orgId: string,
): Promise<void> {
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { PrismaService } = require('../../src/database/prisma.service');
    const prisma = app.get(PrismaService);
    await prisma.organization.delete({ where: { id: orgId } }).catch(() => {});
  } catch {
    // best effort
  }
}
