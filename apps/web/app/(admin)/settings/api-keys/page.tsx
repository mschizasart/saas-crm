'use client';

import { useEffect, useState } from 'react';
import { SettingsPageLayout, SettingsSection } from '@/components/layouts/settings-page-layout';

const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001';

function getToken(): string | null {
  if (typeof window === 'undefined') return null;
  return localStorage.getItem('access_token');
}

function authHeaders(): HeadersInit {
  return { Authorization: `Bearer ${getToken()}`, 'Content-Type': 'application/json' };
}

interface ApiKeyItem {
  id: string;
  name: string;
  keyPrefix: string;
  lastUsedAt: string | null;
  expiresAt: string | null;
  active: boolean;
  createdAt: string;
}

export default function ApiKeysPage() {
  const [keys, setKeys] = useState<ApiKeyItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);

  // Form
  const [name, setName] = useState('');
  const [expiresAt, setExpiresAt] = useState('');
  const [saving, setSaving] = useState(false);

  // Created key modal
  const [createdKey, setCreatedKey] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const load = async () => {
    try {
      const res = await fetch(`${API_BASE}/api/v1/api-keys`, { headers: authHeaders() });
      if (!res.ok) throw new Error(String(res.status));
      const data = await res.json();
      setKeys(Array.isArray(data) ? data : []);
    } catch { /* ignore */ } finally { setLoading(false); }
  };

  useEffect(() => { load(); }, []);

  const handleCreate = async () => {
    setSaving(true);
    try {
      const body: any = { name };
      if (expiresAt) body.expiresAt = expiresAt;
      const res = await fetch(`${API_BASE}/api/v1/api-keys`, {
        method: 'POST', headers: authHeaders(), body: JSON.stringify(body),
      });
      if (!res.ok) throw new Error(String(res.status));
      const data = await res.json();
      setCreatedKey(data.key);
      setShowForm(false);
      setName('');
      setExpiresAt('');
      load();
    } catch { /* ignore */ } finally { setSaving(false); }
  };

  const handleRevoke = async (id: string) => {
    if (!confirm('Revoke this API key? It will no longer work for authentication.')) return;
    await fetch(`${API_BASE}/api/v1/api-keys/${id}/revoke`, {
      method: 'POST', headers: authHeaders(),
    });
    load();
  };

  const handleDelete = async (id: string) => {
    if (!confirm('Permanently delete this API key?')) return;
    await fetch(`${API_BASE}/api/v1/api-keys/${id}`, {
      method: 'DELETE', headers: authHeaders(),
    });
    load();
  };

  const copyToClipboard = async () => {
    if (!createdKey) return;
    try {
      await navigator.clipboard.writeText(createdKey);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch { /* fallback */ }
  };

  if (loading) return <div className="p-6 text-gray-500 dark:text-gray-400 text-sm">Loading...</div>;

  return (
    <SettingsPageLayout title="API Keys" description="Manage API keys for programmatic access to your CRM">
      {/* Created key modal */}
      {createdKey && (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4">
          <div className="bg-white dark:bg-gray-900 rounded-xl shadow-xl w-full max-w-lg p-6">
            <h3 className="text-lg font-semibold text-gray-900 dark:text-gray-100 mb-2">API Key Created</h3>
            <div className="bg-yellow-50 border border-yellow-200 rounded-lg px-3 py-2 mb-4">
              <p className="text-xs text-yellow-800 font-medium">This key will only be shown once. Copy it now and store it securely.</p>
            </div>
            <div className="flex items-center gap-2 mb-4">
              <code className="flex-1 px-3 py-2 bg-gray-100 dark:bg-gray-800 rounded-lg text-sm font-mono text-gray-800 dark:text-gray-200 break-all select-all">{createdKey}</code>
              <button onClick={copyToClipboard} className="px-3 py-2 border border-gray-200 dark:border-gray-700 rounded-lg text-sm hover:bg-gray-50 dark:hover:bg-gray-800 flex-shrink-0">
                {copied ? 'Copied!' : 'Copy'}
              </button>
            </div>
            <button onClick={() => { setCreatedKey(null); setCopied(false); }} className="bg-primary text-white text-sm font-medium px-4 py-2 rounded-lg hover:bg-primary/90 w-full">
              Done
            </button>
          </div>
        </div>
      )}

      {/* Create form */}
      {showForm && (
        <SettingsSection title="Create API Key">
          <div className="space-y-4">
            <div>
              <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">Name</label>
              <input value={name} onChange={(e) => setName(e.target.value)} className="w-full px-3 py-2 border border-gray-200 dark:border-gray-700 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary/30" placeholder="e.g. Production integration" />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">Expiry Date (optional)</label>
              <input type="date" value={expiresAt} onChange={(e) => setExpiresAt(e.target.value)} className="w-full px-3 py-2 border border-gray-200 dark:border-gray-700 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary/30" />
            </div>
            <div className="flex items-center gap-3 pt-2">
              <button onClick={handleCreate} disabled={saving || !name.trim()} className="bg-primary text-white text-sm font-medium px-4 py-2 rounded-lg hover:bg-primary/90 disabled:opacity-50">
                {saving ? 'Creating...' : 'Create Key'}
              </button>
              <button onClick={() => { setShowForm(false); setName(''); setExpiresAt(''); }} className="text-sm text-gray-600 dark:text-gray-400 hover:text-gray-800">Cancel</button>
            </div>
          </div>
        </SettingsSection>
      )}

      <SettingsSection title="Keys">
        {!showForm && (
          <div className="flex items-center justify-end mb-4">
            <button onClick={() => setShowForm(true)} className="bg-primary text-white text-sm font-medium px-4 py-2 rounded-lg hover:bg-primary/90">
              + New Key
            </button>
          </div>
        )}
        <div className="overflow-x-auto border border-gray-100 dark:border-gray-800 rounded-lg">
          <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-gray-100 dark:border-gray-800 bg-gray-50/50 dark:bg-gray-800/50">
              <th className="text-left px-4 py-3 font-medium text-gray-600 dark:text-gray-400">Name</th>
              <th className="text-left px-4 py-3 font-medium text-gray-600 dark:text-gray-400">Key</th>
              <th className="text-left px-4 py-3 font-medium text-gray-600 dark:text-gray-400">Last Used</th>
              <th className="text-left px-4 py-3 font-medium text-gray-600 dark:text-gray-400">Expires</th>
              <th className="text-center px-4 py-3 font-medium text-gray-600 dark:text-gray-400">Status</th>
              <th className="text-right px-4 py-3 font-medium text-gray-600 dark:text-gray-400">Actions</th>
            </tr>
          </thead>
          <tbody>
            {keys.length === 0 && (
              <tr><td colSpan={6} className="px-4 py-8 text-center text-gray-400 dark:text-gray-500">No API keys</td></tr>
            )}
            {keys.map((k) => {
              const expired = k.expiresAt && new Date(k.expiresAt) < new Date();
              return (
                <tr key={k.id} className="border-b border-gray-50 hover:bg-gray-50/50">
                  <td className="px-4 py-3 font-medium text-gray-900 dark:text-gray-100">{k.name}</td>
                  <td className="px-4 py-3">
                    <code className="text-xs font-mono text-gray-500 dark:text-gray-400 bg-gray-100 dark:bg-gray-800 px-2 py-0.5 rounded">{k.keyPrefix}...</code>
                  </td>
                  <td className="px-4 py-3 text-xs text-gray-500 dark:text-gray-400">
                    {k.lastUsedAt ? new Date(k.lastUsedAt).toLocaleString() : 'Never'}
                  </td>
                  <td className="px-4 py-3 text-xs text-gray-500 dark:text-gray-400">
                    {k.expiresAt ? new Date(k.expiresAt).toLocaleDateString() : 'Never'}
                  </td>
                  <td className="px-4 py-3 text-center">
                    {!k.active ? (
                      <span className="inline-flex px-2 py-0.5 rounded-full text-[10px] font-medium bg-red-100 text-red-700">Revoked</span>
                    ) : expired ? (
                      <span className="inline-flex px-2 py-0.5 rounded-full text-[10px] font-medium bg-yellow-100 text-yellow-700">Expired</span>
                    ) : (
                      <span className="inline-flex px-2 py-0.5 rounded-full text-[10px] font-medium bg-green-100 text-green-700">Active</span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-right space-x-2">
                    {k.active && (
                      <button onClick={() => handleRevoke(k.id)} className="text-xs text-yellow-600 hover:underline">Revoke</button>
                    )}
                    <button onClick={() => handleDelete(k.id)} className="text-xs text-red-600 hover:underline">Delete</button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        </div>
      </SettingsSection>
    </SettingsPageLayout>
  );
}
