'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { ListPageLayout } from '@/components/layouts/list-page-layout';
import { Card } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/empty-state';

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
    <ListPageLayout
      title="Notifications"
      primaryAction={{ label: 'Mark all as read', onClick: markAllRead, variant: 'secondary' }}
    >
      <Card>
        {loading ? (
          <p className="p-6 text-sm text-gray-400 dark:text-gray-500">Loading…</p>
        ) : items.length === 0 ? (
          <EmptyState title="You have no notifications." />
        ) : (
          <ul className="divide-y divide-gray-100 dark:divide-gray-800">
            {items.map((n) => (
              <li
                key={n.id}
                className={`p-4 flex items-start gap-3 ${
                  n.read ? '' : 'bg-primary/5'
                }`}
              >
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-gray-900 dark:text-gray-100">{n.title}</p>
                  {n.description && (
                    <p className="text-sm text-gray-600 dark:text-gray-400 mt-0.5">{n.description}</p>
                  )}
                  <p className="text-xs text-gray-400 dark:text-gray-500 mt-1">{relativeTime(n.createdAt)}</p>
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
                      className="text-xs text-gray-500 dark:text-gray-400 hover:text-primary"
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
      </Card>
    </ListPageLayout>
  );
}
