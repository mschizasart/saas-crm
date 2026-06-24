'use client';

/**
 * Merge modal — Duplicate Detection + Record Merge feature.
 *
 * Given two records (a, b) of entity type 'lead' | 'client', lets the user:
 *   - choose the winner (default a = winner) via a toggle,
 *   - resolve per-field conflicts where values differ (radio winner/loser),
 *   - confirm the merge (POST /api/v1/dedup/<entity>/merge).
 *
 * On success the loser's activity/notes/deals/invoices are repointed to the
 * winner on the backend; we surface the total repointed count in a toast and
 * tell the parent to drop the merged pair from its list.
 *
 * Auth: uses apiFetch (handles bearer token + refresh) like the rest of the app.
 */

import { useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';
import { AlertTriangle, ArrowLeftRight } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useModalA11y } from '@/components/ui/use-modal-a11y';
import { apiFetch } from '@/lib/api';

// ─── Types ────────────────────────────────────────────────────────────

export type MergeEntity = 'lead' | 'client';

export interface LeadLite {
  id: string;
  name: string;
  email: string | null;
  phone: string | null;
  company: string | null;
  createdAt: string;
}

export interface ClientLite {
  id: string;
  company: string;
  email: string | null;
  phone: string | null;
  city: string | null;
  createdAt: string;
}

export type RecordLite = LeadLite | ClientLite;

interface MergeResponse {
  merged: boolean;
  winnerId: string;
  loserId: string;
  repointed: Record<string, number>;
}

export interface MergeModalProps {
  open: boolean;
  onClose: () => void;
  entity: MergeEntity;
  /** Default winner record. */
  a: RecordLite;
  /** Default loser record. */
  b: RecordLite;
  /** Called after a successful merge with the two record ids that were merged. */
  onMerged?: (winnerId: string, loserId: string) => void;
}

// ─── Field definitions per entity ─────────────────────────────────────
//
// Drives the side-by-side comparison table. `createdAt` is shown read-only
// (it isn't an editable field override — it's just context).

interface FieldDef {
  key: string;
  label: string;
  /** When true the field participates in conflict resolution (overrides). */
  selectable: boolean;
}

const LEAD_FIELDS: FieldDef[] = [
  { key: 'name', label: 'Name', selectable: true },
  { key: 'email', label: 'Email', selectable: true },
  { key: 'phone', label: 'Phone', selectable: true },
  { key: 'company', label: 'Company', selectable: true },
  { key: 'createdAt', label: 'Created', selectable: false },
];

const CLIENT_FIELDS: FieldDef[] = [
  { key: 'company', label: 'Company', selectable: true },
  { key: 'email', label: 'Email', selectable: true },
  { key: 'phone', label: 'Phone', selectable: true },
  { key: 'city', label: 'City', selectable: true },
  { key: 'createdAt', label: 'Created', selectable: false },
];

// ─── Helpers ──────────────────────────────────────────────────────────

function fieldValue(rec: RecordLite, key: string): string {
  const v = (rec as unknown as Record<string, unknown>)[key];
  if (v == null || v === '') return '';
  if (key === 'createdAt') {
    try {
      return new Date(String(v)).toLocaleDateString('en-GB', {
        year: 'numeric',
        month: 'short',
        day: 'numeric',
      });
    } catch {
      return String(v);
    }
  }
  return String(v);
}

function recordTitle(entity: MergeEntity, rec: RecordLite): string {
  if (entity === 'lead') return (rec as LeadLite).name || '(no name)';
  return (rec as ClientLite).company || '(no company)';
}

// ─── Component ────────────────────────────────────────────────────────

export function MergeModal({
  open,
  onClose,
  entity,
  a,
  b,
  onMerged,
}: MergeModalProps) {
  const containerRef = useModalA11y(open, onClose);

  // Which of the two passed records is the winner. true => `a`, false => `b`.
  const [aIsWinner, setAIsWinner] = useState(true);
  // Per-field choice: 'winner' (keep winner's value) | 'loser' (take loser's).
  const [choices, setChoices] = useState<Record<string, 'winner' | 'loser'>>({});
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fields = entity === 'lead' ? LEAD_FIELDS : CLIENT_FIELDS;

  // Reset state whenever the modal opens or the pair changes.
  useEffect(() => {
    if (!open) return;
    setAIsWinner(true);
    setChoices({});
    setError(null);
    setSubmitting(false);
  }, [open, a.id, b.id]);

  const winner = aIsWinner ? a : b;
  const loser = aIsWinner ? b : a;

  // Conflicting fields = selectable fields whose values differ.
  const conflicts = useMemo(
    () =>
      fields.filter(
        (f) => f.selectable && fieldValue(winner, f.key) !== fieldValue(loser, f.key),
      ),
    [fields, winner, loser],
  );

  function choiceFor(key: string): 'winner' | 'loser' {
    return choices[key] ?? 'winner';
  }

  function setChoice(key: string, value: 'winner' | 'loser') {
    setChoices((prev) => ({ ...prev, [key]: value }));
  }

  async function handleMerge() {
    setSubmitting(true);
    setError(null);

    // Only include fields where the user chose to take the loser's value.
    const fieldOverrides: Record<string, 'winner' | 'loser'> = {};
    for (const f of conflicts) {
      if (choiceFor(f.key) === 'loser') fieldOverrides[f.key] = 'loser';
    }

    try {
      const res = await apiFetch(`/api/v1/dedup/${entity}s/merge`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          winnerId: winner.id,
          loserId: loser.id,
          ...(Object.keys(fieldOverrides).length > 0 ? { fieldOverrides } : {}),
        }),
      });

      if (!res.ok) {
        let msg = `Merge failed (${res.status})`;
        try {
          const j = await res.json();
          if (j?.message) msg = String(j.message);
        } catch {
          /* ignore */
        }
        throw new Error(msg);
      }

      const json: MergeResponse = await res.json();
      const moved = Object.values(json.repointed ?? {}).reduce(
        (sum, n) => sum + (typeof n === 'number' ? n : 0),
        0,
      );
      toast.success(`Merged — ${moved} reference${moved === 1 ? '' : 's'} moved`);
      onMerged?.(winner.id, loser.id);
      onClose();
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Merge failed';
      setError(msg);
      toast.error(msg);
    } finally {
      setSubmitting(false);
    }
  }

  if (!open) return null;

  function handleBackdrop(e: React.MouseEvent<HTMLDivElement>) {
    if (e.target === e.currentTarget) onClose();
  }

  return (
    <div
      onClick={handleBackdrop}
      className="fixed inset-0 z-50 flex items-start justify-center bg-black/40 backdrop-blur-sm overflow-y-auto"
    >
      <div
        ref={containerRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="merge-modal-title"
        className="bg-white dark:bg-gray-900 rounded-xl shadow-2xl max-w-3xl w-full mx-4 mt-12 mb-10"
      >
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100 dark:border-gray-800">
          <div>
            <h2
              id="merge-modal-title"
              className="text-lg font-semibold text-gray-900 dark:text-gray-100"
            >
              Merge {entity === 'lead' ? 'leads' : 'clients'}
            </h2>
            <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
              Keeping <span className="font-medium text-gray-700 dark:text-gray-300">{recordTitle(entity, winner)}</span>, removing{' '}
              <span className="font-medium text-gray-700 dark:text-gray-300">{recordTitle(entity, loser)}</span>
            </p>
          </div>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-gray-600 text-2xl leading-none p-1"
            aria-label="Close"
          >
            &times;
          </button>
        </div>

        {/* Winner toggle */}
        <div className="px-6 py-4 border-b border-gray-100 dark:border-gray-800 flex items-center justify-between gap-3">
          <div className="text-sm text-gray-600 dark:text-gray-400">
            <span className="font-medium text-gray-800 dark:text-gray-200">Winner</span> is the
            record that is kept. The other is removed.
          </div>
          <Button
            variant="secondary"
            size="sm"
            icon={<ArrowLeftRight className="w-3.5 h-3.5" />}
            onClick={() => setAIsWinner((v) => !v)}
            disabled={submitting}
          >
            Swap winner / loser
          </Button>
        </div>

        {/* Side-by-side field table */}
        <div className="px-6 py-5">
          <div className="overflow-x-auto border border-gray-200 dark:border-gray-700 rounded-lg">
            <table className="min-w-full text-sm">
              <thead>
                <tr className="bg-gray-50 dark:bg-gray-900 border-b border-gray-100 dark:border-gray-800 text-left text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide">
                  <th className="px-3 py-2 w-28">Field</th>
                  <th className="px-3 py-2">
                    Winner
                    <span className="ml-1.5 inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-semibold bg-green-100 text-green-700 dark:bg-green-500/20 dark:text-green-300 normal-case">
                      kept
                    </span>
                  </th>
                  <th className="px-3 py-2">
                    Loser
                    <span className="ml-1.5 inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-semibold bg-red-100 text-red-700 dark:bg-red-500/20 dark:text-red-300 normal-case">
                      removed
                    </span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {fields.map((f) => {
                  const wVal = fieldValue(winner, f.key);
                  const lVal = fieldValue(loser, f.key);
                  const differs = f.selectable && wVal !== lVal;
                  const choice = choiceFor(f.key);
                  return (
                    <tr
                      key={f.key}
                      className="border-b border-gray-100 dark:border-gray-800 last:border-0 align-top"
                    >
                      <td className="px-3 py-2 text-xs font-medium text-gray-500 dark:text-gray-400 whitespace-nowrap">
                        {f.label}
                      </td>
                      <td
                        className={`px-3 py-2 text-gray-900 dark:text-gray-100 ${
                          differs ? 'bg-green-50/60 dark:bg-green-900/10' : ''
                        }`}
                      >
                        {differs ? (
                          <label className="flex items-start gap-2 cursor-pointer">
                            <input
                              type="radio"
                              name={`field-${f.key}`}
                              checked={choice === 'winner'}
                              onChange={() => setChoice(f.key, 'winner')}
                              className="mt-1 w-3.5 h-3.5 text-primary focus:ring-primary/30"
                            />
                            <span className="break-all">{wVal || <span className="text-gray-300 dark:text-gray-600">—</span>}</span>
                          </label>
                        ) : (
                          <span className="break-all">{wVal || <span className="text-gray-300 dark:text-gray-600">—</span>}</span>
                        )}
                      </td>
                      <td
                        className={`px-3 py-2 text-gray-700 dark:text-gray-300 ${
                          differs ? 'bg-red-50/40 dark:bg-red-900/10' : ''
                        }`}
                      >
                        {differs ? (
                          <label className="flex items-start gap-2 cursor-pointer">
                            <input
                              type="radio"
                              name={`field-${f.key}`}
                              checked={choice === 'loser'}
                              onChange={() => setChoice(f.key, 'loser')}
                              className="mt-1 w-3.5 h-3.5 text-primary focus:ring-primary/30"
                            />
                            <span className="break-all">{lVal || <span className="text-gray-300 dark:text-gray-600">—</span>}</span>
                          </label>
                        ) : (
                          <span className="break-all">{lVal || <span className="text-gray-300 dark:text-gray-600">—</span>}</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {conflicts.length > 0 && (
            <p className="text-xs text-gray-400 dark:text-gray-500 mt-2">
              {conflicts.length} field{conflicts.length === 1 ? '' : 's'} differ — pick which value to
              keep on the winner.
            </p>
          )}

          {/* Destructive warning */}
          <div className="mt-4 flex items-start gap-2 px-3 py-2.5 bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 rounded-lg">
            <AlertTriangle className="w-4 h-4 text-amber-600 dark:text-amber-400 flex-shrink-0 mt-0.5" />
            <p className="text-xs text-amber-700 dark:text-amber-300">
              Merging moves all of the loser&apos;s activity/notes/deals/invoices to the winner and
              removes the loser from lists. This cannot be undone.
            </p>
          </div>

          {error && (
            <div className="mt-4 px-3 py-2 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 text-sm text-red-700 dark:text-red-300 rounded-lg">
              {error}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex justify-end gap-3 px-6 py-4 border-t border-gray-100 dark:border-gray-800">
          <Button variant="secondary" onClick={onClose} disabled={submitting}>
            Cancel
          </Button>
          <Button
            variant="destructive"
            onClick={handleMerge}
            loading={submitting}
            disabled={submitting}
          >
            Merge records
          </Button>
        </div>
      </div>
    </div>
  );
}

export default MergeModal;
