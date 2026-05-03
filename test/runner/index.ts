#!/usr/bin/env tsx
/**
 * Unified test runner for the saas-crm monorepo.
 *
 * Owned scope (this file):
 *   smoke / security / contract / migration / performance + dashboard + watch.
 *
 * Other categories (unit/integration/component/e2e) are delegated to the
 * relevant workspace package's own test command.
 */
import { Command } from 'commander';
import chalk from 'chalk';
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { runAll, runSuites } from './run.js';
import { SUITES } from './suites.js';
import { startWatch } from './watch.js';

const REPO_ROOT = process.env.REPO_ROOT || '/home/marios/Documents/Project/saas-crm';

const program = new Command();
program
  .name('test-runner')
  .description('Unified test runner for saas-crm')
  .version('0.1.0');

program
  .command('all')
  .description('Run every suite in sequence and regenerate the dashboard')
  .option('--no-dashboard', 'Skip dashboard generation')
  .option('--bail', 'Stop on first suite failure')
  .action(async (opts) => {
    const summaries = await runAll({
      regenerateDashboard: opts.dashboard !== false,
      bail: !!opts.bail,
    });
    printGrandTotal(summaries);
    process.exit(grandTotalExit(summaries));
  });

// dynamic single-suite commands
for (const s of SUITES) {
  program
    .command(s.id)
    .description(s.description + (s.optional ? ' (optional)' : ''))
    .option('--no-dashboard', 'Skip dashboard generation')
    .action(async (opts) => {
      const summaries = await runSuites([s.id], {
        regenerateDashboard: opts.dashboard !== false,
      });
      process.exit(grandTotalExit(summaries));
    });
}

program
  .command('watch')
  .description('Watch for file changes and re-run relevant suites (debounce 500ms)')
  .action(() => {
    startWatch();
  });

program
  .command('dashboard')
  .description('Open the most recently generated HTML report')
  .action(() => {
    const out = join(REPO_ROOT, 'test/dashboard/report.html');
    if (!existsSync(out)) {
      console.error(
        chalk.red(`No dashboard at ${out} — run a suite first.`),
      );
      process.exit(1);
    }
    const opener = process.platform === 'darwin'
      ? 'open'
      : process.platform === 'win32'
      ? 'start'
      : 'xdg-open';
    spawn(opener, [out], { detached: true, stdio: 'ignore' }).unref();
    console.log(chalk.green(`Opened ${out}`));
  });

program
  .command('list')
  .description('List all known suites')
  .action(() => {
    for (const s of SUITES) {
      console.log(
        `${chalk.cyan(s.id.padEnd(14))} ${chalk.gray(`[${s.category}]`)} ${s.description}`,
      );
    }
  });

program.parseAsync(process.argv).catch((e) => {
  console.error(chalk.red(e.stack ?? e.message));
  process.exit(1);
});

function printGrandTotal(summaries: { total: number; passed: number; failed: number; skipped: number }[]) {
  const t = summaries.reduce(
    (a, s) => ({
      total: a.total + s.total,
      passed: a.passed + s.passed,
      failed: a.failed + s.failed,
      skipped: a.skipped + s.skipped,
    }),
    { total: 0, passed: 0, failed: 0, skipped: 0 },
  );
  const colour = t.failed > 0 ? chalk.red : chalk.green;
  console.log(
    colour(
      `\n=== TOTAL: ${t.passed}/${t.total} passed (${t.failed} failed, ${t.skipped} skipped) ===`,
    ),
  );
}

function grandTotalExit(summaries: { failed: number }[]) {
  return summaries.some((s) => s.failed > 0) ? 1 : 0;
}
