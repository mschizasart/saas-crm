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

// ─── Stryker (mutation testing) ──────────────────────────────────────
/**
 * Parses Stryker's mutation-testing JSON report (schema-version 1 / 2).
 *
 * Stryker's JSON shape (relevant parts):
 *   {
 *     schemaVersion: "1.0",
 *     thresholds: { high, low, break },
 *     files: {
 *       "src/.../foo.service.ts": {
 *         language: "typescript",
 *         source: "<full source>",
 *         mutants: [
 *           {
 *             id: "...",
 *             mutatorName: "ConditionalExpression",
 *             status: "Killed" | "Survived" | "NoCoverage" | "Timeout" |
 *                     "CompileError" | "RuntimeError" | "Ignored",
 *             location: { start: {line, column}, end: {...} },
 *             replacement: "..."
 *           }
 *         ]
 *       }
 *     }
 *   }
 *
 * We normalise this into the dashboard's pass/fail shape:
 *  - One "summary" test per mutated file: passed iff mutation score >= low
 *    threshold (default 60); name encodes the score; meta carries counts.
 *  - One failed test per survived/no-coverage mutant with file:line + the
 *    original->mutated source slice in the error message.
 *  - extra carries the overall mutation score, totals, thresholds, and a
 *    per-file table for the dashboard mutation tab.
 */
export function parseStryker(
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
          name: 'Could not parse Stryker JSON',
          status: 'failed',
          duration: 0,
          error: { message: (e as Error).message },
        },
      ],
      total: 1,
      failed: 1,
    };
  }

  const thresholds = raw.thresholds || { high: 80, low: 60, break: 50 };
  const files: Record<string, any> = raw.files ?? {};

  const tests: NormalizedTestResult[] = [];
  const perFile: Array<{
    file: string;
    score: number;
    killed: number;
    survived: number;
    timeout: number;
    noCoverage: number;
    runtimeError: number;
    compileError: number;
    ignored: number;
    totalCovered: number;
    totalValid: number;
    band: 'high' | 'low' | 'break' | 'na';
  }> = [];
  const survivedMutants: Array<{
    file: string;
    line: number;
    column: number;
    mutator: string;
    original: string;
    replacement: string;
    status: string;
  }> = [];

  let totalKilled = 0;
  let totalSurvived = 0;
  let totalTimeout = 0;
  let totalNoCoverage = 0;
  let totalRuntimeError = 0;
  let totalCompileError = 0;
  let totalIgnored = 0;

  for (const [filePath, fileData] of Object.entries(files)) {
    const mutants: any[] = fileData.mutants ?? [];
    const source: string = fileData.source ?? '';
    const sourceLines = source.split(/\r?\n/);

    let killed = 0;
    let survived = 0;
    let timeout = 0;
    let noCoverage = 0;
    let runtimeError = 0;
    let compileError = 0;
    let ignored = 0;

    for (const m of mutants) {
      switch ((m.status || '').toLowerCase()) {
        case 'killed':
          killed += 1;
          break;
        case 'survived':
          survived += 1;
          break;
        case 'timeout':
          timeout += 1;
          break;
        case 'nocoverage':
          noCoverage += 1;
          break;
        case 'runtimeerror':
          runtimeError += 1;
          break;
        case 'compileerror':
          compileError += 1;
          break;
        case 'ignored':
          ignored += 1;
          break;
      }
    }

    totalKilled += killed;
    totalSurvived += survived;
    totalTimeout += timeout;
    totalNoCoverage += noCoverage;
    totalRuntimeError += runtimeError;
    totalCompileError += compileError;
    totalIgnored += ignored;

    // Mutation score = killed+timeout / (killed+timeout+survived+noCoverage)
    // Compile/runtime errors and ignored mutants are excluded from the
    // denominator (they don't reflect test quality).
    const totalCovered = killed + timeout + survived;
    const totalValid = totalCovered + noCoverage;
    const score = totalValid === 0 ? 0 : ((killed + timeout) / totalValid) * 100;

    let band: 'high' | 'low' | 'break' | 'na' = 'na';
    if (totalValid === 0) band = 'na';
    else if (score >= (thresholds.high ?? 80)) band = 'high';
    else if (score >= (thresholds.low ?? 60)) band = 'low';
    else band = 'break';

    perFile.push({
      file: filePath,
      score: round2(score),
      killed,
      survived,
      timeout,
      noCoverage,
      runtimeError,
      compileError,
      ignored,
      totalCovered,
      totalValid,
      band,
    });

    // Summary "test" per file: passes if score >= low threshold (default 60).
    const filePasses = totalValid === 0 || score >= (thresholds.low ?? 60);
    tests.push({
      suite: suiteId,
      category,
      file: filePath,
      name: `mutation score ${round2(score)}% (killed ${killed} / survived ${survived} / no-cov ${noCoverage} / timeout ${timeout})`,
      status: filePasses ? 'passed' : 'failed',
      duration: 0,
      error: filePasses
        ? undefined
        : {
            message: `Mutation score ${round2(score)}% is below low threshold ${thresholds.low ?? 60}%. ${survived} survived + ${noCoverage} no-coverage mutants escaped the unit suite.`,
          },
    });

    // One failed test per surviving / no-coverage mutant.
    for (const m of mutants) {
      const status = (m.status || '').toLowerCase();
      if (status !== 'survived' && status !== 'nocoverage') continue;
      const line = m.location?.start?.line ?? 0;
      const column = m.location?.start?.column ?? 0;
      const original = sliceSource(sourceLines, m.location).slice(0, 200);
      const replacement = (m.replacement ?? '').slice(0, 200);
      survivedMutants.push({
        file: filePath,
        line,
        column,
        mutator: m.mutatorName ?? 'unknown',
        original,
        replacement,
        status: status === 'survived' ? 'Survived' : 'NoCoverage',
      });
      tests.push({
        suite: suiteId,
        category,
        file: filePath,
        name: `[${status === 'survived' ? 'Survived' : 'NoCoverage'}] ${m.mutatorName ?? 'mutation'} @ ${filePath}:${line}:${column}`,
        status: 'failed',
        duration: 0,
        error: {
          message: `original: ${original}\nmutated:  ${replacement}\nlocation: ${filePath}:${line}:${column}`,
        },
      });
    }
  }

  const totalCovered = totalKilled + totalTimeout + totalSurvived;
  const totalValid = totalCovered + totalNoCoverage;
  const overallScore =
    totalValid === 0 ? 0 : ((totalKilled + totalTimeout) / totalValid) * 100;

  // Sort perFile by score ascending so the worst offenders bubble up.
  perFile.sort((a, b) => a.score - b.score);

  const baseSummary = summarise(empty, tests);
  return {
    ...baseSummary,
    extra: {
      mutationScore: round2(overallScore),
      thresholds,
      totals: {
        killed: totalKilled,
        survived: totalSurvived,
        timeout: totalTimeout,
        noCoverage: totalNoCoverage,
        runtimeError: totalRuntimeError,
        compileError: totalCompileError,
        ignored: totalIgnored,
        totalCovered,
        totalValid,
        totalMutants:
          totalCovered +
          totalNoCoverage +
          totalRuntimeError +
          totalCompileError +
          totalIgnored,
      },
      perFile,
      survived: survivedMutants.slice(0, 200), // cap for dashboard payload
      htmlReportPath: 'test/.mutation/api/index.html',
    },
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

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/**
 * Extract the source slice covered by a Stryker mutant location. Stryker
 * uses 1-based line numbers and 0-based columns. We collapse to a single
 * line for the dashboard message.
 */
function sliceSource(
  lines: string[],
  loc:
    | {
        start?: { line?: number; column?: number };
        end?: { line?: number; column?: number };
      }
    | undefined,
): string {
  if (!loc?.start || !loc?.end) return '';
  const startLine = (loc.start.line ?? 1) - 1;
  const endLine = (loc.end.line ?? 1) - 1;
  const startCol = loc.start.column ?? 0;
  const endCol = loc.end.column ?? 0;
  if (startLine < 0 || startLine >= lines.length) return '';
  if (startLine === endLine) {
    return (lines[startLine] ?? '').slice(startCol, endCol);
  }
  const segs: string[] = [];
  segs.push((lines[startLine] ?? '').slice(startCol));
  for (let i = startLine + 1; i < endLine && i < lines.length; i++) {
    segs.push(lines[i] ?? '');
  }
  if (endLine < lines.length) {
    segs.push((lines[endLine] ?? '').slice(0, endCol));
  }
  return segs.join(' ').replace(/\s+/g, ' ').trim();
}

function stripAnsi(s: string): string {
  // eslint-disable-next-line no-control-regex
  return s.replace(/\[[0-9;]*m/g, '');
}
