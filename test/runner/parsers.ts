import { readFileSync, existsSync } from 'node:fs';

/**
 * Unified result schema. Every parser normalises into this so the dashboard
 * doesn't need to care which framework produced the data.
 */
export interface NormalizedTestResult {
  suite: string;
  category: string;
  file: string;
  name: string;
  status: 'passed' | 'failed' | 'skipped' | 'pending';
  duration: number; // ms
  error?: { message: string; stack?: string };
}

export interface SuiteRunSummary {
  suiteId: string;
  category: string;
  label: string;
  startedAt: string;
  finishedAt: string;
  durationMs: number;
  total: number;
  passed: number;
  failed: number;
  skipped: number;
  exitCode: number;
  tests: NormalizedTestResult[];
  /** Optional free-form payload for non-test categories (e.g. autocannon). */
  extra?: Record<string, unknown>;
  /** True when the parser had no JSON to read (suite skipped or never ran). */
  missing?: boolean;
}

// ─── Vitest ──────────────────────────────────────────────────────────
export function parseVitest(
  jsonPath: string,
  suiteId: string,
  category: string,
  label: string,
): SuiteRunSummary {
  const empty = emptySummary(suiteId, category, label, jsonPath);
  if (!existsSync(jsonPath)) return { ...empty, missing: true };

  let raw: any;
  try {
    raw = JSON.parse(readFileSync(jsonPath, 'utf8'));
  } catch (e) {
    return {
      ...empty,
      missing: true,
      tests: [
        {
          suite: suiteId,
          category,
          file: jsonPath,
          name: 'Could not parse vitest JSON',
          status: 'failed',
          duration: 0,
          error: { message: (e as Error).message },
        },
      ],
      total: 1,
      failed: 1,
    };
  }

  const tests: NormalizedTestResult[] = [];
  for (const r of raw.testResults ?? []) {
    for (const a of r.assertionResults ?? []) {
      tests.push({
        suite: suiteId,
        category,
        file: r.name ?? r.testFilePath ?? 'unknown',
        name: a.fullName ?? a.title ?? 'unnamed',
        status: mapStatus(a.status),
        duration: a.duration ?? 0,
        error: a.failureMessages?.length
          ? { message: stripAnsi(a.failureMessages.join('\n')) }
          : undefined,
      });
    }
  }
  return summarise(empty, tests, raw.startTime, raw.endTime);
}

// ─── Jest (same JSON shape as vitest) ────────────────────────────────
export const parseJest = parseVitest;

// ─── Playwright JSON reporter ────────────────────────────────────────
export function parsePlaywright(
  jsonPath: string,
  suiteId: string,
  category: string,
  label: string,
): SuiteRunSummary {
  const empty = emptySummary(suiteId, category, label, jsonPath);
  if (!existsSync(jsonPath)) return { ...empty, missing: true };
  let raw: any;
  try {
    raw = JSON.parse(readFileSync(jsonPath, 'utf8'));
  } catch (e) {
    return { ...empty, missing: true };
  }
  const tests: NormalizedTestResult[] = [];
  const walk = (suiteNode: any, file: string) => {
    for (const sp of suiteNode.specs ?? []) {
      for (const t of sp.tests ?? []) {
        const result = t.results?.[t.results.length - 1] ?? {};
        tests.push({
          suite: suiteId,
          category,
          file,
          name: sp.title,
          status: mapStatus(result.status),
          duration: result.duration ?? 0,
          error: result.error
            ? {
                message: stripAnsi(result.error.message ?? ''),
                stack: result.error.stack,
              }
            : undefined,
        });
      }
    }
    for (const child of suiteNode.suites ?? []) walk(child, file);
  };
  for (const s of raw.suites ?? []) {
    walk(s, s.file ?? 'unknown');
  }
  return summarise(empty, tests, raw.stats?.startTime, undefined);
}

// ─── Autocannon (custom: we drop a JSON ourselves in performance/) ───
export function parseAutocannon(
  jsonPath: string,
  suiteId: string,
  category: string,
  label: string,
): SuiteRunSummary {
  const empty = emptySummary(suiteId, category, label, jsonPath);
  if (!existsSync(jsonPath)) return { ...empty, missing: true };
  let raw: any;
  try {
    raw = JSON.parse(readFileSync(jsonPath, 'utf8'));
  } catch {
    return { ...empty, missing: true };
  }
  const tests: NormalizedTestResult[] = (raw.results ?? []).map((r: any) => ({
    suite: suiteId,
    category,
    file: r.url ?? 'performance',
    name: r.name ?? r.url ?? 'load test',
    status: r.passed ? 'passed' : 'failed',
    duration: r.durationMs ?? 0,
    error: r.passed
      ? undefined
      : {
          message: r.failure ?? `p95 ${r.p95}ms exceeded threshold ${r.threshold}ms`,
        },
  }));
  return {
    ...summarise(empty, tests),
    extra: raw,
  };
}

// ─── Plain (script that exits 0/non-zero, no JSON) ───────────────────
export function parsePlain(
  _jsonPath: string,
  suiteId: string,
  category: string,
  label: string,
  exitCode = 0,
): SuiteRunSummary {
  const empty = emptySummary(suiteId, category, label, _jsonPath);
  const passed = exitCode === 0;
  const tests: NormalizedTestResult[] = [
    {
      suite: suiteId,
      category,
      file: 'plain-script',
      name: label,
      status: passed ? 'passed' : 'failed',
      duration: 0,
      error: passed ? undefined : { message: `Exit code ${exitCode}` },
    },
  ];
  return summarise(empty, tests);
}

// ─── helpers ─────────────────────────────────────────────────────────
function mapStatus(s: any): NormalizedTestResult['status'] {
  if (!s) return 'pending';
  const v = String(s).toLowerCase();
  if (v === 'passed' || v === 'success' || v === 'expected') return 'passed';
  if (v === 'failed' || v === 'failure' || v === 'unexpected') return 'failed';
  if (v === 'skipped' || v === 'pending' || v === 'todo') return 'skipped';
  return 'pending';
}

function emptySummary(
  suiteId: string,
  category: string,
  label: string,
  _jsonPath: string,
): SuiteRunSummary {
  return {
    suiteId,
    category,
    label,
    startedAt: new Date().toISOString(),
    finishedAt: new Date().toISOString(),
    durationMs: 0,
    total: 0,
    passed: 0,
    failed: 0,
    skipped: 0,
    exitCode: 0,
    tests: [],
  };
}

function summarise(
  base: SuiteRunSummary,
  tests: NormalizedTestResult[],
  start?: number | string,
  end?: number | string,
): SuiteRunSummary {
  const total = tests.length;
  const passed = tests.filter((t) => t.status === 'passed').length;
  const failed = tests.filter((t) => t.status === 'failed').length;
  const skipped = tests.filter(
    (t) => t.status === 'skipped' || t.status === 'pending',
  ).length;
  const startedAt = toIso(start) ?? base.startedAt;
  const finishedAt = toIso(end) ?? new Date().toISOString();
  return {
    ...base,
    tests,
    total,
    passed,
    failed,
    skipped,
    startedAt,
    finishedAt,
    durationMs: tests.reduce((acc, t) => acc + (t.duration || 0), 0),
  };
}

function toIso(v: number | string | undefined): string | undefined {
  if (v === undefined) return undefined;
  if (typeof v === 'number') return new Date(v).toISOString();
  const d = new Date(v);
  return isNaN(d.getTime()) ? undefined : d.toISOString();
}

function stripAnsi(s: string): string {
  // eslint-disable-next-line no-control-regex
  return s.replace(/\[[0-9;]*m/g, '');
}
