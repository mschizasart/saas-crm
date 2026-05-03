/**
 * Jest config for the saas-crm NestJS API.
 *
 * - Two projects (`unit` and `integration`) so the unified test runner can
 *   target each layer with `--selectProjects unit` / `--selectProjects integration`.
 * - Unit tests are colocated in `src/**` (mirrors NestJS conventions).
 * - Integration tests live in `test/integration/**` and boot a real Nest app
 *   against a test Postgres pointed at by `TEST_DATABASE_URL`.
 *
 * Coverage output is written to `../../test/.coverage/api` so the top-level
 * runner / dashboard can pick it up alongside the other categories.
 */
import type { Config } from 'jest';

const baseTransform = {
  '^.+\\.(t|j)s$': [
    'ts-jest',
    {
      tsconfig: '<rootDir>/tsconfig.json',
      isolatedModules: true,
      diagnostics: false,
    },
  ],
} as const;

const config: Config = {
  // Coverage settings live at the top level so `jest --coverage` works
  // regardless of which project (or both) was invoked.
  rootDir: '.',
  collectCoverageFrom: [
    'src/**/*.{ts}',
    '!src/**/*.spec.ts',
    '!src/main.ts',
    '!src/**/*.module.ts',
  ],
  coverageDirectory: '../../test/.coverage/api',
  coverageReporters: ['text', 'json-summary', 'lcov'],
  testTimeout: 30_000,
  // Two projects: unit (fast, mocked) vs integration (real DB / HTTP).
  projects: [
    {
      displayName: 'unit',
      testEnvironment: 'node',
      preset: 'ts-jest',
      rootDir: '.',
      roots: ['<rootDir>/src'],
      testRegex: 'src/.*\\.spec\\.ts$',
      moduleFileExtensions: ['ts', 'js', 'json'],
      transform: baseTransform as any,
      setupFilesAfterEnv: ['<rootDir>/test/setup.ts'],
    },
    {
      displayName: 'integration',
      testEnvironment: 'node',
      preset: 'ts-jest',
      rootDir: '.',
      roots: ['<rootDir>/test/integration'],
      testRegex: 'test/integration/.*\\.spec\\.ts$',
      moduleFileExtensions: ['ts', 'js', 'json'],
      transform: baseTransform as any,
      setupFilesAfterEnv: ['<rootDir>/test/setup.ts'],
    },
  ],
};

export default config;
