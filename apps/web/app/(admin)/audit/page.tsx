'use client';

/**
 * Org-wide Recent Activity feed (Wave E2).
 *
 * Backed by GET /api/v1/audit/feed. Lets the admin filter by entity type
 * and action, paginate, and click through to the changed record. The
 * per-entity timeline (drop-in component) lives in
 * apps/web/components/audit-timeline.tsx.
 */

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { ListPageLayout } from '@/components/layouts/list-page-layout';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import { inputClass } from '@/components/ui/form-field';

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
  changes: Record<string, any>;
  changedById: string | null;
  ip: string | null;
  changedAt: string;
  changedBy: AuditChangedBy | null;
}

const ENTITY_TYPES = ['client', 'lead', 'opportunity', 'invoice', 'ticket'] as const;
const ACTIONS = ['create', 'update', 'delete'] as const;

/**
 * Best-effort link to the record's detail page. Each entity type maps to
 * its own list/detail route under /(admin); we use the plural form.
 */
const ENTITY_HREF: Record<string, (id: string) => string> = {
  client: (id) => `/clients/${id}`,
  lead: (id) => `/leads/${id}`,
  opportunity: (id) => `/opportunities/${id}`,
  invoice: (id) => `/invoices/${id}`,
  ticket: (id) => `/tickets/${id}`,
};

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

function actionColor(action: string): string {
  if (action === 'create') return 'bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-300';
  if (action === 'delete') return 'bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300';
  return 'bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300';
}

function fmtValue(v: unknown): string {
  if (v === null || v === undefined || v === '') return '(empty)';
  if (typeof v === 'string') return v.length > 60 ? v.slice(0, 60) + '...' : v;
  if (typeof v === 'object') return JSON.stringify(v);
  return String(v);
}

function ChangeSummary({ row }: { row: AuditRow }) {
  if (row.action === 'update') {
    const entries = Object.entries(row.changes ?? {});
    if (entries.length === 0) {
      return <span className="text-xs text-gray-500">No scalar changes.</span>;
    }
    return (
      <div className="flex flex-wrap gap-x-3 gap-y-1">
        {entries.slice(0, 4).map(([field, diff]) => {
          if (diff && typeof diff === 'object' && 'from' in diff && 'to' in diff) {
            return (
              <span key={field} className="text-xs">
                <span className="font-medium text-gray-700 dark:text-gray-300">{field}:</span>{' '}
                <span className="line-through text-red-600">{fmtValue((diff as any).from)}</span>{' '}
                <span className="text-gray-400">-&gt;</span>{' '}
                <span className="text-green-700 dark:text-green-300">{fmtValue((diff as any).to)}</span>
              </span>
            );
          }
          return null;
        })}
        {entries.length > 4 && (
          <span className="text-xs text-gray-400">+ {entries.length - 4} more</span>
        )}
      </div>
    );
  }
  const snapshot = (row.changes && row.changes._all) || {};
  const keys = Object.keys(snapshot);
  if (keys.length === 0) {
    return (
      <span className="text-xs text-gray-500">
        {row.action === 'create' ? 'Record created.' : 'Record deleted.'}
      </span>
    );
  }
  return (
    <span className="text-xs text-gray-500">
      {row.action === 'create' ? 'Created' : 'Deleted'} with {keys.length} field
      {keys.length === 1 ? '' : 's'}.
    </span>
  );
}

export default function AuditFeedPage() {
  const [rows, setRows] = useState<AuditRow[]>([]);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [entityType, setEntityType] = useState<string>('');
  const [action, setAction] = useState<string>('');

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      params.set('page', String(page));
      params.set('limit', '50');
      if (entityType) params.set('entityType', entityType);
      if (action) params.set('action', action);

      const res = await fetch(`${API_BASE}/api/v1/audit/feed?${params}`, {
        headers: { Authorization: `Bearer ${getToken()}` },
      });
      if (!res.ok) {
        throw new Error(`Failed to load audit feed (${res.status})`);
      }
      const data = await res.json();
      setRows(data.data ?? []);
      setTotalPages(data.totalPages ?? 1);
    } catch (e: any) {
      setError(e?.message ?? 'Failed to load');
    } finally {
      setLoading(false);
    }
  }, [page, entityType, action]);

  useEffect(() => {
    load();
  }, [load]);

  const filters = (
    <div className="flex flex-wrap gap-2 items-center">
      <select
        className={inputClass}
        value={entityType}
        onChange={(e) => {
          setPage(1);
          setEntityType(e.target.value);
        }}
        aria-label="Filter by entity type"
      >
        <option value="">All entities</option>
        {ENTITY_TYPES.map((t) => (
          <option key={t} value={t}>
            {t.charAt(0).toUpperCase() + t.slice(1)}
          </option>
        ))}
      </select>
      <select
        className={inputClass}
        value={action}
        onChange={(e) => {
          setPage(1);
          setAction(e.target.value);
        }}
        aria-label="Filter by action"
      >
        <option value="">All actions</option>
        {ACTIONS.map((a) => (
          <option key={a} value={a}>
            {a.charAt(0).toUpperCase() + a.slice(1)}
          </option>
        ))}
      </select>
      <Button variant="ghost" size="sm" onClick={() => load()}>
        Refresh
      </Button>
    </div>
  );

  const pagination = totalPages > 1 ? (
    <div className="flex items-center justify-between text-sm">
      <span className="text-gray-500">
        Page {page} of {totalPages}
      </span>
      <div className="flex gap-2">
        <Button
          variant="ghost"
          size="sm"
          disabled={page <= 1}
          onClick={() => setPage((p) => Math.max(1, p - 1))}
        >
          Previous
        </Button>
        <Button
          variant="ghost"
          size="sm"
          disabled={page >= totalPages}
          onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
        >
          Next
        </Button>
      </div>
    </div>
  ) : null;

  return (
    <ListPageLayout
      title="Audit Trail"
      subtitle="Field history for clients, leads, opportunities, invoices, and tickets."
      filters={filters}
      pagination={pagination}
    >
      <Card className="p-0 overflow-hidden">
        {loading ? (
          <p className="p-6 text-sm text-gray-500">Loading...</p>
        ) : error ? (
          <p className="p-6 text-sm text-red-500">{error}</p>
        ) : rows.length === 0 ? (
          <EmptyState
            title="No audit entries yet"
            description="Changes to clients, leads, opportunities, invoices, and tickets will appear here as soon as anyone edits them."
          />
        ) : (
          <ul className="divide-y divide-gray-100 dark:divide-gray-800">
            {rows.map((row) => {
              const href = ENTITY_HREF[row.entityType]?.(row.entityId);
              return (
                <li key={row.id} className="px-4 py-3 hover:bg-gray-50 dark:hover:bg-gray-900/50">
                  <div className="flex items-start gap-3">
                    <span className="w-7 h-7 mt-0.5 rounded-full bg-gray-200 dark:bg-gray-700 text-[11px] flex items-center justify-center font-semibold text-gray-700 dark:text-gray-300 flex-shrink-0">
                      {initials(row.changedBy)}
                    </span>
                    <div className="flex-1 min-w-0">
                      <div className="flex flex-wrap items-center gap-2 mb-1">
                        <span className="text-sm font-medium text-gray-900 dark:text-gray-100">
                          {displayName(row.changedBy)}
                        </span>
                        <span className={`text-[10px] px-1.5 py-0.5 rounded ${actionColor(row.action)}`}>
                          {row.action}
                        </span>
                        <span className="text-xs text-gray-500">{row.entityType}</span>
                        {href ? (
                          <Link
                            href={href}
                            className="text-xs text-primary hover:underline truncate max-w-[180px]"
                            title={row.entityId}
                          >
                            #{row.entityId.slice(0, 8)}
                          </Link>
                        ) : (
                          <span className="text-xs text-gray-400 truncate max-w-[180px]" title={row.entityId}>
                            #{row.entityId.slice(0, 8)}
                          </span>
                        )}
                        <span
                          className="ml-auto text-[11px] text-gray-400"
                          title={new Date(row.changedAt).toLocaleString()}
                        >
                          {relativeTime(row.changedAt)}
                        </span>
                      </div>
                      <ChangeSummary row={row} />
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </Card>
    </ListPageLayout>
  );
}
