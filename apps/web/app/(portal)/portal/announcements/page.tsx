'use client';

export const dynamic = 'force-dynamic';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';

const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001';

interface Announcement {
  id: string;
  title: string;
  message?: string;
  body?: string;
  content?: string;
  link?: string | null;
  dismissible?: boolean;
  createdAt?: string;
  publishedAt?: string;
  startsAt?: string;
  expiresAt?: string | null;
  dismissed?: boolean;
}

function getToken(): string | null {
  if (typeof window === 'undefined') return null;
  return localStorage.getItem('access_token');
}

function formatDate(iso?: string): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleDateString();
}

export default function PortalAnnouncementsPage() {
  const router = useRouter();

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [items, setItems] = useState<Announcement[]>([]);
  const [dismissing, setDismissing] = useState<Record<string, boolean>>({});

  useEffect(() => {
    const token = getToken();
    if (!token) {
      router.push('/portal/login');
      return;
    }

    (async () => {
      try {
        // Use the history endpoint so dismissed announcements remain visible
        // (greyed out) for reference. `portal` is a synonym for `clients`.
        const res = await fetch(`${API_BASE}/api/v1/announcements/history?audience=portal`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (res.status === 401) {
          router.push('/portal/login');
          return;
        }
        if (!res.ok) throw new Error(`Failed to load announcements (${res.status})`);
        const json = await res.json();
        const list: Announcement[] = json.data ?? json ?? [];
        setItems(Array.isArray(list) ? list : []);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load announcements');
      } finally {
        setLoading(false);
      }
    })();
  }, [router]);

  async function dismiss(id: string) {
    const token = getToken();
    if (!token) {
      router.push('/portal/login');
      return;
    }
    setDismissing((m) => ({ ...m, [id]: true }));
    try {
      const res = await fetch(`${API_BASE}/api/v1/announcements/${id}/dismiss`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok && res.status !== 204) throw new Error(`Failed (${res.status})`);
      // Mark as dismissed in-place (history view keeps them visible but greyed).
      setItems((list) => list.map((a) => (a.id === id ? { ...a, dismissed: true } : a)));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to dismiss');
    } finally {
      setDismissing((m) => {
        const next = { ...m };
        delete next[id];
        return next;
      });
    }
  }

  if (loading) {
    return (
      <div>
        <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100 mb-6">Announcements</h1>
        <div className="space-y-4">
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="bg-white dark:bg-gray-900 rounded-xl border border-gray-100 dark:border-gray-800 shadow-sm p-5">
              <div className="animate-pulse space-y-2">
                <div className="h-4 w-40 bg-gray-100 dark:bg-gray-800 rounded" />
                <div className="h-3 w-full bg-gray-100 dark:bg-gray-800 rounded" />
                <div className="h-3 w-3/4 bg-gray-100 dark:bg-gray-800 rounded" />
              </div>
            </div>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div>
      <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100 mb-6">Announcements</h1>

      {error && (
        <div className="mb-4 px-4 py-3 bg-red-50 border border-red-100 text-sm text-red-600 rounded-lg">{error}</div>
      )}

      {items.length === 0 ? (
        <div className="bg-white dark:bg-gray-900 rounded-xl border border-gray-100 dark:border-gray-800 shadow-sm p-8 text-center text-sm text-gray-500 dark:text-gray-400">
          No announcements right now.
        </div>
      ) : (
        <ul className="space-y-4">
          {items.map((a) => {
            const text = a.message ?? a.body ?? a.content ?? '';
            const posted = formatDate(a.publishedAt ?? a.startsAt ?? a.createdAt);
            return (
              <li
                key={a.id}
                className={`bg-white rounded-xl border border-gray-100 shadow-sm p-5 ${
                  a.dismissed ? 'opacity-60' : ''
                }`}
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="font-semibold text-gray-900 dark:text-gray-100">
                      {a.title}
                      {a.dismissed && (
                        <span className="ml-2 text-xs font-normal text-gray-400 dark:text-gray-500">
                          (dismissed)
                        </span>
                      )}
                    </p>
                    {posted && <p className="text-xs text-gray-400 dark:text-gray-500 mt-0.5">{posted}</p>}
                  </div>
                  {a.dismissible !== false && !a.dismissed && (
                    <button
                      onClick={() => dismiss(a.id)}
                      disabled={!!dismissing[a.id]}
                      className="text-xs px-3 py-1.5 text-gray-600 dark:text-gray-400 bg-gray-100 dark:bg-gray-800 rounded-md hover:bg-gray-200 disabled:opacity-50 whitespace-nowrap"
                    >
                      {dismissing[a.id] ? 'Dismissing…' : 'Dismiss'}
                    </button>
                  )}
                </div>
                {text && <p className="text-sm text-gray-700 dark:text-gray-300 mt-3 whitespace-pre-wrap">{text}</p>}
                {a.link && (
                  <a
                    href={a.link}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-block mt-3 text-sm text-primary hover:underline"
                  >
                    Read more →
                  </a>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
