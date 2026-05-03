/**
 * Global Jest setup for the saas-crm API.
 *
 * - Pin TZ so date-based assertions are deterministic across machines / CI.
 * - Suppress the noisy NestJS Logger output during test runs (override = true
 *   so even Logger instances created in a constructor honour the silent
 *   levels).
 * - Provide a minimal default for `JWT_SECRET` / `ENCRYPTION_KEY` so unit
 *   tests that touch the auth or crypto code paths don't blow up because of
 *   a missing env var. Tests can override with `process.env.X = ...` in a
 *   `beforeAll`.
 */
import { Logger } from '@nestjs/common';

process.env.TZ = 'UTC';

// Random non-secret defaults for tests. Real production values are loaded
// from the deployed env, never these.
process.env.JWT_SECRET ??= 'jest-test-jwt-secret-please-do-not-use-in-prod';
// 64 hex chars / 32 bytes — required shape for AES-256-GCM.
process.env.ENCRYPTION_KEY ??=
  '00112233445566778899aabbccddeeff00112233445566778899aabbccddeeff';
process.env.APP_NAME ??= 'AppoinlyCRM-Test';

// Silence Logger by default. Individual tests can re-enable with
// `Logger.overrideLogger(['log','error','warn','debug','verbose'])` if they
// want to inspect output.
Logger.overrideLogger(['error']);
