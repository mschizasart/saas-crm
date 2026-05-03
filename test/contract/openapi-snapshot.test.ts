import { describe, it, expect } from 'vitest';
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { API_URL, withTimeout } from '../smoke/config.js';

const REPO_ROOT = process.env.REPO_ROOT || '/home/marios/Documents/Project/saas-crm';
const SNAPSHOT_PATH = join(REPO_ROOT, 'test/contract/__snapshots__/openapi.json');

const CANDIDATE_PATHS = [
  '/api/docs-json',
  '/api/docs/json',
  '/api/v1/swagger',
  '/api/swagger',
  '/api/swagger-json',
];

async function fetchOpenApi(): Promise<any | null> {
  for (const p of CANDIDATE_PATHS) {
    try {
      const res = await withTimeout(fetch(`${API_URL}${p}`));
      if (res.status === 200) {
        const j = await res.json();
        if (j && (j.openapi || j.swagger || j.paths)) return j;
      }
    } catch {
      // try next
    }
  }
  return null;
}

/**
 * Reduce the OpenAPI document to a stable shape so trivial reorderings or
 * server-list changes don't blow up the snapshot. We keep:
 *   - the list of paths
 *   - per-path: methods + parameter names + request/response media-types and refs.
 */
function projectShape(doc: any): any {
  const out: Record<string, any> = {};
  const paths = doc.paths || {};
  for (const p of Object.keys(paths).sort()) {
    const ops: Record<string, any> = {};
    for (const m of Object.keys(paths[p]).sort()) {
      const op = paths[p][m] || {};
      ops[m] = {
        params: (op.parameters || []).map((x: any) => x.name).sort(),
        requestContentTypes: Object.keys(op.requestBody?.content || {}).sort(),
        responses: Object.fromEntries(
          Object.entries(op.responses || {}).map(([code, r]: any) => [
            code,
            { contentTypes: Object.keys(r.content || {}).sort() },
          ]),
        ),
      };
    }
    out[p] = ops;
  }
  return out;
}

describe('Contract: OpenAPI snapshot', () => {
  it('matches stored snapshot (run with UPDATE_SNAPSHOTS=1 to refresh)', async () => {
    const doc = await fetchOpenApi();
    if (!doc) {
      console.warn(
        '[openapi] Could not fetch /api/docs-json (API down or non-dev mode). Skipping.',
      );
      return;
    }
    const shape = projectShape(doc);

    if (!existsSync(SNAPSHOT_PATH) || process.env.UPDATE_SNAPSHOTS === '1') {
      mkdirSync(dirname(SNAPSHOT_PATH), { recursive: true });
      writeFileSync(SNAPSHOT_PATH, JSON.stringify(shape, null, 2));
      console.log(`[openapi] snapshot written at ${SNAPSHOT_PATH}`);
      expect(true).toBe(true);
      return;
    }

    const stored = JSON.parse(readFileSync(SNAPSHOT_PATH, 'utf8'));
    const drifted = diff(stored, shape);
    if (drifted.length > 0) {
      const preview = drifted.slice(0, 30).join('\n');
      throw new Error(
        `OpenAPI shape drift (${drifted.length} difference${drifted.length === 1 ? '' : 's'}):\n${preview}${
          drifted.length > 30 ? '\n…(truncated)' : ''
        }\nIf intentional: rerun with UPDATE_SNAPSHOTS=1.`,
      );
    }
    expect(drifted).toEqual([]);
  });
});

function diff(a: any, b: any, path = ''): string[] {
  const out: string[] = [];
  const keys = new Set([...Object.keys(a ?? {}), ...Object.keys(b ?? {})]);
  for (const k of keys) {
    const sub = path ? `${path}.${k}` : k;
    const av = a?.[k];
    const bv = b?.[k];
    if (typeof av !== typeof bv) {
      out.push(`type-change ${sub}: ${typeof av} -> ${typeof bv}`);
    } else if (Array.isArray(av) || Array.isArray(bv)) {
      if (JSON.stringify(av) !== JSON.stringify(bv)) {
        out.push(`array-change ${sub}: ${JSON.stringify(av)} != ${JSON.stringify(bv)}`);
      }
    } else if (typeof av === 'object' && av !== null) {
      out.push(...diff(av, bv, sub));
    } else if (av !== bv) {
      out.push(`scalar ${sub}: ${av} -> ${bv}`);
    }
  }
  return out;
}
