'use client';

/**
 * Duplicates — Duplicate Detection + Record Merge feature.
 *
 * Two tabs (Leads / Clients), each fetching candidate duplicate pairs from
 * /api/v1/dedup/<entity>s/candidates and rendering one card per pair with the
 * two records side by side, matched fields highlighted, and the similarity
 * score as a badge. Each pair has a "Review & merge" action that opens the
 * shared MergeModal. A threshold control refetches at 0.6 / 0.7 / 0.8 / 0.9.
 */

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { Copy } from 'lucide-react';
import { ListPageLayout } from '@/components/layouts/list-page-layout';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import { ErrorBanner } from '@/components/ui/error-banner';
import {
  MergeModal,
  type MergeEntity,
  type LeadLite,
  type ClientLite,
  type RecordLite,
} from '@/components/ui/merge-modal';
import { apiFetch } from '@/lib/api';

// ─── Types ────────────────────────────────────────────────────────────

interface CandidatePair {
  score: number;
  matchedOn: string[];
  a: RecordLite;
  b: RecordLite;
}

interface CandidatesResponse {
  pairs: CandidatePair[];
}

type EntityTab = MergeEntity;

const THRESHOLDS = [0.6, 0.7, 0.8, 0.9];

// ─── Helpers ──────────────────────────────────────────────────────────

function scoreBadgeVariant(score: number): 'success' | 'warning' | 'info' {
  if (score >= 0.9) return 'success';
  if (score >= 0.75) return 'info';
  return 'warning';
}

function pairKey(entity: EntityTab, p: CandidatePair): string {
  return `${entity}:${p.a.id}:${p.b.id}`;
}

// ─── Record summary card (one side of a pair) ─────────────────────────

function RecordSummary({
  entity,
  rec,
  matchedOn,
}: {
  entity: EntityTab;
  rec: RecordLite;
  matchedOn: string[];
}) {
  const href = `/${entity}s/${rec.id}`;
  const title =
    entity === 'lead' ? (rec as LeadLite).name : (rec as ClientLite).company;

  // Field rows shown per entity. `key` matches the matchedOn field names so we
  // can highlight the rows the backend matched on.
  const rows: { key: string; label: string; value: string | null }[] =
    entity === 'lead'
      ? [
          { key: 'email', label: 'Email', value: (rec as LeadLite).email },
          { key: 'phone', label: 'Phone', value: (rec as LeadLite).phone },
          { key: 'company', label: 'Company', value: (rec as LeadLite).company },
        ]
      : [
          { key: 'email', label: 'Email', value: (rec as ClientLite).email },
          { key: 'phone', label: 'Phone', value: (rec as ClientLite).phone },
          { key: 'city', label: 'City', value: (rec as ClientLite).city },
        ];

  const matched = new Set(matchedOn);

  return (
    <div className="flex-1 min-w-0 border border-gray-100 dark:border-gray-800 rounded-lg p-3">
      <Link
        href={href}
        className="text-sm font-medium text-gray-900 dark:text-gray-100 hover:text-primary truncate block"
      >
        {title || '(untitled)'}
      </Link>
      <dl className="mt-2 space-y-1">
        {(entity === 'lead' && matched.has('name')) && (
          <div className="flex items-center gap-2 text-xs">
            <dt className="w-14 text-gray-400 dark:text-gray-500 flex-shrink-0">Name</dt>
            <dd className="bg-yellow-50 dark:bg-yellow-500/10 text-gray-800 dark:text-gray-200 px-1 rounded truncate">
              {title}
            </dd>
          </div>
        )}
        {rows.map((r) => {
          const isMatch = matched.has(r.key);
          return (
            <div key={r.key} className="flex items-center gap-2 text-xs">
              <dt className="w-14 text-gray-400 dark:text-gray-500 flex-shrink-0">{r.label}</dt>
              <dd
                className={`truncate ${
                  isMatch
                    ? 'bg-yellow-50 dark:bg-yellow-500/10 text-gray-800 dark:text-gray-200 px-1 rounded font-medium'
                    : 'text-gray-600 dark:text-gray-400'
                }`}
              >
                {r.value || <span className="text-gray-300 dark:text-gray-600">—</span>}
              </dd>
            </div>
          );
        })}
      </dl>
    </div>
  );
}

// ─── Tab panel ────────────────────────────────────────────────────────

function CandidatesPanel({ entity }: { entity: EntityTab }) {
  const [threshold, setThreshold] = useState(0.7);
  const [pairs, setPairs] = useState<CandidatePair[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [active, setActive] = useState<CandidatePair | null>(null);

  const fetchCandidates = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({
        threshold: String(threshold),
        limit: '50',
      });
      const res = await apiFetch(
        `/api/v1/dedup/${entity}s/candidates?${params.toString()}`,
      );
      if (!res.ok) throw new Error(`Server responded with ${res.status}`);
      const json: CandidatesResponse = await res.json();
      setPairs(json.pairs ?? []);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load candidates');
      setPairs([]);
    } finally {
      setLoading(false);
    }
  }, [entity, threshold]);

  useEffect(() => {
    fetchCandidates();
  }, [fetchCandidates]);

  function handleMerged(winnerId: string, loserId: string) {
    // Drop the merged pair (and any other pair referencing the removed loser).
    setPairs((prev) =>
      prev.filter((p) => p.a.id !== loserId && p.b.id !== loserId && !(p.a.id === winnerId && p.b.id === loserId)),
    );
  }

  return (
    <div className="space-y-4">
      {/* Threshold control */}
      <div className="flex items-center gap-2">
        <label className="text-xs font-medium text-gray-500 dark:text-gray-400">
          Match threshold
        </label>
        <select
          value={threshold}
          onChange={(e) => setThreshold(Number(e.target.value))}
          aria-label="Similarity threshold"
          className="px-3 py-1.5 text-xs font-medium border border-gray-200 dark:border-gray-700 rounded-lg bg-white dark:bg-gray-900 text-gray-700 dark:text-gray-300 focus:outline-none focus:ring-2 focus:ring-primary/30"
        >
          {THRESHOLDS.map((t) => (
            <option key={t} value={t}>
              {Math.round(t * 100)}% and above
            </option>
          ))}
        </select>
      </div>

      {error && <ErrorBanner message={error} onRetry={fetchCandidates} />}

      {/* Loading */}
      {loading ? (
        <div className="space-y-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <div
              key={i}
              className="bg-white dark:bg-gray-900 rounded-xl border border-gray-100 dark:border-gray-800 shadow-sm p-4 animate-pulse"
            >
              <div className="h-4 bg-gray-100 dark:bg-gray-800 rounded w-1/4 mb-3" />
              <div className="flex gap-4">
                <div className="flex-1 h-20 bg-gray-100 dark:bg-gray-800 rounded" />
                <div className="flex-1 h-20 bg-gray-100 dark:bg-gray-800 rounded" />
              </div>
            </div>
          ))}
        </div>
      ) : pairs.length === 0 ? (
        <Card>
          <EmptyState
            icon={<Copy className="w-10 h-10" />}
            title="No duplicate candidates found"
            description={`No ${entity === 'lead' ? 'leads' : 'clients'} matched at this threshold. Lower the threshold to surface looser matches.`}
          />
        </Card>
      ) : (
        <div className="space-y-3">
          {pairs.map((p) => (
            <Card key={pairKey(entity, p)} padding="md">
              <div className="flex items-center justify-between gap-3 mb-3">
                <div className="flex items-center gap-2">
                  <Badge variant={scoreBadgeVariant(p.score)}>
                    {Math.round(p.score * 100)}% match
                  </Badge>
                  {p.matchedOn?.length > 0 && (
                    <span className="text-xs text-gray-400 dark:text-gray-500">
                      matched on {p.matchedOn.join(', ')}
                    </span>
                  )}
                </div>
                <Button variant="primary" size="sm" onClick={() => setActive(p)}>
                  Review &amp; merge
                </Button>
              </div>
              <div className="flex flex-col sm:flex-row gap-3 items-stretch">
                <RecordSummary entity={entity} rec={p.a} matchedOn={p.matchedOn ?? []} />
                <div className="flex items-center justify-center text-gray-300 dark:text-gray-600 text-xs font-medium sm:flex-col">
                  vs
                </div>
                <RecordSummary entity={entity} rec={p.b} matchedOn={p.matchedOn ?? []} />
              </div>
            </Card>
          ))}
        </div>
      )}

      {active && (
        <MergeModal
          open={!!active}
          onClose={() => setActive(null)}
          entity={entity}
          a={active.a}
          b={active.b}
          onMerged={handleMerged}
        />
      )}
    </div>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────

export default function DuplicatesPage() {
  const [tab, setTab] = useState<EntityTab>('lead');

  const filtersNode = (
    <div
      className="inline-flex rounded-lg border border-gray-200 dark:border-gray-700 overflow-hidden"
      role="tablist"
      aria-label="Entity switcher"
    >
      <button
        onClick={() => setTab('lead')}
        role="tab"
        aria-selected={tab === 'lead'}
        className={`px-4 py-2 text-xs font-medium transition-colors ${
          tab === 'lead' ? 'bg-primary text-white' : 'bg-white dark:bg-gray-900 text-gray-600 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-800'
        }`}
      >
        Leads
      </button>
      <button
        onClick={() => setTab('client')}
        role="tab"
        aria-selected={tab === 'client'}
        className={`px-4 py-2 text-xs font-medium transition-colors ${
          tab === 'client' ? 'bg-primary text-white' : 'bg-white dark:bg-gray-900 text-gray-600 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-800'
        }`}
      >
        Clients
      </button>
    </div>
  );

  return (
    <ListPageLayout
      title="Duplicates"
      subtitle="Detect and merge duplicate leads and clients"
      filters={filtersNode}
    >
      {/* Remount the panel per tab so each manages its own threshold/fetch state. */}
      {tab === 'lead' ? (
        <CandidatesPanel key="lead" entity="lead" />
      ) : (
        <CandidatesPanel key="client" entity="client" />
      )}
    </ListPageLayout>
  );
}
