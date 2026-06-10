'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { apiFetch } from '@/lib/api';

/**
 * Chatter-style internal feed for a record (Wave G3).
 *
 * Drop into any entity detail page:
 *
 *   <RecordFeed entityType="opportunity" entityId={opp.id} />
 *
 * - Composes posts (top-level + threaded replies).
 * - Detects `@something` in the textarea and renders an autocomplete
 *   dropdown that searches `/api/v1/users?search=…`. Picking a user
 *   replaces the `@partial` with `@FirstLast` AND tracks the user id
 *   in a Set so the submit can pass `mentionedUserIds[]`.
 * - "Edit" button on own posts within the 5-min window (UI only — the
 *   API enforces the window too). "Delete" button on own posts.
 *
 * All requests use `apiFetch()` (Wave E3 lesson — don't reinvent the
 * auth-fetch helper; it handles token refresh + 401 redirect).
 */

type EntityType = 'client' | 'lead' | 'opportunity' | 'ticket';

interface FeedUser {
  id: string;
  firstName: string | null;
  lastName: string | null;
  email: string | null;
  avatar?: string | null;
}

interface FeedMentionRow {
  id: string;
  mentionedUserId: string;
  mentionedUser?: FeedUser | null;
}

interface FeedPostRow {
  id: string;
  authorId: string | null;
  author?: FeedUser | null;
  body: string;
  parentPostId: string | null;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
  mentions: FeedMentionRow[];
  replies?: FeedPostRow[];
}

interface ListResponse {
  data: FeedPostRow[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

interface RecordFeedProps {
  entityType: EntityType;
  entityId: string;
  /** Defaults to 25 — caps server-side at 100. */
  pageSize?: number;
  /**
   * Current user id — drives "Edit" / "Delete" affordances. If omitted
   * we hide those buttons entirely (safe default).
   */
  currentUserId?: string;
}

const EDIT_WINDOW_MS = 5 * 60 * 1000;

function displayName(u: FeedUser | null | undefined): string {
  if (!u) return '[former member]';
  const name = `${u.firstName ?? ''} ${u.lastName ?? ''}`.trim();
  return name || u.email || '[unknown]';
}

function initials(u: FeedUser | null | undefined): string {
  if (!u) return '?';
  const fi = (u.firstName ?? '').slice(0, 1);
  const li = (u.lastName ?? '').slice(0, 1);
  return (fi + li).toUpperCase() || (u.email ?? '?').slice(0, 1).toUpperCase();
}

/**
 * Compose box. Handles textarea, @mention autocomplete, and submit.
 * Reusable for top-level posts AND reply forms.
 */
function ComposeBox({
  placeholder,
  onSubmit,
  onCancel,
  busy,
  autoFocus,
}: {
  placeholder: string;
  onSubmit: (body: string, mentionedUserIds: string[]) => Promise<void>;
  onCancel?: () => void;
  busy: boolean;
  autoFocus?: boolean;
}) {
  const [body, setBody] = useState('');
  const [mentions, setMentions] = useState<Map<string, FeedUser>>(new Map());
  // Autocomplete state.
  const [query, setQuery] = useState<string | null>(null);
  const [suggestions, setSuggestions] = useState<FeedUser[]>([]);
  const [open, setOpen] = useState(false);
  const taRef = useRef<HTMLTextAreaElement>(null);

  // Re-detect the `@partial` immediately before the cursor on every
  // change. If the cursor is sitting inside an @-token, fetch matches.
  useEffect(() => {
    if (!taRef.current) return;
    const cursor = taRef.current.selectionStart ?? body.length;
    const before = body.slice(0, cursor);
    // Match the last @word (letters/numbers/_/-) immediately to the
    // left of the cursor. Bounded so a stray @ in the middle of a
    // sentence with a space after it doesn't open the dropdown.
    const m = before.match(/(^|[\s\n])@([\w-]{0,30})$/);
    if (m) {
      setQuery(m[2]);
      setOpen(true);
    } else {
      setQuery(null);
      setOpen(false);
    }
  }, [body]);

  // Debounced user search. We rely on the backend `/users?search=` to
  // do the actual lookup; org-scoping is handled there.
  useEffect(() => {
    if (query === null) return;
    let cancelled = false;
    const t = setTimeout(async () => {
      try {
        const url = query
          ? `/api/v1/users?search=${encodeURIComponent(query)}&limit=8`
          : `/api/v1/users?limit=8`;
        const res = await apiFetch(url);
        if (!res.ok) return;
        const json = await res.json();
        if (cancelled) return;
        setSuggestions(Array.isArray(json?.data) ? json.data.slice(0, 8) : []);
      } catch {
        if (!cancelled) setSuggestions([]);
      }
    }, 120);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [query]);

  function pickSuggestion(u: FeedUser) {
    if (!taRef.current) return;
    const cursor = taRef.current.selectionStart ?? body.length;
    const before = body.slice(0, cursor);
    const after = body.slice(cursor);
    // Replace the trailing @partial with @FirstLast (display token).
    const replaced = before.replace(/(^|[\s\n])@([\w-]{0,30})$/, (_full, prefix) => {
      const tag = `${displayName(u).replace(/\s+/g, '')}`;
      return `${prefix}@${tag} `;
    });
    const next = replaced + after;
    setBody(next);
    setMentions((m) => {
      const copy = new Map(m);
      copy.set(u.id, u);
      return copy;
    });
    setOpen(false);
    setQuery(null);
    // Restore focus + move cursor after the inserted tag.
    requestAnimationFrame(() => {
      if (taRef.current) {
        const pos = replaced.length;
        taRef.current.focus();
        taRef.current.setSelectionRange(pos, pos);
      }
    });
  }

  async function submit() {
    const trimmed = body.trim();
    if (!trimmed || busy) return;
    // Filter the mention id list down to ids actually still mentioned
    // in the body — if the user typed then deleted the @tag, we drop
    // them from the payload so they don't get notified for nothing.
    const stillMentioned = [...mentions.entries()]
      .filter(([, u]) => {
        const tag = `@${displayName(u).replace(/\s+/g, '')}`;
        return trimmed.includes(tag);
      })
      .map(([id]) => id);
    await onSubmit(trimmed, stillMentioned);
    setBody('');
    setMentions(new Map());
  }

  return (
    <div className="relative">
      <textarea
        ref={taRef}
        value={body}
        onChange={(e) => setBody(e.target.value)}
        placeholder={placeholder}
        autoFocus={autoFocus}
        rows={3}
        className="w-full px-3 py-2 text-sm border border-gray-200 dark:border-gray-700 rounded-lg bg-white dark:bg-gray-900 focus:outline-none focus:ring-2 focus:ring-primary/30 resize-y"
      />
      {open && suggestions.length > 0 && (
        <div className="absolute left-0 right-0 top-full mt-1 z-20 bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-lg shadow-lg max-h-56 overflow-y-auto">
          {suggestions.map((u) => (
            <button
              type="button"
              key={u.id}
              onClick={() => pickSuggestion(u)}
              className="w-full flex items-center gap-2 px-3 py-1.5 text-left hover:bg-gray-50 dark:hover:bg-gray-800 text-sm"
            >
              <span className="w-6 h-6 rounded-full bg-primary/10 text-primary flex items-center justify-center text-[10px] font-semibold">
                {initials(u)}
              </span>
              <span className="flex-1">
                <span className="font-medium">{displayName(u)}</span>
                {u.email && (
                  <span className="text-xs text-gray-500 ml-2">{u.email}</span>
                )}
              </span>
            </button>
          ))}
        </div>
      )}
      <div className="mt-2 flex items-center justify-end gap-2">
        {onCancel && (
          <button
            type="button"
            onClick={onCancel}
            disabled={busy}
            className="px-3 py-1.5 text-xs rounded-md border border-gray-200 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-800"
          >
            Cancel
          </button>
        )}
        <button
          type="button"
          onClick={submit}
          disabled={busy || !body.trim()}
          className="px-3 py-1.5 text-xs rounded-md bg-primary text-white hover:bg-primary/90 disabled:opacity-50"
        >
          {busy ? 'Posting…' : 'Post'}
        </button>
      </div>
    </div>
  );
}

/**
 * A single rendered post — author + body + reply / edit / delete row.
 * Replies are rendered recursively (one level visually nested).
 */
function PostRow({
  post,
  currentUserId,
  onReply,
  onEdit,
  onDelete,
  nested,
}: {
  post: FeedPostRow;
  currentUserId?: string;
  onReply: (postId: string) => void;
  onEdit: (post: FeedPostRow) => void;
  onDelete: (post: FeedPostRow) => void;
  nested?: boolean;
}) {
  const isOwn = !!currentUserId && post.authorId === currentUserId;
  const withinEdit =
    isOwn && Date.now() - new Date(post.createdAt).getTime() < EDIT_WINDOW_MS;
  const created = new Date(post.createdAt).toLocaleString();
  const deleted = !!post.deletedAt;

  return (
    <div
      id={`post-${post.id}`}
      className={`flex gap-3 ${nested ? 'pl-8' : ''}`}
    >
      <div className="w-8 h-8 flex-shrink-0 rounded-full bg-primary/10 text-primary flex items-center justify-center text-xs font-semibold">
        {initials(post.author)}
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-baseline gap-2">
          <span className="text-sm font-semibold">{displayName(post.author)}</span>
          <span className="text-[11px] text-gray-500">{created}</span>
          {post.updatedAt !== post.createdAt && !deleted && (
            <span className="text-[11px] text-gray-400">(edited)</span>
          )}
        </div>
        <p
          className={`mt-0.5 text-sm whitespace-pre-wrap break-words ${
            deleted ? 'italic text-gray-400' : ''
          }`}
        >
          {deleted ? '[deleted]' : post.body}
        </p>
        {!deleted && (
          <div className="mt-1 flex items-center gap-3 text-[11px] text-gray-500">
            {!nested && (
              <button
                type="button"
                onClick={() => onReply(post.id)}
                className="hover:text-primary"
              >
                Reply
              </button>
            )}
            {withinEdit && (
              <button
                type="button"
                onClick={() => onEdit(post)}
                className="hover:text-primary"
              >
                Edit
              </button>
            )}
            {isOwn && (
              <button
                type="button"
                onClick={() => onDelete(post)}
                className="hover:text-red-500"
              >
                Delete
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

export function RecordFeed({
  entityType,
  entityId,
  pageSize = 25,
  currentUserId,
}: RecordFeedProps) {
  const [posts, setPosts] = useState<FeedPostRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [posting, setPosting] = useState(false);
  // Which top-level post id (if any) is being replied to.
  const [replyTo, setReplyTo] = useState<string | null>(null);
  // Which post id is being edited in-place (renders an inline textarea).
  const [editingId, setEditingId] = useState<string | null>(null);

  const reload = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const qs = new URLSearchParams({
        entityType,
        entityId,
        limit: String(pageSize),
      });
      const res = await apiFetch(`/api/v1/feed?${qs.toString()}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json: ListResponse = await res.json();
      setPosts(json.data ?? []);
    } catch (e) {
      setError((e as Error).message ?? 'Failed to load feed');
    } finally {
      setLoading(false);
    }
  }, [entityType, entityId, pageSize]);

  useEffect(() => {
    reload();
  }, [reload]);

  // ─── Mutations ───────────────────────────────────────────────

  async function submitPost(
    body: string,
    mentionedUserIds: string[],
    parentPostId?: string,
  ) {
    setPosting(true);
    try {
      const res = await apiFetch(`/api/v1/feed`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          entityType,
          entityId,
          body,
          parentPostId,
          mentionedUserIds,
        }),
      });
      if (!res.ok) {
        const txt = await res.text();
        throw new Error(txt || `HTTP ${res.status}`);
      }
      setReplyTo(null);
      await reload();
    } catch (e) {
      setError((e as Error).message ?? 'Failed to post');
    } finally {
      setPosting(false);
    }
  }

  async function submitEdit(postId: string, body: string) {
    setPosting(true);
    try {
      const res = await apiFetch(`/api/v1/feed/${postId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ body }),
      });
      if (!res.ok) {
        const txt = await res.text();
        throw new Error(txt || `HTTP ${res.status}`);
      }
      setEditingId(null);
      await reload();
    } catch (e) {
      setError((e as Error).message ?? 'Failed to edit');
    } finally {
      setPosting(false);
    }
  }

  async function deletePost(postId: string) {
    if (!confirm('Delete this post? This cannot be undone.')) return;
    try {
      const res = await apiFetch(`/api/v1/feed/${postId}`, { method: 'DELETE' });
      if (!res.ok && res.status !== 204) {
        const txt = await res.text();
        throw new Error(txt || `HTTP ${res.status}`);
      }
      await reload();
    } catch (e) {
      setError((e as Error).message ?? 'Failed to delete');
    }
  }

  // ─── Render ──────────────────────────────────────────────────

  const empty = useMemo(() => posts.length === 0, [posts]);

  return (
    <div className="space-y-4">
      <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-200">Feed</h3>

      {/* Compose box (top-level) */}
      <div className="border border-gray-200 dark:border-gray-700 rounded-lg p-3 bg-gray-50 dark:bg-gray-900/50">
        <ComposeBox
          placeholder="Share an update or @mention a teammate…"
          busy={posting && replyTo === null && editingId === null}
          onSubmit={(b, ids) => submitPost(b, ids)}
        />
      </div>

      {error && (
        <div className="px-3 py-2 text-xs bg-red-50 dark:bg-red-900/20 text-red-700 dark:text-red-300 border border-red-200 dark:border-red-800 rounded-md">
          {error}
        </div>
      )}

      {loading ? (
        <p className="text-xs text-gray-500">Loading feed…</p>
      ) : empty ? (
        <p className="text-xs text-gray-400 dark:text-gray-500 italic">
          No posts yet. Be the first to share an update.
        </p>
      ) : (
        <ul className="space-y-4">
          {posts.map((topLevelPost) => (
            <li
              key={topLevelPost.id}
              className="border border-gray-100 dark:border-gray-800 rounded-lg p-3 space-y-3"
            >
              {editingId === topLevelPost.id ? (
                <div className="ml-11">
                  <ComposeBox
                    placeholder="Edit your post…"
                    busy={posting}
                    autoFocus
                    onCancel={() => setEditingId(null)}
                    onSubmit={(b) => submitEdit(topLevelPost.id, b)}
                  />
                </div>
              ) : (
                <PostRow
                  post={topLevelPost}
                  currentUserId={currentUserId}
                  onReply={(id) => setReplyTo(id)}
                  onEdit={(p) => setEditingId(p.id)}
                  onDelete={(p) => deletePost(p.id)}
                />
              )}

              {(topLevelPost.replies ?? []).map((reply) => (
                <PostRow
                  key={reply.id}
                  post={reply}
                  nested
                  currentUserId={currentUserId}
                  // Reply-on-a-reply must attach to the ROOT post — the
                  // API now rejects depth > 1 (see feed.service create()).
                  onReply={() => setReplyTo(topLevelPost.id)}
                  onEdit={(p) => setEditingId(p.id)}
                  onDelete={(p) => deletePost(p.id)}
                />
              ))}

              {replyTo === topLevelPost.id && (
                <div className="pl-11">
                  <ComposeBox
                    placeholder={`Reply to ${displayName(topLevelPost.author)}…`}
                    busy={posting}
                    autoFocus
                    onCancel={() => setReplyTo(null)}
                    onSubmit={(b, ids) => submitPost(b, ids, topLevelPost.id)}
                  />
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
