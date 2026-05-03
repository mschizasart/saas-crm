/**
 * Suite registry. Each suite knows how to run itself and where its
 * JSON output lands so the runner can collect a unified result set.
 *
 * Categories:
 *   smoke, security, contract, migration, performance,
 *   unit, integration, component, e2e
 *
 * The runner does NOT touch unit/integration/component scopes other than
 * shelling out to the workspace package's existing test command — those
 * are owned by the parallel agents.
 */

export type SuiteCategory =
  | 'smoke'
  | 'security'
  | 'contract'
  | 'migration'
  | 'performance'
  | 'unit'
  | 'integration'
  | 'component'
  | 'e2e';

export interface SuiteDefinition {
  /** Stable id, also the CLI subcommand. */
  id: string;
  /** Category bucket for the dashboard. */
  category: SuiteCategory;
  /** Human label used in console + dashboard. */
  label: string;
  /** Shell command (run from repo root unless `cwd` set). */
  command: string;
  /** Optional working directory, relative to repo root. */
  cwd?: string;
  /**
   * Where the JSON reporter writes its output (relative to repo root).
   * The runner reads this file after the command completes.
   * If undefined the runner only records exit-code level pass/fail.
   */
  jsonOutput?: string;
  /** Parser id — picked up in parsers.ts. */
  parser: 'vitest' | 'jest' | 'playwright' | 'plain' | 'autocannon';
  /** If true, suite is allowed to be skipped when env is missing. */
  optional?: boolean;
  /** Description for `--help`. */
  description: string;
}

const REPO_ROOT = process.env.REPO_ROOT || '/home/marios/Documents/Project/saas-crm';

export const SUITES: SuiteDefinition[] = [
  // ─── Smoke ───────────────────────────────────────────────────────
  {
    id: 'smoke',
    category: 'smoke',
    label: 'Smoke (API + Web)',
    command:
      'pnpm vitest run --reporter=json --outputFile=./results/smoke.json smoke/',
    cwd: 'test',
    jsonOutput: 'test/results/smoke.json',
    parser: 'vitest',
    description: 'Lightweight HTTP probes against /health and a few endpoints.',
  },

  // ─── Security ────────────────────────────────────────────────────
  {
    id: 'security',
    category: 'security',
    label: 'Security (audit + scans + assertions)',
    command:
      'pnpm vitest run --reporter=json --outputFile=./results/security.json security/',
    cwd: 'test',
    jsonOutput: 'test/results/security.json',
    parser: 'vitest',
    description:
      'pnpm audit, secret-scan, auth/tenant isolation, SQLi, XSS, security headers.',
  },

  // ─── Contract / API shape ────────────────────────────────────────
  {
    id: 'contract',
    category: 'contract',
    label: 'Contract / API shape',
    command:
      'pnpm vitest run --reporter=json --outputFile=./results/contract.json contract/',
    cwd: 'test',
    jsonOutput: 'test/results/contract.json',
    parser: 'vitest',
    description:
      'OpenAPI snapshot diff + JSON-shape validation for critical GET endpoints.',
  },

  // ─── Migration ───────────────────────────────────────────────────
  {
    id: 'migration',
    category: 'migration',
    label: 'Migration (forward / idempotency / data integrity)',
    command:
      'pnpm vitest run --reporter=json --outputFile=./results/migration.json migration/',
    cwd: 'test',
    jsonOutput: 'test/results/migration.json',
    parser: 'vitest',
    description:
      'Applies apps/api/prisma/manual-migrations/*.sql to a throw-away test DB.',
    optional: true,
  },

  // ─── Performance ─────────────────────────────────────────────────
  {
    id: 'performance',
    category: 'performance',
    label: 'Performance (autocannon + web TTI + EXPLAIN)',
    command: 'pnpm tsx performance/index.ts',
    cwd: 'test',
    jsonOutput: 'test/results/performance.json',
    parser: 'autocannon',
    description: 'API load (autocannon), web cold fetch, and EXPLAIN spot-checks.',
    optional: true,
  },

  // ─── Unit (other agent's territory) ──────────────────────────────
  {
    id: 'unit',
    category: 'unit',
    label: 'API unit tests',
    command:
      'pnpm --filter api exec jest --selectProjects unit --json --outputFile=../../test/results/unit.json',
    jsonOutput: 'test/results/unit.json',
    parser: 'jest',
    description: 'API jest unit tests (apps/api, --selectProjects unit).',
    optional: true,
  },

  // ─── Integration (other agent) ───────────────────────────────────
  {
    id: 'integration',
    category: 'integration',
    label: 'API integration tests',
    command:
      'pnpm --filter api exec jest --selectProjects integration --json --outputFile=../../test/results/integration.json',
    jsonOutput: 'test/results/integration.json',
    parser: 'jest',
    description: 'API integration tests (--selectProjects integration).',
    optional: true,
  },

  // ─── Component (other agent) ─────────────────────────────────────
  {
    id: 'component',
    category: 'component',
    label: 'Web component tests',
    command:
      'pnpm --filter web exec vitest run --reporter=json --outputFile=../../test/results/component.json',
    jsonOutput: 'test/results/component.json',
    parser: 'vitest',
    description: 'Vitest component tests in apps/web.',
    optional: true,
  },

  // ─── E2E (existing playwright) ───────────────────────────────────
  {
    id: 'e2e',
    category: 'e2e',
    label: 'Web E2E (Playwright)',
    command:
      'pnpm --filter web exec playwright test --reporter=json',
    jsonOutput: 'apps/web/playwright-report/results.json',
    parser: 'playwright',
    description: 'Existing Playwright suite (apps/web/playwright.config.ts).',
    optional: true,
  },
];

export function findSuite(id: string): SuiteDefinition | undefined {
  return SUITES.find((s) => s.id === id);
}

export function suitesForCategory(cat: SuiteCategory): SuiteDefinition[] {
  return SUITES.filter((s) => s.category === cat);
}

export { REPO_ROOT };
