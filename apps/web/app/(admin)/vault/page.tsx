'use client';

import { useEffect, useState, useCallback } from 'react';
import { ListPageLayout } from '@/components/layouts/list-page-layout';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import { PasswordInput } from '@/components/ui/password-input';
import { inputClass } from '@/components/ui/form-field';

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

  const filtersNode = (
    <input
      aria-label="Search vault"
      placeholder="Search…"
      value={search}
      onChange={(e) => setSearch(e.target.value)}
      className={`${inputClass} max-w-md`}
    />
  );

  return (
    <ListPageLayout
      title="Password Vault"
      primaryAction={{
        label: showNew ? 'Cancel' : 'New Entry',
        onClick: () => setShowNew((v) => !v),
        variant: showNew ? 'secondary' : 'primary',
      }}
      filters={filtersNode}
    >
      {showNew && (
        <Card padding="md" className="max-w-xl">
          <form onSubmit={create} className="space-y-3">
            <input
              aria-label="Title"
              required
              placeholder="Title"
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              className={inputClass}
            />
            <select
              aria-label="Client"
              required
              value={form.clientId}
              onChange={(e) => setForm({ ...form, clientId: e.target.value })}
              className={inputClass}
            >
              <option value="">Select client…</option>
              {clients.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.company}
                </option>
              ))}
            </select>
            <input
              aria-label="Username"
              placeholder="Username"
              value={form.username}
              onChange={(e) => setForm({ ...form, username: e.target.value })}
              className={inputClass}
            />
            <PasswordInput
              aria-label="Password"
              placeholder="Password"
              value={form.password}
              onChange={(e) => setForm({ ...form, password: e.target.value })}
            />
            <input
              aria-label="URL"
              placeholder="URL"
              value={form.url}
              onChange={(e) => setForm({ ...form, url: e.target.value })}
              className={inputClass}
            />
            <textarea
              aria-label="Notes"
              placeholder="Notes"
              value={form.notes}
              onChange={(e) => setForm({ ...form, notes: e.target.value })}
              className={inputClass}
              rows={2}
            />
            <Button type="submit">Save</Button>
          </form>
        </Card>
      )}

      {loading ? (
        <p>Loading…</p>
      ) : (
        <Card>
          <table className="min-w-full text-sm">
            <thead className="bg-gray-50 dark:bg-gray-900">
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
                        className="text-primary hover:underline"
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
                        className="text-primary hover:underline"
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
                  <td colSpan={6}>
                    <EmptyState title="No vault entries" />
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </Card>
      )}
    </ListPageLayout>
  );
}
