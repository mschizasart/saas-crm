'use client';

import { useEffect, useState, useCallback } from 'react';

const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001';

interface Tag {
  id: string;
  name: string;
  color: string;
  _count?: { taggables: number };
}

function getToken() {
  if (typeof window === 'undefined') return null;
  return localStorage.getItem('access_token');
}

export default function TagsPage() {
  const [tags, setTags] = useState<Tag[]>([]);
  const [loading, setLoading] = useState(true);
  const [name, setName] = useState('');
  const [color, setColor] = useState('#6b7280');

  const load = useCallback(async () => {
    setLoading(true);
    const token = getToken();
    const res = await fetch(`${API_BASE}/api/v1/tags`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    setTags(await res.json());
    setLoading(false);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function create(e: React.FormEvent) {
    e.preventDefault();
    const token = getToken();
    await fetch(`${API_BASE}/api/v1/tags`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ name, color }),
    });
    setName('');
    setColor('#6b7280');
    load();
  }

  async function update(id: string, patch: Partial<Tag>) {
    const token = getToken();
    await fetch(`${API_BASE}/api/v1/tags/${id}`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify(patch),
    });
    load();
  }

  async function remove(id: string) {
    if (!confirm('Delete tag? It will be removed from all items.')) return;
    const token = getToken();
    await fetch(`${API_BASE}/api/v1/tags/${id}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${token}` },
    });
    load();
  }

  return (
    <div className="space-y-6 max-w-2xl">
      <h1 className="text-2xl font-bold">Tags</h1>

      <form
        onSubmit={create}
        className="bg-white p-4 rounded shadow flex gap-2 items-end"
      >
        <div className="flex-1">
          <label className="block text-sm font-medium mb-1">Name</label>
          <input
            required
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="w-full px-3 py-2 border rounded"
          />
        </div>
        <div>
          <label className="block text-sm font-medium mb-1">Color</label>
          <input
            type="color"
            value={color}
            onChange={(e) => setColor(e.target.value)}
            className="h-10 w-14 border rounded"
          />
        </div>
        <button
          type="submit"
          className="px-4 py-2 bg-blue-600 text-white rounded"
        >
          Add
        </button>
      </form>

      <div className="bg-white rounded shadow divide-y">
        {loading ? (
          <p className="p-4">Loading…</p>
        ) : tags.length === 0 ? (
          <p className="p-4 text-gray-500">No tags yet.</p>
        ) : (
          tags.map((t) => (
            <div
              key={t.id}
              className="p-3 flex items-center gap-3"
            >
              <span
                className="inline-block w-4 h-4 rounded"
                style={{ background: t.color }}
              />
              <input
                defaultValue={t.name}
                onBlur={(e) => {
                  if (e.target.value !== t.name) {
                    update(t.id, { name: e.target.value });
                  }
                }}
                className="flex-1 px-2 py-1 border rounded"
              />
              <input
                type="color"
                defaultValue={t.color}
                onBlur={(e) => {
                  if (e.target.value !== t.color) {
                    update(t.id, { color: e.target.value });
                  }
                }}
                className="h-8 w-10 border rounded"
              />
              <span className="text-xs text-gray-500 w-16 text-right">
                {t._count?.taggables ?? 0} uses
              </span>
              <button
                onClick={() => remove(t.id)}
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
