'use client';

import { useEffect, useState, useCallback } from 'react';

const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001';

interface VaultEntry {
  id: string;
  name: string;
  username?: string | null;
  url?: string | null;
  notes?: string | null;
  clientId: string;
  client?: { id: string; company: string } | null;
  hasPassword?: boolean;
}

interface Client {
  id: string;
  company: string;
}

function getToken() {
  if (typeof window === 'undefined') return null;
  return localStorage.getItem('access_token');
}

export default function VaultPage() {
  const [entries, setEntries] = useState<VaultEntry[]>([]);
  const [clients, setClients] = useState<Client[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [showForm, setShowForm] = useState(false);
  const [revealed, setRevealed] = useState<{
    id: string;
    password: string;
  } | null>(null);
  const [showNew, setShowNew] = useState(false);
  const [form, setForm] = useState({
    name: '',
    username: '',
    password: '',
    url: '',
    notes: '',
    clientId: '',
  });
  const [showPassword, setShowPassword] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    const token = getToken();
    const res = await fetch(
      `${API_BASE}/api/v1/vault?search=${encodeURIComponent(search)}`,
      { headers: { Authorization: `Bearer ${token}` } },
    );
    const json = await res.json();
    setEntries(json.data ?? []);
    setLoading(false);
  }, [search]);

  useEffect(() => {
    load();
    const token = getToken();
    fetch(`${API_BASE}/api/v1/clients?limit=200`, {
      headers: { Authorization: `Bearer ${token}` },
    })
      .then((r) => r.json())
      .then((j) => setClients(j.data ?? []))
      .catch(() => setClients([]));
  }, [load]);

  async function reveal(id: string) {
    const token = getToken();
    const res = await fetch(`${API_BASE}/api/v1/vault/${id}/reveal`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) {
      alert('Failed to reveal password');
      return;
    }
    const body = await res.json();
    setRevealed({ id, password: body.password });
    setTimeout(() => setRevealed(null), 30_000);
  }

  async function create(e: React.FormEvent) {
    e.preventDefault();
    const token = getToken();
    const res = await fetch(`${API_BASE}/api/v1/vault`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify(form),
    });
    if (res.ok) {
      setForm({
        name: '',
        username: '',
        password: '',
        url: '',
        notes: '',
        clientId: '',
      });
      setShowNew(false);
      load();
    } else {
      alert('Failed to create entry');
    }
  }

  async function remove(id: string) {
    if (!confirm('Delete this vault entry?')) return;
    const token = getToken();
    await fetch(`${API_BASE}/api/v1/vault/${id}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${token}` },
    });
    load();
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">Password Vault</h1>
        <button
          onClick={() => setShowNew((v) => !v)}
          className="px-4 py-2 bg-blue-600 text-white rounded"
        >
          {showNew ? 'Cancel' : '+ New Entry'}
        </button>
      </div>

      {showNew && (
        <form
          onSubmit={create}
          className="bg-white p-4 rounded shadow space-y-3 max-w-xl"
        >
          <input
            required
            placeholder="Title"
            value={form.name}
            onChange={(e) => setForm({ ...form, name: e.target.value })}
            className="w-full px-3 py-2 border rounded"
          />
          <select
            required
            value={form.clientId}
            onChange={(e) => setForm({ ...form, clientId: e.target.value })}
            className="w-full px-3 py-2 border rounded"
          >
            <option value="">Select client…</option>
            {clients.map((c) => (
              <option key={c.id} value={c.id}>
                {c.company}
              </option>
            ))}
          </select>
          <input
            placeholder="Username"
            value={form.username}
            onChange={(e) => setForm({ ...form, username: e.target.value })}
            className="w-full px-3 py-2 border rounded"
          />
          <div className="relative">
            <input
              type={showPassword ? 'text' : 'password'}
              placeholder="Password"
              value={form.password}
              onChange={(e) => setForm({ ...form, password: e.target.value })}
              className="w-full px-3 py-2 border rounded pr-16"
            />
            <button
              type="button"
              onClick={() => setShowPassword((v) => !v)}
              className="absolute right-2 top-2 text-sm text-blue-600"
            >
              {showPassword ? 'Hide' : 'Show'}
            </button>
          </div>
          <input
            placeholder="URL"
            value={form.url}
            onChange={(e) => setForm({ ...form, url: e.target.value })}
            className="w-full px-3 py-2 border rounded"
          />
          <textarea
            placeholder="Notes"
            value={form.notes}
            onChange={(e) => setForm({ ...form, notes: e.target.value })}
            className="w-full px-3 py-2 border rounded"
            rows={2}
          />
          <button
            type="submit"
            className="px-4 py-2 bg-blue-600 text-white rounded"
          >
            Save
          </button>
        </form>
      )}

      <input
        placeholder="Search…"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        className="px-3 py-2 border rounded w-full max-w-md"
      />

      {loading ? (
        <p>Loading…</p>
      ) : (
        <div className="bg-white rounded shadow overflow-hidden">
          <table className="min-w-full text-sm">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-4 py-2 text-left">Title</th>
                <th className="px-4 py-2 text-left">Client</th>
                <th className="px-4 py-2 text-left">Username</th>
                <th className="px-4 py-2 text-left">URL</th>
                <th className="px-4 py-2 text-left">Password</th>
                <th className="px-4 py-2"></th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {entries.map((e) => (
                <tr key={e.id}>
                  <td className="px-4 py-2 font-medium">{e.name}</td>
                  <td className="px-4 py-2">{e.client?.company ?? '—'}</td>
                  <td className="px-4 py-2">{e.username ?? '—'}</td>
                  <td className="px-4 py-2 max-w-xs truncate">
                    {e.url ? (
                      <a
                        href={e.url}
                        target="_blank"
                        rel="noreferrer"
                        className="text-blue-600 hover:underline"
                      >
                        {e.url}
                      </a>
                    ) : (
                      '—'
                    )}
                  </td>
                  <td className="px-4 py-2 font-mono">
                    {revealed?.id === e.id ? (
                      <span className="text-green-700">
                        {revealed.password}
                      </span>
                    ) : e.hasPassword ? (
                      <button
                        onClick={() => reveal(e.id)}
                        className="text-blue-600 hover:underline"
                      >
                        Reveal
                      </button>
                    ) : (
                      '—'
                    )}
                  </td>
                  <td className="px-4 py-2 text-right">
                    <button
                      onClick={() => remove(e.id)}
                      className="text-red-600 hover:underline"
                    >
                      Delete
                    </button>
                  </td>
                </tr>
              ))}
              {entries.length === 0 && (
                <tr>
                  <td colSpan={6} className="p-6 text-center text-gray-500">
                    No vault entries.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
