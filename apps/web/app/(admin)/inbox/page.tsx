'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { formatDistanceToNow } from 'date-fns';
import { toast } from 'sonner';
import {
  Inbox as InboxIcon,
  Mail,
  MailOpen,
  Star,
  StarOff,
  Archive,
  ArchiveRestore,
  RefreshCw,
  Search,
  ArrowLeft,
  ChevronLeft,
  ChevronRight,
  AlertCircle,
} from 'lucide-react';
import { ListPageLayout } from '@/components/layouts/list-page-layout';
import { Card } from '@/components/ui/card';
import { Badge, type BadgeVariant } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import { ErrorBanner } from '@/components/ui/error-banner';
import { inputClass } from '@/components/ui/form-field';
import { apiFetch } from '@/lib/api';
import { typography } from '@/lib/ui-tokens';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type RoutedTarget =
  | 'lead'
  | 'client'
  | 'invoice'
  | 'estimate'
  | 'ticket'
  | 'unmatched';

interface InboxMessage {
  id: string;
  messageId: string;
  fromEmail: string;
  fromName: string | null;
  toEmails: string[];
  ccEmails: string[];
  subject: string | null;
  bodyText: string | null;
  bodyHtml: string | null;
  receivedAt: string;
  attachmentCount: number;
  routedTo: RoutedTarget | null;
  routedToId: string | null;
  isRead: boolean;
  isStarred: boolean;
  isArchived: boolean;
}

interface ListResponse {
  data: InboxMessage[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

type FilterTab = 'all' | 'starred' | 'unmatched' | 'archived';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const ROUTE_BADGE: Record<RoutedTarget, { variant: BadgeVariant; label: string }> = {
  lead:      { variant: 'info',    label: 'Lead' },
  client:    { variant: 'success', label: 'Client' },
  invoice:   { variant: 'warning', label: 'Invoice' },
  estimate:  { variant: 'warning', label: 'Estimate' },
  ticket:    { variant: 'info',    label: 'Ticket' },
  unmatched: { variant: 'muted',   label: 'Unmatched' },
};

const ROUTE_OPTIONS: { value: RoutedTarget | 'none'; label: string }[] = [
  { value: 'none',      label: 'None' },
  { value: 'lead',      label: 'Lead' },
  { value: 'client',    label: 'Client' },
  { value: 'invoice',   label: 'Invoice' },
  { value: 'estimate',  label: 'Estimate' },
  { value: 'ticket',    label: 'Ticket' },
  { value: 'unmatched', label: 'Unmatched' },
];

function relativeTime(iso: string): string {
  try {
    return formatDistanceToNow(new Date(iso), { addSuffix: true });
  } catch {
    return '';
  }
}

function snippetFromBody(text: string | null | undefined, max = 100): string {
  if (!text) return '';
  const collapsed = text.replace(/\s+/g, ' ').trim();
  return collapsed.length > max ? `${collapsed.slice(0, max)}\u2026` : collapsed;
}

function senderDisplay(m: InboxMessage): string {
  return m.fromName?.trim() || m.fromEmail || 'Unknown sender';
}

function formatPageRange(page: number, limit: number, total: number) {
  if (total === 0) return '0 of 0';
  const from = (page - 1) * limit + 1;
  const to = Math.min(page * limit, total);
  return `${from}\u2013${to} of ${total}`;
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

const PAGE_SIZE = 25;

export default function InboxPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const selectedId = searchParams.get('id');

  const [tab, setTab] = useState<FilterTab>('all');
  const [search, setSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [page, setPage] = useState(1);

  const [list, setList] = useState<ListResponse | null>(null);
  const [listLoading, setListLoading] = useState(true);
  const [listError, setListError] = useState<string | null>(null);

  const [selected, setSelected] = useState<InboxMessage | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState<string | null>(null);

  const [polling, setPolling] = useState(false);

  // Debounce search.
  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(search.trim()), 300);
    return () => clearTimeout(t);
  }, [search]);

  // Reset to page 1 when filters change.
  useEffect(() => {
    setPage(1);
  }, [tab, debouncedSearch]);

  // ─── Fetch list ───────────────────────────────────────────────────
  const fetchList = useCallback(async () => {
    setListLoading(true);
    setListError(null);
    try {
      const qs = new URLSearchParams();
      qs.set('page', String(page));
      qs.set('limit', String(PAGE_SIZE));
      if (debouncedSearch) qs.set('search', debouncedSearch);
      switch (tab) {
        case 'starred':
          qs.set('isStarred', 'true');
          qs.set('isArchived', 'false');
          break;
        case 'unmatched':
          qs.set('routedTo', 'unmatched');
          qs.set('isArchived', 'false');
          break;
        case 'archived':
          qs.set('isArchived', 'true');
          break;
        case 'all':
        default:
          qs.set('isArchived', 'false');
          break;
      }
      const res = await apiFetch(`/api/v1/inbox?${qs.toString()}`);
      if (!res.ok) throw new Error(`List failed (${res.status})`);
      const data: ListResponse = await res.json();
      setList(data);
    } catch (err) {
      setListError(err instanceof Error ? err.message : 'Failed to load inbox');
    } finally {
      setListLoading(false);
    }
  }, [page, debouncedSearch, tab]);

  useEffect(() => {
    fetchList();
  }, [fetchList]);

  // ─── Fetch selected detail ───────────────────────────────────────
  useEffect(() => {
    if (!selectedId) {
      setSelected(null);
      setDetailError(null);
      return;
    }
    let cancelled = false;
    setDetailLoading(true);
    setDetailError(null);
    (async () => {
      try {
        const res = await apiFetch(`/api/v1/inbox/${selectedId}`);
        if (!res.ok) throw new Error(`Failed (${res.status})`);
        const data: InboxMessage = await res.json();
        if (!cancelled) {
          setSelected(data);
          // Optimistically mark the row in the list as read (the API auto-marks on first GET).
          setList((prev) =>
            prev
              ? {
                  ...prev,
                  data: prev.data.map((m) =>
                    m.id === data.id ? { ...m, isRead: true } : m,
                  ),
                }
              : prev,
          );
        }
      } catch (err) {
        if (!cancelled) {
          setDetailError(err instanceof Error ? err.message : 'Failed to load message');
        }
      } finally {
        if (!cancelled) setDetailLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [selectedId]);

  // ─── Selection helpers ───────────────────────────────────────────
  const selectMessage = useCallback(
    (id: string) => {
      const params = new URLSearchParams(searchParams.toString());
      params.set('id', id);
      router.replace(`/inbox?${params.toString()}`);
    },
    [router, searchParams],
  );

  const clearSelection = useCallback(() => {
    const params = new URLSearchParams(searchParams.toString());
    params.delete('id');
    const qs = params.toString();
    router.replace(qs ? `/inbox?${qs}` : '/inbox');
  }, [router, searchParams]);

  // ─── Mutations ───────────────────────────────────────────────────
  async function patchMessage(
    id: string,
    body: Partial<Pick<InboxMessage, 'isRead' | 'isStarred' | 'isArchived'>>,
  ) {
    try {
      const res = await apiFetch(`/api/v1/inbox/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!res.ok) throw new Error(`Update failed (${res.status})`);
      const updated: InboxMessage = await res.json();
      // Patch both the list and the selected message.
      setList((prev) =>
        prev
          ? {
              ...prev,
              data: prev.data.map((m) => (m.id === id ? { ...m, ...updated } : m)),
            }
          : prev,
      );
      setSelected((prev) => (prev && prev.id === id ? { ...prev, ...updated } : prev));
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Update failed');
    }
  }

  async function reroute(id: string, routedTo: RoutedTarget | 'none', routedToId: string | null) {
    try {
      const target = routedTo === 'none' ? 'unmatched' : routedTo;
      const res = await apiFetch(`/api/v1/inbox/${id}/route`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          routedTo: target,
          routedToId: routedTo === 'none' ? null : routedToId,
        }),
      });
      if (!res.ok) throw new Error(`Re-route failed (${res.status})`);
      const updated: InboxMessage = await res.json();
      setList((prev) =>
        prev
          ? {
              ...prev,
              data: prev.data.map((m) => (m.id === id ? { ...m, ...updated } : m)),
            }
          : prev,
      );
      setSelected((prev) => (prev && prev.id === id ? { ...prev, ...updated } : prev));
      toast.success('Routing updated');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Re-route failed');
    }
  }

  async function syncNow() {
    setPolling(true);
    try {
      // Backend exposes POST /inbox/sync (the spec text said /inbox/poll;
      // the actual route is /sync — see InboxController.syncNow).
      const res = await apiFetch('/api/v1/inbox/sync', { method: 'POST' });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err?.message ?? `Sync failed (${res.status})`);
      }
      const data: { fetched?: number; inserted?: number; skipped?: string } = await res.json();
      if (data?.skipped === 'imap-disabled') {
        toast.message('IMAP not enabled — configure it in Settings → Email.');
      } else {
        toast.success(
          `Synced — fetched ${data.fetched ?? 0}, new ${data.inserted ?? 0}.`,
        );
      }
      await fetchList();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Sync failed');
    } finally {
      setPolling(false);
    }
  }

  // ─── Render ──────────────────────────────────────────────────────
  return (
    <ListPageLayout
      title="Inbox"
      subtitle="Inbound email synced from your IMAP mailbox, routed to the matching record automatically."
      primaryAction={{
        label: polling ? 'Syncing\u2026' : 'Sync inbox',
        onClick: syncNow,
        icon: <RefreshCw className={`w-4 h-4 ${polling ? 'animate-spin' : ''}`} />,
        disabled: polling,
      }}
      secondaryActions={[
        {
          label: 'Configure IMAP',
          href: '/settings/email',
        },
      ]}
      fullHeight
    >
      <div className="grid grid-cols-1 md:grid-cols-[minmax(0,28rem)_minmax(0,1fr)] gap-4 h-full min-h-0">
        {/* ─── Left column: list ─────────────────────────────────── */}
        <div
          className={`flex flex-col min-h-0 ${
            selectedId ? 'hidden md:flex' : 'flex'
          }`}
        >
          <Card padding="none" className="flex flex-col flex-1 min-h-0">
            {/* Filter tabs */}
            <div className="border-b border-gray-100 dark:border-gray-800 px-3 pt-3 pb-2 flex items-center gap-1 overflow-x-auto">
              {(
                [
                  { value: 'all',       label: 'All' },
                  { value: 'starred',   label: 'Starred' },
                  { value: 'unmatched', label: 'Unmatched' },
                  { value: 'archived',  label: 'Archived' },
                ] as { value: FilterTab; label: string }[]
              ).map((t) => (
                <button
                  key={t.value}
                  onClick={() => setTab(t.value)}
                  className={`px-3 py-1.5 rounded-md text-xs font-medium whitespace-nowrap transition-colors ${
                    tab === t.value
                      ? 'bg-primary/10 text-primary'
                      : 'text-gray-500 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-800'
                  }`}
                >
                  {t.label}
                </button>
              ))}
            </div>

            {/* Search */}
            <div className="px-3 py-2 border-b border-gray-100 dark:border-gray-800">
              <div className="relative">
                <Search
                  className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-gray-400"
                  aria-hidden="true"
                />
                <input
                  type="search"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Search subject or sender…"
                  className={`${inputClass} pl-9`}
                />
              </div>
            </div>

            {/* List body */}
            <div className="flex-1 min-h-0 overflow-y-auto">
              {listError && (
                <div className="p-3">
                  <ErrorBanner message={listError} onRetry={fetchList} />
                </div>
              )}

              {listLoading && !list ? (
                <div className="p-6 space-y-3">
                  {Array.from({ length: 6 }).map((_, i) => (
                    <div key={i} className="animate-pulse space-y-2">
                      <div className="h-3 w-1/3 bg-gray-100 dark:bg-gray-800 rounded" />
                      <div className="h-3 w-3/4 bg-gray-100 dark:bg-gray-800 rounded" />
                      <div className="h-3 w-1/2 bg-gray-100 dark:bg-gray-800 rounded" />
                    </div>
                  ))}
                </div>
              ) : !list || list.data.length === 0 ? (
                <EmptyState
                  icon={<InboxIcon className="w-12 h-12" />}
                  title={
                    debouncedSearch
                      ? 'No messages match your search'
                      : tab === 'archived'
                      ? 'Nothing archived'
                      : 'Inbox is empty'
                  }
                  description={
                    debouncedSearch
                      ? 'Try a different keyword or clear the search.'
                      : tab === 'all'
                      ? 'Connect an IMAP mailbox in Settings to start syncing inbound email here.'
                      : 'Messages you flag will appear under their tab.'
                  }
                  action={
                    !debouncedSearch && tab === 'all'
                      ? { label: 'Configure IMAP', href: '/settings/email', variant: 'primary' }
                      : undefined
                  }
                />
              ) : (
                <ul className="divide-y divide-gray-100 dark:divide-gray-800">
                  {list.data.map((m) => (
                    <MessageRow
                      key={m.id}
                      message={m}
                      active={m.id === selectedId}
                      onSelect={() => selectMessage(m.id)}
                      onToggleStar={(next) => patchMessage(m.id, { isStarred: next })}
                    />
                  ))}
                </ul>
              )}
            </div>

            {/* Pagination */}
            {list && list.totalPages > 1 && (
              <div className="border-t border-gray-100 dark:border-gray-800 px-3 py-2 flex items-center justify-between text-xs text-gray-500 dark:text-gray-400">
                <span>{formatPageRange(list.page, list.limit, list.total)}</span>
                <div className="flex items-center gap-1">
                  <button
                    type="button"
                    onClick={() => setPage((p) => Math.max(1, p - 1))}
                    disabled={list.page <= 1 || listLoading}
                    className="p-1 rounded hover:bg-gray-100 dark:hover:bg-gray-800 disabled:opacity-40"
                    aria-label="Previous page"
                  >
                    <ChevronLeft className="w-4 h-4" />
                  </button>
                  <span className="px-2">
                    {list.page} / {list.totalPages}
                  </span>
                  <button
                    type="button"
                    onClick={() => setPage((p) => Math.min(list.totalPages, p + 1))}
                    disabled={list.page >= list.totalPages || listLoading}
                    className="p-1 rounded hover:bg-gray-100 dark:hover:bg-gray-800 disabled:opacity-40"
                    aria-label="Next page"
                  >
                    <ChevronRight className="w-4 h-4" />
                  </button>
                </div>
              </div>
            )}
          </Card>
        </div>

        {/* ─── Right column: detail ──────────────────────────────── */}
        <div
          className={`flex flex-col min-h-0 ${
            selectedId ? 'flex' : 'hidden md:flex'
          }`}
        >
          <Card padding="none" className="flex flex-col flex-1 min-h-0">
            {selectedId ? (
              detailLoading && !selected ? (
                <div className="p-8 text-sm text-gray-500 dark:text-gray-400">
                  Loading message…
                </div>
              ) : detailError ? (
                <div className="p-4">
                  <ErrorBanner message={detailError} />
                </div>
              ) : selected ? (
                <MessageDetail
                  message={selected}
                  onBack={clearSelection}
                  onMarkUnread={() => patchMessage(selected.id, { isRead: false })}
                  onToggleStar={() =>
                    patchMessage(selected.id, { isStarred: !selected.isStarred })
                  }
                  onToggleArchive={() =>
                    patchMessage(selected.id, { isArchived: !selected.isArchived })
                  }
                  onReroute={(target, targetId) => reroute(selected.id, target, targetId)}
                />
              ) : null
            ) : (
              <EmptyState
                icon={<Mail className="w-12 h-12" />}
                title="Select a message"
                description="Pick a row on the left to read it. The first read marks it as opened."
              />
            )}
          </Card>
        </div>
      </div>
    </ListPageLayout>
  );
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function MessageRow({
  message,
  active,
  onSelect,
  onToggleStar,
}: {
  message: InboxMessage;
  active: boolean;
  onSelect: () => void;
  onToggleStar: (next: boolean) => void;
}) {
  const route = message.routedTo ?? 'unmatched';
  const routeMeta = ROUTE_BADGE[route];
  const unread = !message.isRead;

  return (
    <li>
      {/* Use role=button on a div instead of <button> so the nested star toggle
          remains a real <button>. Nested buttons are invalid HTML. */}
      <div
        role="button"
        tabIndex={0}
        onClick={onSelect}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            onSelect();
          }
        }}
        className={`w-full text-left px-3 py-3 flex items-start gap-3 transition-colors cursor-pointer ${
          active
            ? 'bg-primary/5 border-l-2 border-primary'
            : 'hover:bg-gray-50 dark:hover:bg-gray-800/60 border-l-2 border-transparent'
        }`}
      >
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onToggleStar(!message.isStarred);
          }}
          className={`mt-0.5 flex-shrink-0 ${
            message.isStarred
              ? 'text-yellow-500 hover:text-yellow-600'
              : 'text-gray-300 dark:text-gray-600 hover:text-yellow-500'
          }`}
          aria-label={message.isStarred ? 'Unstar' : 'Star'}
        >
          <Star
            className="w-4 h-4"
            fill={message.isStarred ? 'currentColor' : 'none'}
          />
        </button>

        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-0.5">
            <span
              className={`text-sm truncate ${
                unread
                  ? 'font-semibold text-gray-900 dark:text-gray-100'
                  : 'text-gray-700 dark:text-gray-300'
              }`}
            >
              {senderDisplay(message)}
            </span>
            <span className="ml-auto flex-shrink-0 text-[11px] text-gray-400 dark:text-gray-500">
              {relativeTime(message.receivedAt)}
            </span>
          </div>
          <div
            className={`text-xs truncate ${
              unread
                ? 'font-medium text-gray-800 dark:text-gray-200'
                : 'text-gray-600 dark:text-gray-400'
            }`}
          >
            {message.subject || '(no subject)'}
          </div>
          <div className="text-xs text-gray-500 dark:text-gray-400 truncate mt-0.5">
            {snippetFromBody(message.bodyText, 80) || '—'}
          </div>
          <div className="flex items-center gap-2 mt-1.5">
            <Badge variant={routeMeta.variant}>{routeMeta.label}</Badge>
            {message.attachmentCount > 0 && (
              <span className="text-[11px] text-gray-400 dark:text-gray-500">
                {message.attachmentCount} attachment
                {message.attachmentCount === 1 ? '' : 's'}
              </span>
            )}
          </div>
        </div>
      </div>
    </li>
  );
}

function MessageDetail({
  message,
  onBack,
  onMarkUnread,
  onToggleStar,
  onToggleArchive,
  onReroute,
}: {
  message: InboxMessage;
  onBack: () => void;
  onMarkUnread: () => void;
  onToggleStar: () => void;
  onToggleArchive: () => void;
  onReroute: (target: RoutedTarget | 'none', targetId: string | null) => void;
}) {
  const route = message.routedTo ?? 'unmatched';
  const routeMeta = ROUTE_BADGE[route];

  return (
    <>
      {/* Action bar */}
      <div className="flex items-center gap-2 px-3 py-2 border-b border-gray-100 dark:border-gray-800 flex-wrap">
        <button
          type="button"
          onClick={onBack}
          className="md:hidden p-1.5 rounded hover:bg-gray-100 dark:hover:bg-gray-800 text-gray-500"
          aria-label="Back to list"
        >
          <ArrowLeft className="w-4 h-4" />
        </button>

        <Button variant="ghost" size="sm" onClick={onMarkUnread} icon={<MailOpen className="w-4 h-4" />}>
          Mark unread
        </Button>
        <Button
          variant="ghost"
          size="sm"
          onClick={onToggleStar}
          icon={
            message.isStarred ? (
              <StarOff className="w-4 h-4" />
            ) : (
              <Star className="w-4 h-4" />
            )
          }
        >
          {message.isStarred ? 'Unstar' : 'Star'}
        </Button>
        <Button
          variant="ghost"
          size="sm"
          onClick={onToggleArchive}
          icon={
            message.isArchived ? (
              <ArchiveRestore className="w-4 h-4" />
            ) : (
              <Archive className="w-4 h-4" />
            )
          }
        >
          {message.isArchived ? 'Unarchive' : 'Archive'}
        </Button>

        <div className="ml-auto">
          <RerouteControl message={message} onReroute={onReroute} />
        </div>
      </div>

      {/* Body */}
      <div className="flex-1 min-h-0 overflow-y-auto p-5 space-y-4">
        <div>
          <h2 className={typography.h3}>{message.subject || '(no subject)'}</h2>
          <div className="mt-1 flex items-center gap-2 flex-wrap">
            <Badge variant={routeMeta.variant}>{routeMeta.label}</Badge>
            {message.routedToId && (
              <span className="text-xs text-gray-500 dark:text-gray-400">
                <code className="bg-gray-100 dark:bg-gray-800 px-1 py-0.5 rounded">
                  {message.routedToId}
                </code>
              </span>
            )}
          </div>
        </div>

        <div className="rounded-lg border border-gray-100 dark:border-gray-800 p-4 bg-gray-50/50 dark:bg-gray-900/40 text-xs space-y-1">
          <div>
            <span className="text-gray-500 dark:text-gray-400">From:</span>{' '}
            <span className="font-medium text-gray-800 dark:text-gray-200">
              {message.fromName ? `${message.fromName} ` : ''}
              <span className="font-normal text-gray-500 dark:text-gray-400">
                &lt;{message.fromEmail}&gt;
              </span>
            </span>
          </div>
          {message.toEmails?.length > 0 && (
            <div>
              <span className="text-gray-500 dark:text-gray-400">To:</span>{' '}
              <span className="text-gray-700 dark:text-gray-300">
                {message.toEmails.join(', ')}
              </span>
            </div>
          )}
          {message.ccEmails?.length > 0 && (
            <div>
              <span className="text-gray-500 dark:text-gray-400">Cc:</span>{' '}
              <span className="text-gray-700 dark:text-gray-300">
                {message.ccEmails.join(', ')}
              </span>
            </div>
          )}
          <div>
            <span className="text-gray-500 dark:text-gray-400">Received:</span>{' '}
            <span className="text-gray-700 dark:text-gray-300">
              {new Date(message.receivedAt).toLocaleString()}{' '}
              <span className="text-gray-400">
                ({relativeTime(message.receivedAt)})
              </span>
            </span>
          </div>
          {message.attachmentCount > 0 && (
            <div className="pt-1">
              <span className="text-gray-500 dark:text-gray-400">
                {message.attachmentCount} attachment
                {message.attachmentCount === 1 ? '' : 's'}
              </span>{' '}
              <span className="text-amber-600 dark:text-amber-400 text-[11px]">
                (download not available in v1)
              </span>
            </div>
          )}
        </div>

        <MessageBody message={message} />
      </div>
    </>
  );
}

/**
 * Render the email body. We prefer `bodyHtml` rendered inside a sandboxed
 * iframe (no `allow-scripts`) so any embedded JS, fetches, or top-frame
 * navigations are neutralized by the browser. Falls back to a `<pre>`-wrapped
 * plaintext view when no HTML is present.
 *
 * Why iframe srcDoc and not DOMPurify? — DOMPurify isn't installed, and the
 * sandboxed iframe gives an even stronger guarantee (CSP-equivalent at the
 * document boundary). Trade-off: we lose styling continuity with the page.
 * v2: install DOMPurify and inline-render with a tighter style scope.
 */
function MessageBody({ message }: { message: InboxMessage }) {
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const [iframeHeight, setIframeHeight] = useState(400);

  // Auto-size the iframe to its content height.
  useEffect(() => {
    if (!message.bodyHtml) return;
    const iframe = iframeRef.current;
    if (!iframe) return;

    const measure = () => {
      try {
        const doc = iframe.contentDocument;
        if (!doc) return;
        const h = Math.max(
          doc.documentElement.scrollHeight,
          doc.body?.scrollHeight ?? 0,
          200,
        );
        setIframeHeight(Math.min(h + 16, 4000));
      } catch {
        /* cross-origin / sandboxed without same-origin → leave default */
      }
    };

    iframe.addEventListener('load', measure);
    return () => iframe.removeEventListener('load', measure);
  }, [message.bodyHtml]);

  const srcDoc = useMemo(() => {
    if (!message.bodyHtml) return '';
    // Wrap in a minimal HTML shell with light styling that respects the host page.
    return `<!doctype html>
<html><head><meta charset="utf-8" /><base target="_blank" /><style>
body { font: 13px/1.5 system-ui,-apple-system,Segoe UI,Roboto,sans-serif; color: #1f2937; margin: 0; padding: 4px; word-wrap: break-word; }
@media (prefers-color-scheme: dark) { body { color: #e5e7eb; background: #0b0f17; } a { color: #60a5fa; } }
img { max-width: 100%; height: auto; }
table { max-width: 100%; }
blockquote { border-left: 3px solid #d1d5db; margin: 0; padding: 0 0.75rem; color: #6b7280; }
</style></head><body>${message.bodyHtml}</body></html>`;
  }, [message.bodyHtml]);

  if (message.bodyHtml) {
    return (
      <iframe
        ref={iframeRef}
        title="Email body"
        srcDoc={srcDoc}
        // sandbox WITHOUT allow-scripts blocks <script>, inline JS, popups,
        // top-nav, form submission. allow-popups so legit links open externally.
        sandbox="allow-popups"
        referrerPolicy="no-referrer"
        className="w-full border border-gray-100 dark:border-gray-800 rounded-lg bg-white"
        style={{ height: iframeHeight }}
      />
    );
  }

  if (message.bodyText) {
    return (
      <pre className="whitespace-pre-wrap break-words text-sm text-gray-800 dark:text-gray-200 font-sans bg-white dark:bg-gray-900 border border-gray-100 dark:border-gray-800 rounded-lg p-4">
        {message.bodyText}
      </pre>
    );
  }

  return (
    <div className="rounded-lg border border-dashed border-gray-200 dark:border-gray-700 p-6 text-center text-sm text-gray-400 dark:text-gray-500">
      <AlertCircle className="w-5 h-5 mx-auto mb-2" />
      No body content
    </div>
  );
}

/**
 * v1 re-route control: type select + free-text id.
 * v2: replace the id input with a typeahead picker per target.
 */
function RerouteControl({
  message,
  onReroute,
}: {
  message: InboxMessage;
  onReroute: (target: RoutedTarget | 'none', targetId: string | null) => void;
}) {
  const initialTarget: RoutedTarget | 'none' =
    !message.routedTo || message.routedTo === 'unmatched'
      ? 'unmatched'
      : message.routedTo;
  const [target, setTarget] = useState<RoutedTarget | 'none'>(initialTarget);
  const [targetId, setTargetId] = useState(message.routedToId ?? '');
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  // Reset when the active message changes.
  useEffect(() => {
    setTarget(
      !message.routedTo || message.routedTo === 'unmatched'
        ? 'unmatched'
        : message.routedTo,
    );
    setTargetId(message.routedToId ?? '');
  }, [message.id, message.routedTo, message.routedToId]);

  // Close when clicking outside.
  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  const requiresId = target !== 'none' && target !== 'unmatched';

  const apply = () => {
    onReroute(target, requiresId ? targetId.trim() || null : null);
    setOpen(false);
  };

  return (
    <div ref={ref} className="relative">
      <Button variant="secondary" size="sm" onClick={() => setOpen((v) => !v)}>
        Re-route…
      </Button>
      {open && (
        <div className="absolute right-0 top-full mt-2 w-72 bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-lg shadow-lg p-3 z-20 space-y-3">
          <div>
            <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">
              Target type
            </label>
            <select
              value={target}
              onChange={(e) => setTarget(e.target.value as RoutedTarget | 'none')}
              className={inputClass}
            >
              {ROUTE_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </div>
          {requiresId && (
            <div>
              <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">
                Record ID
              </label>
              <input
                type="text"
                value={targetId}
                onChange={(e) => setTargetId(e.target.value)}
                placeholder="Paste record id…"
                className={inputClass}
              />
              <p className="text-[11px] text-gray-400 dark:text-gray-500 mt-1">
                v2: replace with searchable picker.
              </p>
            </div>
          )}
          <div className="flex justify-end gap-2 pt-1">
            <Button variant="ghost" size="sm" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button size="sm" onClick={apply}>
              Apply
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
