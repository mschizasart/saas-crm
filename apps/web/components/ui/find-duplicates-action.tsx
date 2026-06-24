'use client';

/**
 * FindDuplicatesAction — detail-page entry point for the merge feature.
 *
 * Renders nothing on its own except (optionally) a candidate picker + the
 * MergeModal. The parent detail page wires its existing header "Find
 * duplicates / Merge" action to the imperative handle returned via the
 * `onReady` callback (so it can sit inside DetailPageLayout's `actions`).
 *
 * Flow:
 *   1. Header action calls `find()`.
 *   2. We GET /api/v1/dedup/<entity>s/<id>/candidates.
 *   3. No pairs  -> toast "No duplicates found".
 *      Some pairs -> open MergeModal with THIS record as winner and the top
 *      candidate as loser. A select lets the user switch the loser among the
 *      other candidates.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import {
  MergeModal,
  type MergeEntity,
  type RecordLite,
  type LeadLite,
  type ClientLite,
} from '@/components/ui/merge-modal';
import { apiFetch } from '@/lib/api';

interface CandidatePair {
  score: number;
  matchedOn: string[];
  a: RecordLite;
  b: RecordLite;
}

interface CandidatesResponse {
  pairs: CandidatePair[];
}

export interface FindDuplicatesHandle {
  /** Trigger the candidate lookup; opens the modal or toasts when empty. */
  find: () => void;
  /** True while the candidate lookup request is in flight. */
  loading: boolean;
}

export interface FindDuplicatesActionProps {
  entity: MergeEntity;
  /** The current record (winner). */
  record: RecordLite;
  /** Exposes the imperative trigger so the page can wire a header action. */
  onReady?: (handle: FindDuplicatesHandle) => void;
  /** Called after a successful merge (e.g. to navigate to the winner). */
  onMerged?: (winnerId: string, loserId: string) => void;
}

function candidateLabel(entity: MergeEntity, rec: RecordLite): string {
  const title =
    entity === 'lead' ? (rec as LeadLite).name : (rec as ClientLite).company;
  const email = (rec as LeadLite | ClientLite).email;
  return [title || '(untitled)', email].filter(Boolean).join(' · ');
}

export function FindDuplicatesAction({
  entity,
  record,
  onReady,
  onMerged,
}: FindDuplicatesActionProps) {
  const [loading, setLoading] = useState(false);
  const [candidates, setCandidates] = useState<RecordLite[]>([]);
  const [loserIdx, setLoserIdx] = useState(0);
  const [open, setOpen] = useState(false);

  const find = useCallback(async () => {
    setLoading(true);
    try {
      const res = await apiFetch(
        `/api/v1/dedup/${entity}s/${record.id}/candidates`,
      );
      if (!res.ok) throw new Error(`Failed (${res.status})`);
      const json: CandidatesResponse = await res.json();
      const pairs = json.pairs ?? [];
      // The current record can be on either side of a pair; the candidate is
      // always the OTHER record. De-dup by id while preserving score order.
      const seen = new Set<string>([record.id]);
      const others: RecordLite[] = [];
      for (const p of pairs) {
        const other = p.a.id === record.id ? p.b : p.a;
        if (!seen.has(other.id)) {
          seen.add(other.id);
          others.push(other);
        }
      }
      if (others.length === 0) {
        toast.message('No duplicates found');
        return;
      }
      setCandidates(others);
      setLoserIdx(0);
      setOpen(true);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Lookup failed');
    } finally {
      setLoading(false);
    }
  }, [entity, record.id]);

  // Keep the parent's handle fresh (loading flips, find identity is stable).
  const findRef = useRef(find);
  findRef.current = find;
  useEffect(() => {
    onReady?.({ find: () => findRef.current(), loading });
  }, [onReady, loading]);

  const loser = candidates[loserIdx];

  return (
    <>
      {open && loser && (
        <>
          {candidates.length > 1 && (
            <div className="fixed inset-x-0 top-0 z-[60] flex justify-center pointer-events-none">
              <div className="pointer-events-auto mt-4 flex items-center gap-2 bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-lg shadow-lg px-3 py-2">
                <label className="text-xs font-medium text-gray-500 dark:text-gray-400">
                  Duplicate of
                </label>
                <select
                  value={loserIdx}
                  onChange={(e) => setLoserIdx(Number(e.target.value))}
                  aria-label="Select duplicate to merge"
                  className="px-2 py-1 text-xs border border-gray-200 dark:border-gray-700 rounded-md bg-white dark:bg-gray-900 text-gray-700 dark:text-gray-300 focus:outline-none focus:ring-2 focus:ring-primary/30 max-w-xs"
                >
                  {candidates.map((c, i) => (
                    <option key={c.id} value={i}>
                      {candidateLabel(entity, c)}
                    </option>
                  ))}
                </select>
              </div>
            </div>
          )}
          <MergeModal
            open={open}
            onClose={() => setOpen(false)}
            entity={entity}
            a={record}
            b={loser}
            onMerged={(winnerId, loserId) => {
              setOpen(false);
              onMerged?.(winnerId, loserId);
            }}
          />
        </>
      )}
    </>
  );
}

export default FindDuplicatesAction;
