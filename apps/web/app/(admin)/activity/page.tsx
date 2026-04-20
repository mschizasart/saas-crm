'use client';

import { useCallback, useEffect, useState } from 'react';
import { ListPageLayout } from '@/components/layouts/list-page-layout';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import { inputClass } from '@/components/ui/form-field';

const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001';
const getToken = () =>
  typeof window === 'undefined' ? null : localStorage.getItem('access_token');

interface ActivityItem {
  id: string;
  action: string;
  relType: string | null;
  relId: string | null;
  description: string | null;
  additionalData?: {
    field?: string;
    oldValue?: string | null;
    newValue?: string | null;
    [key: string]: any;
  } | null;
  createdAt: string;
  user?: { id: string; firstName: string; lastName: string; avatar: string | null } | null;
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
  return `${d}d ago`;
}

function initials(first = '', last = '') {
  return ((first[0] ?? '') + (last[0] ?? '')).toUpperCase() || '?';
}

function isFieldChange(action: string): boolean {
  return action.endsWith('.field_changed');
}

interface GroupedActivity {
  items: ActivityItem[];
  isGroup: boolean;
}

function groupActivities(items: ActivityItem[]): GroupedActivity[] {
  const result: GroupedActivity[] = [];
  let i = 0;

  while (i < items.length) {
    const current = items[i];
    if (isFieldChange(current.action)) {
      const group: ActivityItem[] = [current];
      let j = i + 1;
      while (j < items.length) {
        const next = items[j];
        if (
          isFieldChange(next.action) &&
          next.relType === current.relType &&
          next.relId === current.relId &&
          next.user?.id === current.user?.id &&
          Math.abs(new Date(next.createdAt).getTime() - new Date(current.createdAt).getTime()) < 5000
        ) {
          group.push(next);
          j++;
        } else {
          break;
        }
      }
      result.push({ items: group, isGroup: group.length > 1 });
      i = j;
    } else {
      result.push({ items: [current], isGroup: false });
      i++;
    }
  }

  return result;
}

function FieldChangeDiff({ item }: { item: ActivityItem }) {
  const data = item.additionalData;
  if (!data?.field) return <span>{item.description ?? item.action}</span>;

  return (
    <div className="flex flex-wrap items-center gap-1 text-sm">
      <span className="text-gray-600 dark:text-gray-400 font-medium">{data.field}:</span>
      {data.oldValue && data.oldValue !== 'null' ? (
        <span className="line-through text-red-500 bg-red-50 px-1 rounded text-xs">
          {data.oldValue === '(empty)' ? '(empty)' : data.oldValue}
        </span>
      ) : (
        <span className="text-gray-400 dark:text-gray-500 text-xs">(empty)</span>
      )}
      <span className="text-gray-400 dark:text-gray-500">-&gt;</span>
      {data.newValue && data.newValue !== 'null' ? (
        <span className="text-green-700 bg-green-50 px-1 rounded text-xs">
          {data.newValue === '(empty)' ? '(empty)' : data.newValue}
        </span>
      ) : (
        <span className="text-gray-400 dark:text-gray-500 text-xs">(empty)</span>
      )}
    </div>
  );
}

export default function ActivityPage() {
  const [items, setItems] = useState<ActivityItem[]>([]);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [loading, setLoading] = useState(true);
  const [userFilter, setUserFilter] = useState('');
  const [actionFilter, setActionFilter] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [expandedGroups, setExpandedGroups] = useState<Set<number>>(new Set());

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ page: String(page), limit: '25' });
      if (userFilter) params.set('userId', userFilter);
      if (actionFilter) params.set('action', actionFilter);
      if (from) params.set('from', from);
      if (to) params.set('to', to);

      const res = await fetch(`${API_BASE}/api/v1/activity-log?${params}`, {
        headers: { Authorization: `Bearer ${getToken()}` },
      });
      const data = await res.json();
      setItems(data.data ?? []);
      setTotalPages(data.totalPages ?? 1);
    } finally {
      setLoading(false);
    }
  }, [page, userFilter, actionFilter, from, to]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    const t = setInterval(load, 30000);
    return () => clearInterval(t);
  }, [load]);

  const filtersNode = (
    <div className="flex flex-wrap gap-3">
      <input
        aria-label="Filter by user ID"
        placeholder="Filter by user ID"
        value={userFilter}
        onChange={(e) => setUserFilter(e.target.value)}
        className={`${inputClass} w-auto`}
      />
      <input
        aria-label="Filter by action"
        placeholder="Filter by action"
        value={actionFilter}
        onChange={(e) => setActionFilter(e.target.value)}
        className={`${inputClass} w-auto`}
      />
      <input
        aria-label="From date"
        type="date"
        value={from}
        onChange={(e) => setFrom(e.target.value)}
        className={`${inputClass} w-auto`}
      />
      <input
        aria-label="To date"
        type="date"
        value={to}
        onChange={(e) => setTo(e.target.value)}
        className={`${inputClass} w-auto`}
      />
    </div>
  );

  return (
    <ListPageLayout title="Activity" filters={filtersNode}>
      <Card>
        {loading ? (
          <p className="p-6 text-sm text-gray-400 dark:text-gray-500">Loading...</p>
        ) : items.length === 0 ? (
          <EmptyState title="No activity yet" />
        ) : (
          <ul className="divide-y divide-gray-100 dark:divide-gray-800">
            {groupActivities(items).map((group, gIdx) => {
              const first = group.items[0];
              const isExpanded = expandedGroups.has(gIdx);

              if (group.isGroup) {
                const entityType = first.relType ?? 'entity';
                return (
                  <li key={`g-${gIdx}`} className="p-4">
                    <div className="flex items-start gap-3">
                      <div className="w-8 h-8 rounded-full bg-primary/10 text-primary flex items-center justify-center text-xs font-semibold flex-shrink-0">
                        {first.user ? initials(first.user.firstName, first.user.lastName) : '.'}
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm text-gray-800 dark:text-gray-200">
                          {first.user && (
                            <span className="font-medium">
                              {first.user.firstName} {first.user.lastName}{' '}
                            </span>
                          )}
                          updated {group.items.length} fields on {entityType}
                        </p>
                        <p className="text-xs text-gray-400 dark:text-gray-500 mt-0.5">
                          {relativeTime(first.createdAt)}
                          {first.relType && first.relId && (
                            <>
                              {' . '}
                              <a
                                href={`/${first.relType}s/${first.relId}`}
                                className="text-primary hover:underline"
                              >
                                View {first.relType}
                              </a>
                            </>
                          )}
                        </p>
                        <button
                          onClick={() => {
                            setExpandedGroups((prev) => {
                              const next = new Set(prev);
                              if (next.has(gIdx)) next.delete(gIdx);
                              else next.add(gIdx);
                              return next;
                            });
                          }}
                          className="text-xs text-primary hover:underline mt-1"
                        >
                          {isExpanded ? 'Hide changes' : `Show ${group.items.length} changes`}
                        </button>
                        {isExpanded && (
                          <div className="mt-2 space-y-1 pl-1 border-l-2 border-gray-100 dark:border-gray-800">
                            {group.items.map((item) => (
                              <div key={item.id} className="pl-2">
                                <FieldChangeDiff item={item} />
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    </div>
                  </li>
                );
              }

              const a = first;
              return (
                <li key={a.id} className="p-4 flex items-start gap-3">
                  <div className="w-8 h-8 rounded-full bg-primary/10 text-primary flex items-center justify-center text-xs font-semibold flex-shrink-0">
                    {a.user ? initials(a.user.firstName, a.user.lastName) : '.'}
                  </div>
                  <div className="flex-1 min-w-0">
                    {isFieldChange(a.action) ? (
                      <>
                        <p className="text-sm text-gray-800 dark:text-gray-200">
                          {a.user && (
                            <span className="font-medium">
                              {a.user.firstName} {a.user.lastName}{' '}
                            </span>
                          )}
                          updated {a.relType ?? 'entity'}
                        </p>
                        <div className="mt-1">
                          <FieldChangeDiff item={a} />
                        </div>
                      </>
                    ) : (
                      <p className="text-sm text-gray-800 dark:text-gray-200">
                        {a.user && (
                          <span className="font-medium">
                            {a.user.firstName} {a.user.lastName}{' '}
                          </span>
                        )}
                        {a.description ?? a.action}
                      </p>
                    )}
                    <p className="text-xs text-gray-400 dark:text-gray-500 mt-0.5">
                      {relativeTime(a.createdAt)}
                      {a.relType && a.relId && (
                        <>
                          {' . '}
                          <a
                            href={`/${a.relType}s/${a.relId}`}
                            className="text-primary hover:underline"
                          >
                            View {a.relType}
                          </a>
                        </>
                      )}
                    </p>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
        <div className="flex items-center justify-between p-4 border-t border-gray-100 dark:border-gray-800">
          <span className="text-xs text-gray-500 dark:text-gray-400">
            Page {page} of {totalPages}
          </span>
          <div className="flex gap-2">
            <Button
              variant="secondary"
              size="sm"
              disabled={page <= 1}
              onClick={() => setPage((p) => Math.max(1, p - 1))}
            >
              Previous
            </Button>
            <Button
              variant="secondary"
              size="sm"
              disabled={page >= totalPages}
              onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
            >
              Next
            </Button>
          </div>
        </div>
      </Card>
    </ListPageLayout>
  );
}
