import chokidar from 'chokidar';
import { join, relative } from 'node:path';
import { runSuites } from './run.js';
import { REPO_ROOT } from './suites.js';

/**
 * Watch mode: maps file paths -> suite ids and re-runs only what's relevant.
 * Debounced 500ms so saving 10 files in quick succession only triggers once.
 */

const DEBOUNCE_MS = 500;

interface Mapping {
  /** path-test predicate */
  match: (rel: string) => boolean;
  /** suites to run when matched */
  suites: string[];
  /** label for log output */
  label: string;
}

const MAPPINGS: Mapping[] = [
  {
    label: 'API source (unit + integration + contract)',
    match: (p) =>
      p.startsWith('apps/api/src/') &&
      p.endsWith('.ts') &&
      !p.endsWith('.spec.ts') &&
      !p.endsWith('.test.ts'),
    suites: ['unit', 'integration', 'contract'],
  },
  {
    label: 'Web component',
    match: (p) =>
      p.startsWith('apps/web/components/') &&
      (p.endsWith('.tsx') || p.endsWith('.ts')),
    suites: ['component'],
  },
  {
    label: 'Web page (component + smoke)',
    match: (p) =>
      p.startsWith('apps/web/app/') &&
      (p.endsWith('.tsx') || p.endsWith('.ts')),
    suites: ['component', 'smoke'],
  },
  {
    label: 'Manual SQL migration',
    match: (p) =>
      p.startsWith('apps/api/prisma/manual-migrations/') && p.endsWith('.sql'),
    suites: ['migration'],
  },
  {
    label: 'Test infra (re-run smoke)',
    match: (p) => p.startsWith('test/smoke/'),
    suites: ['smoke'],
  },
  {
    label: 'Test infra (re-run security)',
    match: (p) => p.startsWith('test/security/'),
    suites: ['security'],
  },
  {
    label: 'Test infra (re-run contract)',
    match: (p) => p.startsWith('test/contract/'),
    suites: ['contract'],
  },
];

export function startWatch() {
  console.log('Watching for changes (debounce 500ms)…');
  console.log(`Repo root: ${REPO_ROOT}`);

  const pending = new Set<string>();
  let timer: NodeJS.Timeout | null = null;

  const watcher = chokidar.watch(
    [
      'apps/api/src',
      'apps/web/app',
      'apps/web/components',
      'apps/api/prisma/manual-migrations',
      'test/smoke',
      'test/security',
      'test/contract',
      'test/migration',
      'test/performance',
    ].map((p) => join(REPO_ROOT, p)),
    {
      ignored: ['**/node_modules/**', '**/dist/**', '**/.next/**', '**/coverage/**'],
      persistent: true,
      ignoreInitial: true,
    },
  );

  const trigger = () => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(async () => {
      const changed = [...pending];
      pending.clear();

      const suiteIds = new Set<string>();
      const labels = new Set<string>();

      for (const abs of changed) {
        const rel = relative(REPO_ROOT, abs);
        for (const m of MAPPINGS) {
          if (m.match(rel)) {
            m.suites.forEach((s) => suiteIds.add(s));
            labels.add(m.label);
          }
        }
      }

      if (suiteIds.size === 0) return;

      console.log(
        `\n[watch] ${changed.length} file(s) changed -> running [${[...suiteIds].join(
          ', ',
        )}] (matched: ${[...labels].join('; ')})`,
      );
      try {
        await runSuites([...suiteIds], { regenerateDashboard: true });
      } catch (e) {
        console.error('[watch] suite run failed:', (e as Error).message);
      }
    }, DEBOUNCE_MS);
  };

  watcher.on('add', (p) => {
    pending.add(p);
    trigger();
  });
  watcher.on('change', (p) => {
    pending.add(p);
    trigger();
  });

  process.on('SIGINT', async () => {
    console.log('\nStopping watcher…');
    await watcher.close();
    process.exit(0);
  });
}
