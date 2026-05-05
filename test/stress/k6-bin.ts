/**
 * One-shot k6 installer.
 *
 * Downloads a static k6 binary into test/stress/.bin/k6 if absent. Linux
 * x86_64 only — for any other platform we bail with a clear error so the
 * caller can skip the k6-flavoured scenarios and (where possible) fall
 * back to the plain Node + autocannon path.
 *
 * No package-manager step, no sudo, no PATH pollution. The artefact lives
 * under test/stress/.bin/ which is gitignored.
 */
import { existsSync, mkdirSync, chmodSync, createWriteStream, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import { pipeline } from 'node:stream/promises';
import { tmpdir } from 'node:os';
import { Readable } from 'node:stream';
import { STRESS_BIN_DIR } from './setup.js';

// Pin a known-good version. Bump explicitly when needed.
const K6_VERSION = process.env.K6_VERSION ?? '0.54.0';

export interface K6Bin {
  path: string;
  version: string;
}

/** Resolve the k6 binary path; install once if missing. */
export async function ensureK6(): Promise<K6Bin | null> {
  // 0. respect a system-installed k6
  const onPath = await whichK6();
  if (onPath) return { path: onPath, version: 'system' };

  mkdirSync(STRESS_BIN_DIR, { recursive: true });
  const binPath = join(STRESS_BIN_DIR, 'k6');

  if (existsSync(binPath)) return { path: binPath, version: K6_VERSION };

  if (process.platform !== 'linux' || process.arch !== 'x64') {
    // Best-effort: tell the caller, who can decide to skip.
    console.warn(
      `[k6-bin] No prebuilt download mapped for ${process.platform}/${process.arch}. ` +
        'Install k6 manually or use the autocannon fallback.',
    );
    return null;
  }

  const url = `https://github.com/grafana/k6/releases/download/v${K6_VERSION}/k6-v${K6_VERSION}-linux-amd64.tar.gz`;
  console.log(`[k6-bin] Downloading k6 v${K6_VERSION} from ${url}…`);

  try {
    const tarPath = join(tmpdir(), `k6-${K6_VERSION}.tar.gz`);
    await downloadTo(url, tarPath);
    await extractK6(tarPath, STRESS_BIN_DIR);
    if (!existsSync(binPath)) {
      throw new Error(
        `k6 archive extracted, but ${binPath} not present afterwards.`,
      );
    }
    chmodSync(binPath, 0o755);
    return { path: binPath, version: K6_VERSION };
  } catch (e) {
    console.error(`[k6-bin] Install failed: ${(e as Error).message}`);
    return null;
  }
}

async function whichK6(): Promise<string | null> {
  return new Promise((resolve) => {
    const child = spawn('which', ['k6'], { stdio: ['ignore', 'pipe', 'ignore'] });
    let out = '';
    child.stdout.on('data', (d) => (out += d.toString()));
    child.on('close', (code) => {
      const trimmed = out.trim();
      if (code === 0 && trimmed) resolve(trimmed);
      else resolve(null);
    });
    child.on('error', () => resolve(null));
  });
}

async function downloadTo(url: string, dest: string): Promise<void> {
  // Follow redirects (GitHub releases issue 302 to objects.githubusercontent.com)
  let currentUrl = url;
  for (let hop = 0; hop < 5; hop++) {
    const res = await fetch(currentUrl, { redirect: 'manual' });
    if (res.status >= 300 && res.status < 400) {
      const next = res.headers.get('location');
      if (!next) throw new Error(`Redirect without Location at ${currentUrl}`);
      currentUrl = next;
      continue;
    }
    if (!res.ok || !res.body) {
      throw new Error(`HTTP ${res.status} fetching ${currentUrl}`);
    }
    await pipeline(
      Readable.fromWeb(res.body as any),
      createWriteStream(dest),
    );
    return;
  }
  throw new Error(`Too many redirects starting at ${url}`);
}

async function extractK6(tarPath: string, destDir: string): Promise<void> {
  // Use system tar — every Linux box has it. The archive layout is
  //   k6-v0.54.0-linux-amd64/k6
  // We extract just the inner "k6" file, stripped of its top dir, into destDir.
  await new Promise<void>((resolve, reject) => {
    const child = spawn(
      'tar',
      ['-xzf', tarPath, '-C', destDir, '--strip-components=1', '--wildcards', '*/k6'],
      { stdio: 'ignore' },
    );
    child.on('close', (code) =>
      code === 0 ? resolve() : reject(new Error(`tar exited ${code}`)),
    );
    child.on('error', reject);
  });
}

/**
 * Run a k6 script against STRESS_API_URL with the supplied env. Streams
 * stdout/stderr to console, returns the parsed JSON summary if the script
 * passed `--summary-export` via the `summaryFile` option (recommended).
 */
export async function runK6Script(
  scriptPath: string,
  options: {
    env?: Record<string, string>;
    summaryFile?: string;
    extraArgs?: string[];
  } = {},
): Promise<{ exitCode: number; summary?: any }> {
  const k6 = await ensureK6();
  if (!k6) {
    throw new Error(
      'k6 not available. Either install it system-wide or run on linux-x64 ' +
        'so the test/stress/.bin/k6 download path can succeed.',
    );
  }

  const args = ['run'];
  if (options.summaryFile) {
    args.push('--summary-export', options.summaryFile);
  }
  if (options.extraArgs) args.push(...options.extraArgs);
  args.push(scriptPath);

  return new Promise((resolve) => {
    const child = spawn(k6.path, args, {
      stdio: 'inherit',
      env: { ...process.env, ...(options.env ?? {}) },
    });
    child.on('close', (code) => {
      let summary: any | undefined;
      if (options.summaryFile && existsSync(options.summaryFile)) {
        try {
          summary = JSON.parse(readFileSync(options.summaryFile, 'utf8'));
        } catch {
          /* ignore */
        }
      }
      resolve({ exitCode: code ?? 1, summary });
    });
    child.on('error', () => resolve({ exitCode: 1 }));
  });
}
