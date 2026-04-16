'use client';

import { useState, useEffect, useCallback, useRef } from 'react';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface PostUser {
  id: string;
  firstName: string;
  lastName: string;
  avatar: string | null;
}

interface Post {
  id: string;
  content: string;
  likes: number;
  createdAt: string;
  user: PostUser;
}

interface FeedResponse {
  data: Post[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function getToken(): string | null {
  if (typeof window === 'undefined') return null;
  return localStorage.getItem('access_token');
}

function authHeaders(): HeadersInit {
  return { Authorization: `Bearer ${getToken()}`, 'Content-Type': 'application/json' };
}

function relativeTime(dateStr: string): string {
  const now = Date.now();
  const then = new Date(dateStr).getTime();
  const diffSec = Math.floor((now - then) / 1000);
  if (diffSec < 60) return 'just now';
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHrs = Math.floor(diffMin / 60);
  if (diffHrs < 24) return `${diffHrs}h ago`;
  const diffDays = Math.floor(diffHrs / 24);
  if (diffDays === 1) return 'yesterday';
  if (diffDays < 7) return `${diffDays}d ago`;
  return new Date(dateStr).toLocaleDateString();
}

function initials(first: string, last: string): string {
  return `${(first || '')[0] ?? ''}${(last || '')[0] ?? ''}`.toUpperCase();
}

// ---------------------------------------------------------------------------
// Get current user id from JWT (simple base64 decode)
// ---------------------------------------------------------------------------

function getCurrentUserId(): string | null {
  const token = getToken();
  if (!token) return null;
  try {
    const payload = JSON.parse(atob(token.split('.')[1]));
    return payload.sub ?? payload.id ?? null;
  } catch {
    return null;
  }
}

function getIsAdmin(): boolean {
  const token = getToken();
  if (!token) return false;
  try {
    const payload = JSON.parse(atob(token.split('.')[1]));
    return payload.isAdmin === true;
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default function NewsfeedPage() {
  const [posts, setPosts] = useState<Post[]>([]);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [loading, setLoading] = useState(true);
  const [postContent, setPostContent] = useState('');
  const [posting, setPosting] = useState(false);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const currentUserId = typeof window !== 'undefined' ? getCurrentUserId() : null;
  const isAdmin = typeof window !== 'undefined' ? getIsAdmin() : false;

  // ── Fetch posts ───────────────────────────────────────────────────────────

  const fetchPosts = useCallback(async (p: number, silent = false) => {
    if (!silent) setLoading(true);
    try {
      const res = await fetch(`${API_BASE}/api/v1/newsfeed?page=${p}&limit=20`, {
        headers: authHeaders(),
      });
      if (!res.ok) return;
      const data: FeedResponse = await res.json();
      setPosts(data.data);
      setTotalPages(data.totalPages);
    } catch {
      /* ignore */
    } finally {
      if (!silent) setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchPosts(page);
  }, [page, fetchPosts]);

  // ── Auto-refresh every 30s ────────────────────────────────────────────────

  useEffect(() => {
    intervalRef.current = setInterval(() => fetchPosts(page, true), 30_000);
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [page, fetchPosts]);

  // ── Create post ───────────────────────────────────────────────────────────

  async function handlePost(e: React.FormEvent) {
    e.preventDefault();
    if (!postContent.trim()) return;
    setPosting(true);
    try {
      const res = await fetch(`${API_BASE}/api/v1/newsfeed`, {
        method: 'POST',
        headers: authHeaders(),
        body: JSON.stringify({ content: postContent }),
      });
      if (!res.ok) return;
      const newPost: Post = await res.json();
      setPosts((prev) => [newPost, ...prev]);
      setPostContent('');
    } catch {
      /* ignore */
    } finally {
      setPosting(false);
    }
  }

  // ── Like ──────────────────────────────────────────────────────────────────

  async function handleLike(postId: string) {
    try {
      const res = await fetch(`${API_BASE}/api/v1/newsfeed/${postId}/like`, {
        method: 'POST',
        headers: authHeaders(),
      });
      if (!res.ok) return;
      setPosts((prev) =>
        prev.map((p) => (p.id === postId ? { ...p, likes: p.likes + 1 } : p)),
      );
    } catch {
      /* ignore */
    }
  }

  // ── Delete ────────────────────────────────────────────────────────────────

  async function handleDelete(postId: string) {
    if (!confirm('Delete this post?')) return;
    try {
      const res = await fetch(`${API_BASE}/api/v1/newsfeed/${postId}`, {
        method: 'DELETE',
        headers: authHeaders(),
      });
      if (res.ok || res.status === 204) {
        setPosts((prev) => prev.filter((p) => p.id !== postId));
      }
    } catch {
      /* ignore */
    }
  }

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div className="max-w-2xl mx-auto">
      <h1 className="text-2xl font-bold text-gray-900 mb-6">Newsfeed</h1>

      {/* ── Post input ────────────────────────────────────────────────── */}
      <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-5 mb-6">
        <form onSubmit={handlePost}>
          <textarea
            rows={3}
            value={postContent}
            onChange={(e) => setPostContent(e.target.value)}
            placeholder="What's on your mind?"
            className="w-full px-3 py-2.5 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary resize-y"
          />
          <div className="mt-3 flex justify-end">
            <button
              type="submit"
              disabled={posting || !postContent.trim()}
              className="px-4 py-2 text-sm font-medium bg-primary text-white rounded-lg hover:bg-primary/90 disabled:opacity-50 transition-colors"
            >
              {posting ? 'Posting...' : 'Post'}
            </button>
          </div>
        </form>
      </div>

      {/* ── Feed ──────────────────────────────────────────────────────── */}
      {loading ? (
        <div className="flex justify-center items-center py-24">
          <svg
            className="animate-spin h-7 w-7 text-primary"
            xmlns="http://www.w3.org/2000/svg"
            fill="none"
            viewBox="0 0 24 24"
            aria-label="Loading"
          >
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
          </svg>
        </div>
      ) : posts.length === 0 ? (
        <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-10 text-center">
          <p className="text-gray-400 text-sm">No posts yet. Be the first to share an update!</p>
        </div>
      ) : (
        <div className="space-y-4">
          {posts.map((post) => (
            <div key={post.id} className="bg-white rounded-xl border border-gray-100 shadow-sm p-5">
              {/* Author row */}
              <div className="flex items-center gap-3 mb-3">
                {post.user.avatar ? (
                  <img
                    src={post.user.avatar}
                    alt=""
                    className="w-9 h-9 rounded-full object-cover"
                  />
                ) : (
                  <div className="w-9 h-9 rounded-full bg-primary/10 text-primary flex items-center justify-center text-xs font-semibold">
                    {initials(post.user.firstName, post.user.lastName)}
                  </div>
                )}
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-gray-900">
                    {post.user.firstName} {post.user.lastName}
                  </p>
                  <p className="text-xs text-gray-400">{relativeTime(post.createdAt)}</p>
                </div>
              </div>

              {/* Content */}
              <p className="text-sm text-gray-700 whitespace-pre-wrap leading-relaxed mb-3">
                {post.content}
              </p>

              {/* Actions */}
              <div className="flex items-center gap-4 pt-2 border-t border-gray-50">
                <button
                  onClick={() => handleLike(post.id)}
                  className="flex items-center gap-1.5 text-xs text-gray-500 hover:text-red-500 transition-colors"
                >
                  <span>&#10084;&#65039;</span>
                  <span>{post.likes > 0 ? post.likes : ''}</span>
                  <span>Like</span>
                </button>
                {(post.user.id === currentUserId || isAdmin) && (
                  <button
                    onClick={() => handleDelete(post.id)}
                    className="flex items-center gap-1.5 text-xs text-gray-500 hover:text-red-500 transition-colors"
                  >
                    <span>&#128465;&#65039;</span>
                    <span>Delete</span>
                  </button>
                )}
              </div>
            </div>
          ))}

          {/* ── Load more ─────────────────────────────────────────────── */}
          {page < totalPages && (
            <div className="flex justify-center pt-2 pb-4">
              <button
                onClick={() => setPage((p) => p + 1)}
                className="px-4 py-2 text-sm font-medium border border-gray-200 rounded-lg hover:bg-gray-50 transition-colors"
              >
                Load more
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
