'use client';

import { useEffect, useState, useCallback } from 'react';
import { ListPageLayout } from '@/components/layouts/list-page-layout';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import { inputClass } from '@/components/ui/form-field';

const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001';

interface Announcement {
  id: string;
  title: string;
  message: string;
  link?: string | null;
  showToStaff: boolean;
  showToClients: boolean;
  dismissible: boolean;
  expiresAt?: string | null;
  createdAt: string;
}

function getToken() {
  if (typeof window === 'undefined') return null;
  return localStorage.getItem('access_token');
}

export default function AnnouncementsPage() {
  const [items, setItems] = useState<Announcement[]>([]);
  const [loading, setLoading] = useState(true);
  const [form, setForm] = useState({
    title: '',
    message: '',
    link: '',
    showToStaff: true,
    showToClients: false,
    dismissible: true,
    expiresAt: '',
  });

  const load = useCallback(async () => {
    setLoading(true);
    const token = getToken();
    const res = await fetch(`${API_BASE}/api/v1/announcements`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    setItems(await res.json());
    setLoading(false);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function create(e: React.FormEvent) {
    e.preventDefault();
    const token = getToken();
    await fetch(`${API_BASE}/api/v1/announcements`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        ...form,
        link: form.link || undefined,
        expiresAt: form.expiresAt || undefined,
      }),
    });
    setForm({
      title: '',
      message: '',
      link: '',
      showToStaff: true,
      showToClients: false,
      dismissible: true,
      expiresAt: '',
    });
    load();
  }

  async function remove(id: string) {
    if (!confirm('Delete announcement?')) return;
    const token = getToken();
    await fetch(`${API_BASE}/api/v1/announcements/${id}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${token}` },
    });
    load();
  }

  return (
    <ListPageLayout title="Announcements" className="max-w-3xl">
      <Card padding="md">
        <form onSubmit={create} className="space-y-3">
          <input
            aria-label="Title"
            required
            placeholder="Title"
            value={form.title}
            onChange={(e) => setForm({ ...form, title: e.target.value })}
            className={inputClass}
          />
          <textarea
            aria-label="Message"
            required
            placeholder="Message"
            value={form.message}
            onChange={(e) => setForm({ ...form, message: e.target.value })}
            className={inputClass}
            rows={3}
          />
          <input
            aria-label="Link"
            placeholder="Link (optional)"
            value={form.link}
            onChange={(e) => setForm({ ...form, link: e.target.value })}
            className={inputClass}
          />
          <div className="flex items-center gap-4">
            <label className="flex items-center gap-1 text-sm">
              <input
                type="checkbox"
                checked={form.showToStaff}
                onChange={(e) =>
                  setForm({ ...form, showToStaff: e.target.checked })
                }
              />
              Show to staff
            </label>
            <label className="flex items-center gap-1 text-sm">
              <input
                type="checkbox"
                checked={form.showToClients}
                onChange={(e) =>
                  setForm({ ...form, showToClients: e.target.checked })
                }
              />
              Show to clients
            </label>
            <label className="flex items-center gap-1 text-sm">
              <input
                type="checkbox"
                checked={form.dismissible}
                onChange={(e) =>
                  setForm({ ...form, dismissible: e.target.checked })
                }
              />
              Dismissible
            </label>
          </div>
          <div>
            <label className="block text-sm font-medium mb-1">Expires at</label>
            <input
              type="datetime-local"
              value={form.expiresAt}
              onChange={(e) => setForm({ ...form, expiresAt: e.target.value })}
              className={inputClass}
            />
          </div>
          <Button type="submit">Add Announcement</Button>
        </form>
      </Card>

      <Card>
        {loading ? (
          <p className="p-4">Loading…</p>
        ) : items.length === 0 ? (
          <EmptyState title="No announcements" description="Publish one above." />
        ) : (
          <div className="divide-y divide-gray-100 dark:divide-gray-800">
            {items.map((a) => (
              <div
                key={a.id}
                className="p-4 flex items-start justify-between"
              >
                <div>
                  <h3 className="font-semibold">{a.title}</h3>
                  <p className="text-sm text-gray-600 dark:text-gray-400">{a.message}</p>
                  <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                    {a.showToStaff ? 'Staff' : ''}
                    {a.showToStaff && a.showToClients ? ' + ' : ''}
                    {a.showToClients ? 'Clients' : ''}
                    {a.expiresAt &&
                      ` · expires ${new Date(a.expiresAt).toLocaleDateString()}`}
                  </p>
                </div>
                <Button variant="ghost" size="sm" onClick={() => remove(a.id)} className="text-red-600 hover:text-red-700">
                  Delete
                </Button>
              </div>
            ))}
          </div>
        )}
      </Card>
    </ListPageLayout>
  );
}
