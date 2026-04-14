'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';

const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001';
const getToken = () =>
  typeof window === 'undefined' ? null : localStorage.getItem('access_token');

interface Notification {
  id: string;
  title: string;
  description: string | null;
  type: string | null;
  link: string | null;
  read: boolean;
  createdAt: string;
}

function relativeTime(iso: string): string {
  const s = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}

export default function NotificationsPage() {
  const [items, setItems] = useState<Notification[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`${API_BASE}/api/v1/notifications?limit=100`, {
        headers: { Authorization: `Bearer ${getToken()}` },
      });
      const data = await res.json();
      setItems(data.data ?? []);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const markAllRead = async () => {
    await fetch(`${API_BASE}/api/v1/notifications/read-all`, {
      method: 'PATCH',
      headers: { Authorization: `Bearer ${getToken()}` },
    });
    load();
  };

  const markOneRead = async (id: string) => {
    await fetch(`${API_BASE}/api/v1/notifications/${id}/read`, {
      method: 'PATCH',
      headers: { Authorization: `Bearer ${getToken()}` },
    });
    load();
  };

  const remove = async (id: string) => {
    await fetch(`${API_BASE}/api/v1/notifications/${id}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${getToken()}` },
    });
    load();
  };

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold text-gray-900">Notifications</h1>
        <button
          onClick={markAllRead}
          className="text-sm font-medium px-4 py-2 border border-gray-200 rounded-lg hover:bg-gray-50"
        >
          Mark all as read
        </button>
      </div>

      <div className="bg-white rounded-xl border border-gray-100 shadow-sm">
        {loading ? (
          <p className="p-6 text-sm text-gray-400">Loading…</p>
        ) : items.length === 0 ? (
          <p className="p-6 text-sm text-gray-400">You have no notifications.</p>
        ) : (
          <ul className="divide-y divide-gray-100">
            {items.map((n) => (
              <li
                key={n.id}
                className={`p-4 flex items-start gap-3 ${
                  n.read ? '' : 'bg-primary/5'
                }`}
              >
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-gray-900">{n.title}</p>
                  {n.description && (
                    <p className="text-sm text-gray-600 mt-0.5">{n.description}</p>
                  )}
                  <p className="text-xs text-gray-400 mt-1">{relativeTime(n.createdAt)}</p>
                </div>
                <div className="flex items-center gap-2">
                  {n.link && (
                    <Link
                      href={n.link}
                      className="text-xs text-primary hover:underline"
                    >
                      View
                    </Link>
                  )}
                  {!n.read && (
                    <button
                      onClick={() => markOneRead(n.id)}
                      className="text-xs text-gray-500 hover:text-primary"
                    >
                      Mark read
                    </button>
                  )}
                  <button
                    onClick={() => remove(n.id)}
                    className="text-xs text-red-600 hover:underline"
                  >
                    Delete
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
