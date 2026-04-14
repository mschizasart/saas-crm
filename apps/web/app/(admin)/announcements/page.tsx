'use client';

import { useEffect, useState, useCallback } from 'react';

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
    <div className="space-y-6 max-w-3xl">
      <h1 className="text-2xl font-bold">Announcements</h1>

      <form
        onSubmit={create}
        className="bg-white p-4 rounded shadow space-y-3"
      >
        <input
          required
          placeholder="Title"
          value={form.title}
          onChange={(e) => setForm({ ...form, title: e.target.value })}
          className="w-full px-3 py-2 border rounded"
        />
        <textarea
          required
          placeholder="Message"
          value={form.message}
          onChange={(e) => setForm({ ...form, message: e.target.value })}
          className="w-full px-3 py-2 border rounded"
          rows={3}
        />
        <input
          placeholder="Link (optional)"
          value={form.link}
          onChange={(e) => setForm({ ...form, link: e.target.value })}
          className="w-full px-3 py-2 border rounded"
        />
        <div className="flex items-center gap-4">
          <label className="flex items-center gap-1">
            <input
              type="checkbox"
              checked={form.showToStaff}
              onChange={(e) =>
                setForm({ ...form, showToStaff: e.target.checked })
              }
            />
            Show to staff
          </label>
          <label className="flex items-center gap-1">
            <input
              type="checkbox"
              checked={form.showToClients}
              onChange={(e) =>
                setForm({ ...form, showToClients: e.target.checked })
              }
            />
            Show to clients
          </label>
          <label className="flex items-center gap-1">
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
            className="px-3 py-2 border rounded"
          />
        </div>
        <button
          type="submit"
          className="px-4 py-2 bg-blue-600 text-white rounded"
        >
          Add Announcement
        </button>
      </form>

      <div className="bg-white rounded shadow divide-y">
        {loading ? (
          <p className="p-4">Loading…</p>
        ) : items.length === 0 ? (
          <p className="p-4 text-gray-500">No announcements.</p>
        ) : (
          items.map((a) => (
            <div
              key={a.id}
              className="p-4 flex items-start justify-between"
            >
              <div>
                <h3 className="font-semibold">{a.title}</h3>
                <p className="text-sm text-gray-600">{a.message}</p>
                <p className="text-xs text-gray-500 mt-1">
                  {a.showToStaff ? 'Staff' : ''}
                  {a.showToStaff && a.showToClients ? ' + ' : ''}
                  {a.showToClients ? 'Clients' : ''}
                  {a.expiresAt &&
                    ` · expires ${new Date(a.expiresAt).toLocaleDateString()}`}
                </p>
              </div>
              <button
                onClick={() => remove(a.id)}
                className="text-red-600 text-sm"
              >
                Delete
              </button>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
