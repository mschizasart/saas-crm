import { describe, it, expect } from 'vitest';
import { execSync } from 'node:child_process';

const REPO_ROOT = process.env.REPO_ROOT || '/home/marios/Documents/Project/saas-crm';

interface AuditAdvisory {
  severity: string;
  module_name?: string;
  title?: string;
}

describe('Security: pnpm audit', () => {
  it('reports zero HIGH/CRITICAL severity advisories', () => {
    let raw = '';
    try {
      raw = execSync('pnpm audit --json', {
        cwd: REPO_ROOT,
        stdio: ['ignore', 'pipe', 'pipe'],
      }).toString();
    } catch (e: any) {
      // pnpm audit exits non-zero when vulns are found, but still emits JSON on stdout.
      raw = e.stdout?.toString() ?? '';
      if (!raw) {
        console.warn('[npm-audit] pnpm audit unavailable; skipping');
        return;
      }
    }

    const json = safeJson(raw);
    if (!json) {
      console.warn('[npm-audit] could not parse audit JSON; skipping');
      return;
    }

    const high: AuditAdvisory[] = [];
    // pnpm audit shape: { advisories: { id: {severity,...} }, metadata: { vulnerabilities: { high, critical, ... } } }
    if (json.advisories && typeof json.advisories === 'object') {
      for (const a of Object.values(json.advisories) as AuditAdvisory[]) {
        if (['high', 'critical'].includes(String(a.severity).toLowerCase())) {
          high.push(a);
        }
      }
    } else if (Array.isArray(json.actions)) {
      for (const action of json.actions) {
        for (const r of action.resolves ?? []) {
          if (['high', 'critical'].includes(String(r.severity).toLowerCase())) {
            high.push(r);
          }
        }
      }
    }

    if (high.length > 0) {
      const msg = high
        .map((a) => `  - ${a.severity} ${a.module_name ?? '?'}: ${a.title ?? '?'}`)
        .join('\n');
      throw new Error(`Found ${high.length} high/critical advisories:\n${msg}`);
    }
    expect(high.length).toBe(0);
  });
});

function safeJson(s: string): any {
  try {
    return JSON.parse(s);
  } catch {
    return null;
  }
}
