'use client';

/**
 * Reusable per-entity audit timeline (Wave E2).
 *
 * Drop in next to any entity detail page:
 *
 *   <AuditTimeline entityType="client" entityId={clientId} />
 *
 * The component fetches `/api/v1/audit/entity?entityType=…&entityId=…`
 * and renders a vertical timeline showing who changed what, when. For
 * `update` actions it renders a per-field old → new diff; for `create`
 * and `delete` it summarises the snapshot.
 *
 * The org-wide /audit page wraps this with no entityType filter — see
 * apps/web/app/(admin)/audit/page.tsx.
 */

import { useEffect, useState } from 'react';

const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001';
const getToken = () =>
  typeof window === 'undefined' ? null : localStorage.getItem('access_token');

interface AuditChangedBy {
  id: string;
  firstName: string | null;
  lastName: string | null;
  email: string;
}

interface AuditRow {
  id: string;
  entityType: string;
  entityId: string;
  action: 'create' | 'update' | 'delete';
  // Update: { field: { from, to } }; Create/Delete: { _all: {...} }
  changes: Record<string, any>;
  changedById: string | null;
  ip: string | null;
  changedAt: string;
  changedBy: AuditChangedBy | null;
}

function relativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const s = Math.floor(diff / 1000);
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  if (d < 30) return `${d}d ago`;
  return new Date(iso).toLocaleDateString();
}

function displayName(u: AuditChangedBy | null): string {
  if (!u) return 'System';
  const name = [u.firstName, u.lastName].filter(Boolean).join(' ').trim();
  return name || u.email;
}

function initials(u: AuditChangedBy | null): string {
  if (!u) return 'S';
  const a = (u.firstName ?? '')[0] ?? '';
  const b = (u.lastName ?? '')[0] ?? '';
  return (a + b).toUpperCase() || (u.email[0] ?? '?').toUpperCase();
}

function fmtValue(v: unknown): string {
  if (v === null || v === undefined || v === '') return '(empty)';
  if (typeof v === 'string') return v.length > 60 ? v.slice(0, 60) + '...' : v;
  if (typeof v === 'object') return JSON.stringify(v);
  return String(v);
}

function actionColor(action: string): string {
  if (action === 'create') return 'bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-300';
  if (action === 'delete') return 'bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300';
  return 'bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300';
}

function FieldDiff({ field, from, to }: { field: string; from: unknown; to: unknown }) {
  return (
    <div className="flex flex-wrap items-center gap-1 text-xs">
      <span className="font-medium text-gray-600 dark:text-gray-300">{field}:</span>
      <span className="line-through text-red-600 bg-red-50 dark:bg-red-950/40 px-1 rounded">
        {fmtValue(from)}
      </span>
      <span className="text-gray-400">-&gt;</span>
      <span className="text-green-700 bg-green-50 dark:bg-green-950/40 dark:text-green-300 px-1 rounded">
        {fmtValue(to)}
      </span>
    </div>
  );
}

function RowBody({ row }: { row: AuditRow }) {
  if (row.action === 'update') {
    const entries = Object.entries(row.changes ?? {});
    if (entries.length === 0) {
      return <p className="text-xs text-gray-500">No scalar fields changed.</p>;
    }
    return (
      <div className="space-y-1">
        {entries.map(([field, diff]) => {
          // Defensive: malformed payloads may not match the {from,to} shape.
          if (diff && typeof diff === 'object' && 'from' in diff && 'to' in diff) {
            return (
              <FieldDiff key={field} field={field} from={(diff as any).from} to={(diff as any).to} />
            );
          }
          return (
            <p key={field} className="text-xs text-gray-500">
              {field}: {fmtValue(diff)}
            </p>
          );
        })}
      </div>
    );
  }

  // create / delete — snapshot under `_all`
  const snapshot = (row.changes && row.changes._all) || row.changes || {};
  const keys = Object.keys(snapshot);
  if (keys.length === 0) {
    return <p className="text-xs text-gray-500">{row.action === 'create' ? 'Record created.' : 'Record deleted.'}</p>;
  }
  // Show a few key fields inline, the rest are collapsed into a count.
  const preview = keys.slice(0, 4);
  const rest = keys.length - preview.length;
  return (
    <div className="flex flex-wrap items-center gap-1 text-xs">
      <span className="text-gray-600 dark:text-gray-400">
        {row.action === 'create' ? 'Created with' : 'Deleted (was)'}:
      </span>
      {preview.map((k) => (
        <span
          key={k}
          className="bg-gray-100 dark:bg-gray-800 text-gray-700 dark:text-gray-300 px-1 rounded"
        >
          {k}={fmtValue(snapshot[k])}
        </span>
      ))}
      {rest > 0 && <span className="text-gray-400">+ {rest} more</span>}
    </div>
  );
}

export interface AuditTimelineProps {
  /** Prisma model name lowercase: 'client' | 'lead' | 'opportunity' | 'invoice' | 'ticket'. */
  entityType: string;
  entityId: string;
  /** Optional override for the per-page row count (default 50). */
  limit?: number;
  className?: string;
}

export function AuditTimeline({
  entityType,
  entityId,
  limit = 50,
  className = '',
}: AuditTimelineProps) {
  const [rows, setRows] = useState<AuditRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      setLoading(true);
      setError(null);
      try {
        const token = getToken();
        const url = `${API_BASE}/api/v1/audit/entity?entityType=${encodeURIComponent(
          entityType,
        )}&entityId=${encodeURIComponent(entityId)}&limit=${limit}`;
        const res = await fetch(url, {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (!res.ok) {
          throw new Error(`Failed to load audit history (${res.status})`);
        }
        const data = await res.json();
        if (!cancelled) setRows(data.data ?? []);
      } catch (e: any) {
        if (!cancelled) setError(e?.message ?? 'Failed to load');
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    if (entityType && entityId) load();
    return () => {
      cancelled = true;
    };
  }, [entityType, entityId, limit]);

  if (loading) {
    return (
      <div className={`text-xs text-gray-500 dark:text-gray-400 ${className}`}>
        Loading history...
      </div>
    );
  }
  if (error) {
    return <div className={`text-xs text-red-500 ${className}`}>{error}</div>;
  }
  if (rows.length === 0) {
    return (
      <div className={`text-xs text-gray-500 dark:text-gray-400 ${className}`}>
        No changes recorded yet.
      </div>
    );
  }

  return (
    <ol className={`relative border-l border-gray-200 dark:border-gray-700 pl-4 space-y-4 ${className}`}>
      {rows.map((row) => (
        <li key={row.id} className="relative">
          <span className="absolute -left-[21px] top-1 flex items-center justify-center w-4 h-4 rounded-full bg-white dark:bg-gray-900 border border-gray-300 dark:border-gray-600">
            <span className="w-1.5 h-1.5 rounded-full bg-primary" />
          </span>
          <div className="flex items-center gap-2 mb-1">
            <span className="w-6 h-6 rounded-full bg-gray-200 dark:bg-gray-700 text-[10px] flex items-center justify-center font-semibold text-gray-700 dark:text-gray-300">
              {initials(row.changedBy)}
            </span>
            <span className="text-xs font-medium text-gray-900 dark:text-gray-100">
              {displayName(row.changedBy)}
            </span>
            <span className={`text-[10px] px-1.5 py-0.5 rounded ${actionColor(row.action)}`}>
              {row.action}
            </span>
            <span className="text-[10px] text-gray-400" title={new Date(row.changedAt).toLocaleString()}>
              {relativeTime(row.changedAt)}
            </span>
          </div>
          <RowBody row={row} />
        </li>
      ))}
    </ol>
  );
}
