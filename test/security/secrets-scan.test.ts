import { describe, it, expect } from 'vitest';
import { execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

const REPO_ROOT = process.env.REPO_ROOT || '/home/marios/Documents/Project/saas-crm';

interface Pattern {
  name: string;
  regex: RegExp;
  /** Optional second-pass filter (e.g. minimum length / format check). */
  validate?: (match: string) => boolean;
}

const PATTERNS: Pattern[] = [
  // JWT (eyJ...): three base64 segments separated by dots, ≥ ~100 chars total
  {
    name: 'JWT token (eyJ...)',
    regex: /eyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/g,
  },
  {
    name: 'GitHub Personal Access Token',
    regex: /\bgh[opsu]_[A-Za-z0-9]{30,}\b/g,
  },
  {
    name: 'AWS Access Key ID',
    regex: /\bAKIA[0-9A-Z]{16}\b/g,
  },
  {
    name: 'Slack token',
    regex: /\bxox[abp]-[A-Za-z0-9-]{20,}\b/g,
  },
  {
    name: '64-char hex sequence (likely secret)',
    regex: /\b[a-f0-9]{64}\b/gi,
    validate: (m) => /[a-f]/.test(m) && /[0-9]/.test(m),
  },
  {
    name: 'Hardcoded password assignment',
    regex: /\b(password|passwd|pwd)\s*[:=]\s*["'][^"'\s]{8,}["']/gi,
  },
];

const ALLOWED_PATHS = [
  /\.env(\.|$)/, // .env, .env.example, .env.local etc
  /\/dist\//,
  /\/node_modules\//,
  /\/\.git\//,
  /\/\.next\//,
  /pnpm-lock\.yaml$/,
  /package-lock\.json$/,
  /\.lock$/,
  /test\/security\/secrets-scan\.test\.ts$/, // this file contains the patterns
  /test\/security\/.*\.snap$/,
  // Test files contain fixture credentials, bcrypt hashes, and synthetic 64-hex
  // keys for deterministic crypto tests — they are NOT real secrets.
  /\.spec\.ts$/,
  /\.test\.tsx?$/,
  /\/test\//,
  /\/__tests__\//,
  /test-fixtures\//,
  /test-setup\.ts$/,
  // Build / cache artifacts — content hashes, not secrets.
  /\.tsbuildinfo$/,
  /\.next\//,
  /\.turbo\//,
  /\.cache\//,
  /coverage\//,
];

interface Finding {
  pattern: string;
  file: string;
  match: string;
}

function isAllowed(path: string): boolean {
  return ALLOWED_PATHS.some((re) => re.test(path));
}

function listFiles(): string[] {
  // Use git ls-files to get tracked + untracked-but-not-ignored files.
  try {
    const out = execSync(
      'git -C "$REPO" ls-files --cached --others --exclude-standard',
      {
        env: { ...process.env, REPO: REPO_ROOT },
        stdio: ['ignore', 'pipe', 'ignore'],
      },
    ).toString();
    return out.split('\n').filter(Boolean);
  } catch {
    // Fallback: find without listing huge dirs
    const out = execSync(
      `find "${REPO_ROOT}" -type f -not -path '*/node_modules/*' -not -path '*/.git/*' -not -path '*/dist/*' -not -path '*/.next/*' -size -1M`,
      { stdio: ['ignore', 'pipe', 'ignore'] },
    ).toString();
    return out.split('\n').filter(Boolean).map((p) => p.replace(REPO_ROOT + '/', ''));
  }
}

describe('Security: secret scan', () => {
  it('no high-confidence secrets in tracked source files', () => {
    const files = listFiles();
    const findings: Finding[] = [];

    for (const rel of files) {
      if (isAllowed(rel)) continue;
      // Skip large/binary by extension shortcut
      if (/\.(png|jpe?g|gif|pdf|zip|tar|gz|woff2?|ttf|otf|ico|mp4|wav)$/i.test(rel)) continue;

      let content: string;
      try {
        content = readFileSync(`${REPO_ROOT}/${rel}`, 'utf8');
      } catch {
        continue;
      }
      // Skip files > 500 KB
      if (content.length > 500_000) continue;

      for (const p of PATTERNS) {
        const matches = content.match(p.regex);
        if (!matches) continue;
        for (const m of matches) {
          if (p.validate && !p.validate(m)) continue;
          findings.push({ pattern: p.name, file: rel, match: m.slice(0, 60) + (m.length > 60 ? '…' : '') });
        }
      }
    }

    if (findings.length > 0) {
      const summary = findings
        .slice(0, 20)
        .map((f) => `  ${f.pattern} in ${f.file}: ${f.match}`)
        .join('\n');
      throw new Error(
        `Found ${findings.length} potential secret(s):\n${summary}${findings.length > 20 ? '\n  …(truncated)' : ''}`,
      );
    }
    expect(findings.length).toBe(0);
  });
});
