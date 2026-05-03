import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { execSync } from 'node:child_process';
import type { SuiteRunSummary } from './parsers.js';
import { REPO_ROOT } from './suites.js';

interface DashboardPayload {
  generatedAt: string;
  gitCommit: string;
  totals: {
    total: number;
    passed: number;
    failed: number;
    skipped: number;
    durationMs: number;
  };
  coverage: { app: string; pct: number | null }[];
  suites: SuiteRunSummary[];
}

export function generateDashboard(summaries: SuiteRunSummary[]): string {
  const totals = summaries.reduce(
    (acc, s) => {
      acc.total += s.total;
      acc.passed += s.passed;
      acc.failed += s.failed;
      acc.skipped += s.skipped;
      acc.durationMs += s.durationMs;
      return acc;
    },
    { total: 0, passed: 0, failed: 0, skipped: 0, durationMs: 0 },
  );

  const payload: DashboardPayload = {
    generatedAt: new Date().toISOString(),
    gitCommit: safeGitHash(),
    totals,
    coverage: readCoverage(),
    suites: summaries,
  };

  const tplPath = join(REPO_ROOT, 'test/dashboard/template.html');
  let template: string;
  if (existsSync(tplPath)) {
    template = readFileSync(tplPath, 'utf8');
  } else {
    template = '<!doctype html><html><body><pre id="payload"></pre><script>document.getElementById("payload").textContent=JSON.stringify(window.__REPORT__,null,2);</script></body></html>';
  }

  // Escape `</` so a stack trace containing `</script>` can't break out of the
  // surrounding inline <script> tag in the HTML template.
  const safeJson = JSON.stringify(payload).replace(/<\//g, '<\\/');
  const html = template.replace('/*__INJECT_PAYLOAD__*/', safeJson);

  const outPath = join(REPO_ROOT, 'test/dashboard/report.html');
  mkdirSync(dirname(outPath), { recursive: true });
  writeFileSync(outPath, html);
  return outPath;
}

function safeGitHash(): string {
  try {
    return execSync('git rev-parse --short HEAD', {
      cwd: REPO_ROOT,
      stdio: ['ignore', 'pipe', 'ignore'],
    })
      .toString()
      .trim();
  } catch {
    return 'unknown';
  }
}

function readCoverage(): { app: string; pct: number | null }[] {
  const candidates = [
    { app: 'api', path: join(REPO_ROOT, 'apps/api/coverage/coverage-summary.json') },
    { app: 'web', path: join(REPO_ROOT, 'apps/web/coverage/coverage-summary.json') },
  ];
  return candidates.map((c) => {
    if (!existsSync(c.path)) return { app: c.app, pct: null };
    try {
      const j = JSON.parse(readFileSync(c.path, 'utf8'));
      const pct = j.total?.statements?.pct ?? j.total?.lines?.pct ?? null;
      return { app: c.app, pct: typeof pct === 'number' ? pct : null };
    } catch {
      return { app: c.app, pct: null };
    }
  });
}
