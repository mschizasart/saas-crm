'use client';

import { useEffect, useState, useCallback } from 'react';
import { SettingsPageLayout, SettingsSection } from '@/components/layouts/settings-page-layout';

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

interface Client {
  id: string;
  company: string;
}
interface Staff {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
}

export default function GdprPage() {
  const [clients, setClients] = useState<Client[]>([]);
  const [staff, setStaff] = useState<Staff[]>([]);
  const [clientId, setClientId] = useState('');
  const [userId, setUserId] = useState('');
  const [deleteClientId, setDeleteClientId] = useState('');
  const [deleteConfirm, setDeleteConfirm] = useState('');
  const [anonymizeConfirm, setAnonymizeConfirm] = useState(false);
  const [report, setReport] = useState<any>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const [c, s, r] = await Promise.all([
        api<{ data: Client[] }>('/clients?limit=500').catch(() => ({ data: [] })),
        api<{ data: Staff[] }>('/users?type=staff&limit=500').catch(() => ({ data: [] })),
        api('/gdpr/retention-report').catch(() => null),
      ]);
      setClients((c as any).data ?? c ?? []);
      setStaff((s as any).data ?? s ?? []);
      setReport(r);
    } catch (e: any) {
      setMessage(e.message);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const download = (data: any, filename: string) => {
    const blob = new Blob([JSON.stringify(data, null, 2)], {
      type: 'application/json',
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  };

  const exportClient = async () => {
    if (!clientId) return;
    setBusy(true);
    try {
      const data = await api(`/gdpr/export/client/${clientId}`);
      download(data, `client-${clientId}.json`);
      setMessage('Client export downloaded');
    } catch (e: any) {
      setMessage(e.message);
    } finally {
      setBusy(false);
    }
  };

  const exportUser = async () => {
    if (!userId) return;
    setBusy(true);
    try {
      const data = await api(`/gdpr/export/user/${userId}`);
      download(data, `user-${userId}.json`);
      setMessage('User export downloaded');
    } catch (e: any) {
      setMessage(e.message);
    } finally {
      setBusy(false);
    }
  };

  const anonymize = async () => {
    if (!userId || !anonymizeConfirm) return;
    setBusy(true);
    try {
      await api(`/gdpr/anonymize/user/${userId}`, { method: 'POST' });
      setMessage('User anonymized');
      setAnonymizeConfirm(false);
      load();
    } catch (e: any) {
      setMessage(e.message);
    } finally {
      setBusy(false);
    }
  };

  const deleteClient = async () => {
    if (!deleteClientId || deleteConfirm !== 'DELETE') return;
    setBusy(true);
    try {
      await api(`/gdpr/client/${deleteClientId}/complete`, { method: 'DELETE' });
      setMessage('Client deleted permanently');
      setDeleteClientId('');
      setDeleteConfirm('');
      load();
    } catch (e: any) {
      setMessage(e.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <SettingsPageLayout title="GDPR Tools" description="Exports, anonymization and deletion tools for compliance workflows">
      {message && (
        <div className="p-3 rounded bg-blue-50 text-blue-900 text-sm">
          {message}
        </div>
      )}

      <SettingsSection
        title="Export Data"
        description="Download a full JSON export of all data associated with a client or a staff user (right of access)."
      >
        <div className="space-y-2">
          <label className="block text-sm font-medium">Client</label>
          <div className="flex gap-2">
            <select
              className="border rounded px-3 py-2 flex-1"
              value={clientId}
              onChange={(e) => setClientId(e.target.value)}
            >
              <option value="">Select a client…</option>
              {clients.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.company}
                </option>
              ))}
            </select>
            <button
              className="px-4 py-2 bg-blue-600 text-white rounded disabled:opacity-50"
              onClick={exportClient}
              disabled={busy || !clientId}
            >
              Export client
            </button>
          </div>
        </div>

        <div className="space-y-2">
          <label className="block text-sm font-medium">Staff user</label>
          <div className="flex gap-2">
            <select
              className="border rounded px-3 py-2 flex-1"
              value={userId}
              onChange={(e) => setUserId(e.target.value)}
            >
              <option value="">Select a user…</option>
              {staff.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.firstName} {s.lastName} ({s.email})
                </option>
              ))}
            </select>
            <button
              className="px-4 py-2 bg-blue-600 text-white rounded disabled:opacity-50"
              onClick={exportUser}
              disabled={busy || !userId}
            >
              Export user
            </button>
          </div>
        </div>
      </SettingsSection>

      <SettingsSection title="Data Retention Report">
        {report ? (
          <div className="grid grid-cols-2 gap-3 text-sm">
            {Object.entries(report.counts ?? {}).map(([k, v]: any) => (
              <div key={k} className="flex justify-between border-b py-1">
                <span className="text-gray-600 dark:text-gray-400">{k}</span>
                <span className="font-medium">{String(v)}</span>
              </div>
            ))}
          </div>
        ) : (
          <p className="text-sm text-gray-500 dark:text-gray-400">Loading…</p>
        )}
        <button
          className="text-sm text-blue-600 underline"
          onClick={load}
        >
          Refresh
        </button>
      </SettingsSection>

      <SettingsSection
        title="Anonymize User"
        description="Replaces the user's email, name and phone with anonymized values, kills their sessions, and deactivates the account — while preserving historical records (invoices, tickets, audit trail)."
      >
        <div className="space-y-3">
          <select
            className="border rounded px-3 py-2 w-full"
            value={userId}
            onChange={(e) => setUserId(e.target.value)}
          >
            <option value="">Select a user…</option>
            {staff.map((s) => (
              <option key={s.id} value={s.id}>
                {s.firstName} {s.lastName} ({s.email})
              </option>
            ))}
          </select>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={anonymizeConfirm}
              onChange={(e) => setAnonymizeConfirm(e.target.checked)}
            />
            I understand this action cannot be undone.
          </label>
          <button
            className="px-4 py-2 bg-orange-600 text-white rounded disabled:opacity-50"
            onClick={anonymize}
            disabled={busy || !userId || !anonymizeConfirm}
          >
            Anonymize user
          </button>
        </div>
      </SettingsSection>

      <SettingsSection
        title="Delete Client (complete)"
        description="Permanently deletes the client and every associated record: contacts, vault entries, subscriptions, and more. Invoices, contracts and tickets are preserved but their client reference is removed."
      >
        <div className="space-y-3">
          <select
            className="border rounded px-3 py-2 w-full"
            value={deleteClientId}
            onChange={(e) => setDeleteClientId(e.target.value)}
          >
            <option value="">Select a client…</option>
            {clients.map((c) => (
              <option key={c.id} value={c.id}>
                {c.company}
              </option>
            ))}
          </select>
          <input
            className="border rounded px-3 py-2 w-full"
            placeholder='Type "DELETE" to confirm'
            value={deleteConfirm}
            onChange={(e) => setDeleteConfirm(e.target.value)}
          />
          <button
            className="px-4 py-2 bg-red-600 text-white rounded disabled:opacity-50"
            onClick={deleteClient}
            disabled={busy || !deleteClientId || deleteConfirm !== 'DELETE'}
          >
            Permanently delete client
          </button>
        </div>
      </SettingsSection>
    </SettingsPageLayout>
  );
}
