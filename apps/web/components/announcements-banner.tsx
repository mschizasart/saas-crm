'use client';

import { useEffect, useState, useCallback } from 'react';

const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001';

interface Announcement {
  id: string;
  title: string;
  message: string;
  link?: string | null;
  dismissible: boolean;
}

function getToken() {
  if (typeof window === 'undefined') return null;
  return localStorage.getItem('access_token');
}

export function AnnouncementsBanner() {
  const [items, setItems] = useState<Announcement[]>([]);

  const load = useCallback(async () => {
    const token = getToken();
    if (!token) return;
    try {
      const res = await fetch(
        `${API_BASE}/api/v1/announcements/active?audience=staff`,
        { headers: { Authorization: `Bearer ${token}` } },
      );
      if (res.ok) {
        setItems(await res.json());
      }
    } catch {
      /* ignore */
    }
  }, []);

  useEffect(() => {
    load();
    const t = setInterval(load, 60_000);
    return () => clearInterval(t);
  }, [load]);

  async function dismiss(id: string) {
    const token = getToken();
    await fetch(`${API_BASE}/api/v1/announcements/${id}/dismiss`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
    });
    setItems((xs) => xs.filter((x) => x.id !== id));
  }

  if (items.length === 0) return null;

  return (
    <div className="space-y-1">
      {items.map((a) => (
        <div
          key={a.id}
          className="flex items-start justify-between gap-3 bg-amber-50 border-b border-amber-200 px-4 py-2 text-sm"
        >
          <div className="flex-1">
            <span className="font-semibold text-amber-900">{a.title}</span>
            <span className="text-amber-800 ml-2">{a.message}</span>
            {a.link && (
              <a
                href={a.link}
                target="_blank"
                rel="noreferrer"
                className="ml-2 text-blue-700 hover:underline"
              >
                Learn more
              </a>
            )}
          </div>
          {a.dismissible && (
            <button
              onClick={() => dismiss(a.id)}
              className="text-amber-700 hover:text-amber-900"
              aria-label="Dismiss"
            >
              ×
            </button>
          )}
        </div>
      ))}
    </div>
  );
}
