'use client';

import { useEffect, useState, useCallback } from 'react';

const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001';
const getToken = () =>
  typeof window === 'undefined' ? null : localStorage.getItem('access_token');

async function api<T = any>(path: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(`${API_BASE}/v1${path}`, {
    ...init,
    headers: {
      ...(init.headers || {}),
      'Content-Type': 'application/json',
      Authorization: `Bearer ${getToken() ?? ''}`,
    },
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  if (res.status === 204) return null as any;
  return res.json();
}

interface Backup {
  filename: string;
  size: number;
  lastModified: string | null;
}

function fmtSize(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(2)} MB`;
}

export default function BackupsPage() {
  const [backups, setBackups] = useState<Backup[]>([]);
  const [busy, setBusy] = useState(false);
  const [autoEnabled, setAutoEnabled] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const data = await api<Backup[]>('/backups');
      setBackups(data ?? []);
      const settings = await api<{ settings: any }>('/organizations/me').catch(
        () => null,
      );
      setAutoEnabled(settings?.settings?.backups?.enabled === true);
    } catch (e: any) {
      setMessage(e.message);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const createBackup = async () => {
    setBusy(true);
    setMessage('Creating backup…');
    try {
      await api('/backups', { method: 'POST' });
      setMessage('Backup created');
      load();
    } catch (e: any) {
      setMessage(e.message);
    } finally {
      setBusy(false);
    }
  };

  const downloadBackup = async (filename: string) => {
    try {
      const { url } = await api<{ url: string }>(
        `/backups/${encodeURIComponent(filename)}/download`,
      );
      window.open(url, '_blank');
    } catch (e: any) {
      setMessage(e.message);
    }
  };

  const deleteBackup = async (filename: string) => {
    if (!confirm(`Delete backup ${filename}?`)) return;
    try {
      await api(`/backups/${encodeURIComponent(filename)}`, {
        method: 'DELETE',
      });
      load();
    } catch (e: any) {
      setMessage(e.message);
    }
  };

  const toggleAuto = async (enabled: boolean) => {
    setAutoEnabled(enabled);
    try {
      await api('/organizations/me/settings', {
        method: 'PATCH',
        body: JSON.stringify({ backups: { enabled } }),
      });
      setMessage(`Automatic backups ${enabled ? 'enabled' : 'disabled'}`);
    } catch (e: any) {
      setMessage(e.message);
    }
  };

  return (
    <div className="max-w-4xl mx-auto p-6 space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">Backups</h1>
        <button
          className="px-4 py-2 bg-blue-600 text-white rounded disabled:opacity-50"
          onClick={createBackup}
          disabled={busy}
        >
          Create Backup Now
        </button>
      </div>

      {message && (
        <div className="p-3 rounded bg-blue-50 text-blue-900 text-sm">
          {message}
        </div>
      )}

      <section className="border rounded-lg p-5 space-y-3">
        <h2 className="text-lg font-semibold">Automatic Backups</h2>
        <label className="flex items-center gap-2">
          <input
            type="checkbox"
            checked={autoEnabled}
            onChange={(e) => toggleAuto(e.target.checked)}
          />
          <span>Enable automatic daily backups (runs nightly at 3:00 AM)</span>
        </label>
      </section>

      <section className="border rounded-lg p-5">
        <h2 className="text-lg font-semibold mb-4">Existing Backups</h2>
        {backups.length === 0 ? (
          <p className="text-sm text-gray-500">No backups yet.</p>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left border-b">
                <th className="py-2">Filename</th>
                <th>Created</th>
                <th>Size</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {backups.map((b) => (
                <tr key={b.filename} className="border-b">
                  <td className="py-2 font-mono">{b.filename}</td>
                  <td>
                    {b.lastModified
                      ? new Date(b.lastModified).toLocaleString()
                      : '—'}
                  </td>
                  <td>{fmtSize(b.size)}</td>
                  <td className="text-right space-x-3">
                    <button
                      className="text-blue-600 hover:underline"
                      onClick={() => downloadBackup(b.filename)}
                    >
                      Download
                    </button>
                    <button
                      className="text-red-600 hover:underline"
                      onClick={() => deleteBackup(b.filename)}
                    >
                      Delete
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </div>
  );
}
