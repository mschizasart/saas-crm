'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { DetailPageLayout } from '@/components/layouts/detail-page-layout';
import { AccountHierarchyTile } from '@/components/account-hierarchy-tile';

// ─── Hierarchy page (Wave F1) ──────────────────────────────────
//
// Renders the subtree rooted at the current client as a nested,
// indented list. Each node shows its company name and a small
// rollup tile so reps can see "is this branch material?" at a
// glance. Click a node to jump to that client's detail page.

interface HierarchyNode {
  id: string;
  name: string;
  company: string;
  parentClientId: string | null;
  depth: number;
}

interface RollupBlock {
  invoiceTotal: number;
  openInvoiceCount: number;
  leadCount: number;
  openOpportunityCount: number;
  openOpportunityAmount: number;
}

interface RollupResult {
  rootClientId: string;
  selfMetrics: RollupBlock;
  descendantMetrics: RollupBlock;
  combinedMetrics: RollupBlock;
  descendantCount: number;
}

const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001';

function getToken(): string | null {
  if (typeof window === 'undefined') return null;
  return localStorage.getItem('access_token');
}

function authHeaders(): HeadersInit {
  return {
    Authorization: `Bearer ${getToken()}`,
    'Content-Type': 'application/json',
  };
}

// Re-nest the flat depth-annotated list into a tree.
type TreeNode = HierarchyNode & { children: TreeNode[] };

function buildTree(flat: HierarchyNode[]): TreeNode | null {
  if (flat.length === 0) return null;
  const byId = new Map<string, TreeNode>();
  for (const n of flat) byId.set(n.id, { ...n, children: [] });

  let root: TreeNode | null = null;
  for (const n of flat) {
    const node = byId.get(n.id)!;
    if (n.depth === 0) {
      // The root of THIS query — there should be exactly one.
      root = node;
    } else if (n.parentClientId && byId.has(n.parentClientId)) {
      byId.get(n.parentClientId)!.children.push(node);
    }
  }
  return root;
}

// Inline mini-rollup so we don't fire one fetch per node — the
// API has a per-client rollup, and we only want one for the root.
// Children just show their name; if a rep wants a deep rollup they
// can click into the child.
function NodeRow({
  node,
  isRoot,
}: {
  node: TreeNode;
  isRoot: boolean;
}) {
  return (
    <li className="mt-2">
      <div
        className={[
          'flex items-center gap-3 px-3 py-2 rounded-lg border',
          isRoot
            ? 'bg-primary/5 border-primary/20'
            : 'bg-white dark:bg-gray-900 border-gray-100 dark:border-gray-800',
        ].join(' ')}
      >
        <span className="text-xs font-mono text-gray-400 w-6 text-right">
          L{node.depth}
        </span>
        <Link
          href={`/clients/${node.id}`}
          className="font-medium text-gray-900 dark:text-gray-100 hover:text-primary truncate"
        >
          {node.company}
        </Link>
        {!isRoot && (
          <Link
            href={`/clients/${node.id}/hierarchy`}
            className="ml-auto text-xs text-gray-400 hover:text-primary"
          >
            View subtree →
          </Link>
        )}
      </div>
      {node.children.length > 0 && (
        <ul className="ml-6 border-l border-gray-100 dark:border-gray-800 pl-3">
          {node.children
            .slice()
            .sort((a, b) => a.company.localeCompare(b.company))
            .map((c) => (
              <NodeRow key={c.id} node={c} isRoot={false} />
            ))}
        </ul>
      )}
    </li>
  );
}

export default function ClientHierarchyPage() {
  const params = useParams();
  const id = String((params as any)?.id ?? '');

  const [tree, setTree] = useState<TreeNode | null>(null);
  const [ancestors, setAncestors] = useState<HierarchyNode[]>([]);
  const [rollup, setRollup] = useState<RollupResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!id) return;
    let cancelled = false;
    setLoading(true);
    setError(null);

    Promise.all([
      fetch(`${API_BASE}/api/v1/clients/${id}/hierarchy`, {
        headers: authHeaders(),
      }).then(async (r) => {
        if (!r.ok) throw new Error(`hierarchy: HTTP ${r.status}`);
        return r.json() as Promise<HierarchyNode[]>;
      }),
      fetch(`${API_BASE}/api/v1/clients/${id}/ancestors`, {
        headers: authHeaders(),
      }).then(async (r) => {
        if (!r.ok) throw new Error(`ancestors: HTTP ${r.status}`);
        return r.json() as Promise<HierarchyNode[]>;
      }),
      fetch(`${API_BASE}/api/v1/clients/${id}/rollup`, {
        headers: authHeaders(),
      }).then(async (r) => {
        if (!r.ok) throw new Error(`rollup: HTTP ${r.status}`);
        return r.json() as Promise<RollupResult>;
      }),
    ])
      .then(([flat, anc, r]) => {
        if (cancelled) return;
        setTree(buildTree(flat));
        setAncestors(anc);
        setRollup(r);
      })
      .catch((e) => {
        if (!cancelled) setError(e?.message ?? 'Failed to load hierarchy');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [id]);

  const title = tree?.company ?? 'Hierarchy';

  return (
    <DetailPageLayout
      title={`Hierarchy: ${title}`}
      breadcrumbs={[
        { label: 'Clients', href: '/clients' },
        { label: title, href: `/clients/${id}` },
        { label: 'Hierarchy' },
      ]}
    >
      {error && (
        <div className="mb-4 px-3 py-2 bg-red-50 border border-red-100 text-red-600 text-sm rounded-lg">
          {error}
        </div>
      )}

      {loading ? (
        <div className="space-y-4">
          <div className="h-24 bg-gray-100 dark:bg-gray-800 rounded-xl animate-pulse" />
          <div className="h-48 bg-gray-100 dark:bg-gray-800 rounded-xl animate-pulse" />
        </div>
      ) : (
        <div className="space-y-6">
          {/* Rollup tiles */}
          <AccountHierarchyTile clientId={id} />

          {/* Ancestor breadcrumb (collapsed if there are none) */}
          {ancestors.length > 0 && (
            <div className="bg-white dark:bg-gray-900 rounded-xl border border-gray-100 dark:border-gray-800 shadow-sm p-4">
              <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-2">
                Ancestors
              </p>
              <div className="flex flex-wrap items-center gap-2 text-sm">
                {ancestors.map((a, i) => (
                  <span key={a.id} className="flex items-center gap-2">
                    <Link
                      href={`/clients/${a.id}`}
                      className="text-primary hover:underline"
                    >
                      {a.company}
                    </Link>
                    {i < ancestors.length - 1 && (
                      <span className="text-gray-300">›</span>
                    )}
                  </span>
                ))}
                <span className="text-gray-300">›</span>
                <span className="font-medium text-gray-900 dark:text-gray-100">
                  {tree?.company ?? '…'}
                </span>
              </div>
            </div>
          )}

          {/* Subtree */}
          <div className="bg-white dark:bg-gray-900 rounded-xl border border-gray-100 dark:border-gray-800 shadow-sm p-6">
            <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-300 mb-3">
              Subtree
            </h3>
            {tree ? (
              <ul>
                <NodeRow node={tree} isRoot />
              </ul>
            ) : (
              <p className="text-sm text-gray-400">
                No subtree found for this client.
              </p>
            )}
            {tree && tree.children.length === 0 && (
              <p className="mt-4 text-xs text-gray-400">
                This account has no child clients yet. Use the API
                (<code className="font-mono">POST /clients/:id/set-parent</code>)
                to attach a subsidiary.
              </p>
            )}
            {rollup && rollup.descendantCount === 0 && (
              <p className="mt-2 text-xs text-gray-400">
                Rollup shown above is self-only (no descendants).
              </p>
            )}
          </div>
        </div>
      )}
    </DetailPageLayout>
  );
}
