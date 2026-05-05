import { spawn } from 'node:child_process';
import { join } from 'node:path';
import chalk from 'chalk';
import { findSuite, REPO_ROOT, SUITES } from './suites.js';
import {
  parseVitest,
  parseJest,
  parsePlaywright,
  parseAutocannon,
  parsePlain,
  parseStryker,
  type SuiteRunSummary,
} from './parsers.js';
import { generateDashboard } from './dashboard.js';

export interface RunOptions {
  regenerateDashboard?: boolean;
  bail?: boolean;
}

export async function runSuites(
  suiteIds: string[],
  opts: RunOptions = {},
): Promise<SuiteRunSummary[]> {
  const summaries: SuiteRunSummary[] = [];

  for (const id of suiteIds) {
    const suite = findSuite(id);
    if (!suite) {
      console.warn(chalk.yellow(`[runner] Unknown suite: ${id} — skipping`));
      continue;
    }

    console.log(chalk.cyan(`\n▶ ${suite.label} (${suite.id})`));
    const startedAt = Date.now();
    const exitCode = await runShell(suite.command, suite.cwd);
    const duration = Date.now() - startedAt;

    const jsonPath = suite.jsonOutput
      ? join(REPO_ROOT, suite.jsonOutput)
      : '';

    let summary: SuiteRunSummary;
    switch (suite.parser) {
      case 'vitest':
        summary = parseVitest(jsonPath, suite.id, suite.category, suite.label);
        break;
      case 'jest':
        summary = parseJest(jsonPath, suite.id, suite.category, suite.label);
        break;
      case 'playwright':
        summary = parsePlaywright(jsonPath, suite.id, suite.category, suite.label);
        break;
      case 'autocannon':
        summary = parseAutocannon(jsonPath, suite.id, suite.category, suite.label);
        break;
      case 'stryker':
        summary = parseStryker(jsonPath, suite.id, suite.category, suite.label);
        break;
      default:
        summary = parsePlain(jsonPath, suite.id, suite.category, suite.label, exitCode);
    }
    summary.exitCode = exitCode;
    summary.durationMs = duration;
    summary.finishedAt = new Date().toISOString();

    summaries.push(summary);
    printSummary(summary);

    if (opts.bail && summary.failed > 0) break;
  }

  if (opts.regenerateDashboard !== false) {
    const out = generateDashboard(summaries);
    console.log(chalk.green(`\nDashboard: ${out}`));
  }

  return summaries;
}

export async function runAll(opts: RunOptions = {}): Promise<SuiteRunSummary[]> {
  return runSuites(
    SUITES.map((s) => s.id),
    opts,
  );
}

function runShell(cmd: string, cwdRel?: string): Promise<number> {
  return new Promise((resolve) => {
    const cwd = cwdRel ? join(REPO_ROOT, cwdRel) : REPO_ROOT;
    const child = spawn(cmd, {
      cwd,
      shell: true,
      stdio: 'inherit',
      env: { ...process.env, FORCE_COLOR: '1' },
    });
    child.on('close', (code) => resolve(code ?? 0));
    child.on('error', () => resolve(1));
  });
}

function printSummary(s: SuiteRunSummary) {
  const colour =
    s.failed > 0 ? chalk.red : s.total === 0 ? chalk.gray : chalk.green;
  const line = `  ${colour(
    `${s.passed}/${s.total} passed`,
  )} (${s.failed} failed, ${s.skipped} skipped) in ${s.durationMs}ms${
    s.missing ? chalk.gray(' [no JSON output]') : ''
  }`;
  console.log(line);
}
